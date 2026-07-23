import type { LucideIcon } from "lucide-react";

export type PageKey =
  | "dashboard"
  | "payment-request"
  | "approval"
  | "disbursement"
  | "budget"
  | "vendors"
  | "reports"
  | "settings"
  | "favorites";

export type RouteKey = "landing" | PageKey;

export type TableRow = Record<string, string>;

export type AuthRoleCode = "REQUESTER" | "APPROVER" | "FINANCE" | "ADMIN" | "AUDITOR";
export type PermissionCode = string;

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  departmentId: string;
  departmentName: string;
  roles: AuthRoleCode[];
  permissions: PermissionCode[];
};

export type AttachmentDraft = {
  id: string;
  fileName: string;
  byteSize: number;
  status: "ready" | "uploading" | "error";
  message?: string;
  remoteId?: string;
  scanStatus?: "pending" | "clean" | "blocked";
  downloadUrl?: string;
};

export type NotificationType =
  | "approval_requested"
  | "approval_rejected"
  | "approval_held"
  | "approval_completed"
  | "disbursement_scheduled"
  | "disbursement_completed"
  | "budget_exceeded"
  | "approval_delayed"
  | "system_setting_changed"
  | "operational_alert";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
  readAt?: string;
  expiresAt?: string;
  linkPath?: string;
  entityType?: string;
  entityId?: string;
};

export type KpiTone = "amber" | "blue" | "green" | "red" | "teal" | "navy";
export type FooterTone = "red" | "blue" | "teal" | "default";

export type KpiItem = {
  label: string;
  value: string;
  detail: string;
  tone: KpiTone;
  amount?: string;
  footer?: string;
  suffix?: string;
  footerTone?: FooterTone;
};

export type PageDefinition = {
  title: string;
  subtitle: string;
  eyebrow: string;
  cta: string;
  icon: LucideIcon;
  kpis: KpiItem[];
  tableTitle: string;
  tableColumns: string[];
  tableRows: TableRow[];
};

export type NavItem = {
  key: PageKey;
  label: string;
  icon: LucideIcon;
};

export type ListQuery = {
  search?: string;
  filters?: Partial<Record<string, string>>;
  page?: number;
  pageSize?: number;
  sort?: string;
};

export type MockApiResponse<T> = {
  ok: true;
  data: T;
  meta?: Record<string, string | number | boolean>;
};

export type PaginatedRows = {
  rows: TableRow[];
  total: number;
  page: number;
  pageSize: number;
};
