import type { TableRow } from "../types";

export type SortDirection = "asc" | "desc";

export function formatCurrencyWon(value: number) {
  return `${value.toLocaleString("ko-KR")} 원`;
}

export function formatDateIso(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

export function parseWon(value = "") {
  const numberValue = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function parseComparable(value = "") {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return new Date(trimmed).getTime();
  }
  if (trimmed.includes("원")) {
    return parseWon(trimmed);
  }
  return trimmed.toLocaleLowerCase("ko-KR");
}

export function compareTableRows(a: TableRow, b: TableRow, field: string, direction: SortDirection) {
  const left = parseComparable(a[field] ?? "");
  const right = parseComparable(b[field] ?? "");
  const multiplier = direction === "asc" ? 1 : -1;

  if (typeof left === "number" && typeof right === "number") {
    return (left - right) * multiplier;
  }

  return String(left).localeCompare(String(right), "ko-KR", { numeric: true }) * multiplier;
}

export function encodeSort(field: string, direction: SortDirection) {
  return `${field}:${direction}`;
}

export function decodeSort(sort?: string) {
  if (!sort) return null;
  const [field, direction] = sort.split(":");
  if (!field || (direction !== "asc" && direction !== "desc")) return null;
  return { field, direction: direction as SortDirection };
}
