import type { FastifyRequest } from "fastify";
import type { Prisma } from "../../generated/prisma/index.js";

export type TableRow = Record<string, string>;

export type ListQuery = {
  page: number;
  pageSize: number;
  search?: string;
  sort?: string;
  filters?: Record<string, string>;
};

export function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function formatWon(amount: unknown) {
  return `${Number(amount).toLocaleString("ko-KR")} 원`;
}

export function parseWon(value: unknown) {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function readStringPatch(body: unknown): TableRow {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};

  return Object.entries(body as Record<string, unknown>).reduce<TableRow>((acc, [key, value]) => {
    if (typeof value === "string") acc[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) acc[key] = String(value);
    return acc;
  }, {});
}

// content-length/transfer-encoding describe the ORIGINAL request body; internal
// re-injects send a rebuilt payload, so forwarding them corrupts the new request.
export function forwardableHeaders(headers: unknown) {
  const { "content-length": _contentLength, "transfer-encoding": _transferEncoding, ...rest } = headers as Record<string, string>;
  return rest;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return uuidPattern.test(value);
}

export function readListFilters(query: unknown) {
  if (!query || typeof query !== "object" || Array.isArray(query)) return {};

  return Object.entries(query as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, value]) => {
    if (!key.startsWith("filter.") || typeof value !== "string" || !value) return acc;
    acc[key.slice("filter.".length)] = value;
    return acc;
  }, {});
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function compare(a: string, b: string) {
  const numericA = parseWon(a);
  const numericB = parseWon(b);
  if (numericA !== undefined && numericB !== undefined) return numericA - numericB;
  return a.localeCompare(b, "ko-KR");
}

export function filterAndSortRows(rows: TableRow[], query: ListQuery) {
  const search = normalize(query.search ?? "");
  const filters = Object.entries(query.filters ?? {}).filter(([, value]) => value);
  const filteredBySearch = search
    ? rows.filter((row) => Object.values(row).some((value) => normalize(value).includes(search)))
    : rows;
  const filtered = filters.length
    ? filteredBySearch.filter((row) => filters.every(([field, value]) => normalize(row[field] ?? "").includes(normalize(value))))
    : filteredBySearch;

  if (!query.sort) return filtered;

  const [field, direction = "asc"] = query.sort.split(":");
  if (!field) return filtered;

  return [...filtered].sort((a, b) => {
    const result = compare(a[field] ?? "", b[field] ?? "");
    return direction === "desc" ? -result : result;
  });
}

export function paginateRows(rows: TableRow[], query: ListQuery) {
  const page = Math.max(1, query.page);
  const pageSize = Math.max(1, query.pageSize);
  const start = (page - 1) * pageSize;

  return {
    rows: rows.slice(start, start + pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}

export function jsonRow(row: TableRow): Prisma.InputJsonObject {
  return row as Prisma.InputJsonObject;
}

export function requestId(request: FastifyRequest) {
  return typeof request.id === "string" ? request.id : String(request.id);
}

function requestUserAgent(request: FastifyRequest) {
  const value = request.headers["user-agent"];
  if (Array.isArray(value)) return value.join(" ");
  return value;
}

export function auditRequestContext(request: FastifyRequest) {
  return {
    requestId: requestId(request),
    ipAddress: request.ip,
    userAgent: requestUserAgent(request),
  };
}

export function definedCookies(cookies: Record<string, string | undefined>): Record<string, string> {
  return Object.entries(cookies).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === "string") acc[key] = value;
    return acc;
  }, {});
}

export function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}
