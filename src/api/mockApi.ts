import { pageOrder, pages } from "../mockData";
import { compareTableRows, decodeSort } from "../domain/formatters";
import type { ListQuery, MockApiResponse, PageDefinition, PageKey, PaginatedRows, TableRow } from "../types";

function mockVendorBusinessType(vendorName = "") {
  if (vendorName.includes("(주)") || vendorName.includes("무역")) return "법인";
  if (vendorName.includes("오피스") || vendorName.includes("콘텐츠")) return "개인/소상공";
  return "일반";
}

function normalizeMockRow(pageKey: PageKey, row: TableRow): TableRow {
  if (pageKey !== "vendors" || row.구분) return { ...row };
  return { ...row, 구분: mockVendorBusinessType(row.거래처명) };
}

const DEFAULT_PAGE_SIZE = 10;
const rowsByPage = pageOrder.reduce(
  (acc, pageKey) => {
    acc[pageKey] = pages[pageKey].tableRows.map((row) => normalizeMockRow(pageKey, row));
    return acc;
  },
  {} as Record<PageKey, TableRow[]>,
);

function respond<T>(data: T, meta?: MockApiResponse<T>["meta"]): Promise<MockApiResponse<T>> {
  return Promise.resolve({ ok: true, data, meta });
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function comparable(value: string) {
  const numeric = Number(value.replace(/[^\d.-]/g, ""));
  if (Number.isFinite(numeric) && /\d/.test(value)) return numeric;
  const dateValue = new Date(value).getTime();
  if (Number.isFinite(dateValue) && /\d{4}-\d{2}-\d{2}/.test(value)) return dateValue;
  return normalize(value);
}

function compareFilterValue(a: string, b: string) {
  const comparableA = comparable(a);
  const comparableB = comparable(b);
  if (typeof comparableA === "number" && typeof comparableB === "number") return comparableA - comparableB;
  return String(comparableA).localeCompare(String(comparableB), "ko-KR");
}

function matchesFilter(row: TableRow, field: string, value = "") {
  const [rawField, operator] = field.split("__");
  const rowValue = row[rawField] ?? "";
  if (operator === "in") {
    return value.split(/[|,]/).map((item) => normalize(item)).filter(Boolean).some((item) => normalize(rowValue) === item);
  }
  const result = compareFilterValue(rowValue, value);
  if (operator === "lte") return result <= 0;
  if (operator === "lt") return result < 0;
  if (operator === "gte") return result >= 0;
  if (operator === "gt") return result > 0;
  return normalize(rowValue).includes(normalize(value));
}

function applyQuery(rows: TableRow[], query: ListQuery = {}) {
  const search = normalize(query.search ?? "");
  const filters = Object.entries(query.filters ?? {}).filter(([, value]) => value);

  return rows.filter((row) => {
    const matchesSearch = search.length === 0 || Object.values(row).some((value) => normalize(value).includes(search));
    const matchesFilters = filters.every(([field, value]) => matchesFilter(row, field, value));
    return matchesSearch && matchesFilters;
  });
}

function paginate(rows: TableRow[], query: ListQuery = {}): PaginatedRows {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE);
  const start = (page - 1) * pageSize;

  return {
    rows: rows.slice(start, start + pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}

function applySort(rows: TableRow[], query: ListQuery = {}) {
  const sort = decodeSort(query.sort);
  if (!sort) return rows;
  return [...rows].sort((a, b) => compareTableRows(a, b, sort.field, sort.direction));
}

export function listPages() {
  return respond(pageOrder.map((key) => pages[key]));
}

export function getPageDefinition(pageKey: PageKey) {
  return respond<PageDefinition>(pages[pageKey]);
}

export function listPageRows(pageKey: PageKey, query: ListQuery = {}) {
  const rows = applySort(applyQuery(rowsByPage[pageKey], query), query);
  return respond(paginate(rows, query), { pageKey, total: rows.length });
}

export function getPageRow(pageKey: PageKey, rowId: string, idColumn = pages[pageKey].tableColumns[0]) {
  const row = rowsByPage[pageKey].find((item) => item[idColumn] === rowId);
  return respond(row ?? null, { pageKey, idColumn, rowId, found: Boolean(row) });
}

export function updatePageRow(pageKey: PageKey, rowId: string, patch: TableRow, idColumn = pages[pageKey].tableColumns[0]) {
  const rows = rowsByPage[pageKey];
  const index = rows.findIndex((item) => item[idColumn] === rowId);

  if (index === -1) {
    return respond(null, { pageKey, idColumn, rowId, found: false });
  }

  rows[index] = { ...rows[index], ...patch };
  return respond(rows[index], { pageKey, idColumn, rowId, found: true });
}

export function createPageRow(pageKey: PageKey, row: TableRow) {
  rowsByPage[pageKey] = [row, ...rowsByPage[pageKey]];
  return respond(row, { pageKey, created: true });
}

export function deletePageRow(pageKey: PageKey, rowId: string, idColumn = pages[pageKey].tableColumns[0]) {
  const rows = rowsByPage[pageKey];
  const index = rows.findIndex((item) => item[idColumn] === rowId);

  if (index === -1) {
    return respond(null, { pageKey, idColumn, rowId, found: false, deleted: false });
  }

  const [deletedRow] = rows.splice(index, 1);
  return respond(deletedRow, { pageKey, idColumn, rowId, found: true, deleted: true });
}

export function executePageAction(pageKey: PageKey, rowId: string, action: string, patch: TableRow = {}, idColumn = pages[pageKey].tableColumns[0]) {
  const rows = rowsByPage[pageKey];
  const index = rows.findIndex((item) => item[idColumn] === rowId);

  if (index === -1) {
    return respond(null, { pageKey, idColumn, rowId, action, found: false });
  }

  rows[index] = {
    ...rows[index],
    ...patch,
    "마지막 액션": action,
  };
  return respond(rows[index], { pageKey, idColumn, rowId, action, found: true });
}
