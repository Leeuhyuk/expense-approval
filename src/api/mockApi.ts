import { pageOrder, pages } from "../mockData";
import { compareTableRows, decodeSort } from "../domain/formatters";
import type { ListQuery, MockApiResponse, PageDefinition, PageKey, PaginatedRows, TableRow } from "../types";

const DEFAULT_PAGE_SIZE = 10;
const rowsByPage = pageOrder.reduce(
  (acc, pageKey) => {
    acc[pageKey] = pages[pageKey].tableRows.map((row) => ({ ...row }));
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

function applyQuery(rows: TableRow[], query: ListQuery = {}) {
  const search = normalize(query.search ?? "");
  const filters = Object.entries(query.filters ?? {}).filter(([, value]) => value);

  return rows.filter((row) => {
    const matchesSearch = search.length === 0 || Object.values(row).some((value) => normalize(value).includes(search));
    const matchesFilters = filters.every(([field, value]) => normalize(row[field] ?? "").includes(normalize(value ?? "")));
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
