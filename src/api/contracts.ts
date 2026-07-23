import type { AuthRoleCode, NotificationItem, PageKey, PermissionCode } from "../types";

export type ApiStatus = "success" | "error";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_REPLAY"
  | "IDEMPOTENCY_CONFLICT"
  | "PARTIAL_FAILURE"
  | "WORKFLOW_LOCKED"
  | "MALWARE_BLOCKED"
  | "SCAN_UNAVAILABLE"
  | "RATE_LIMITED"
  | "SERVER_ERROR";

export type ApiResponse<T> =
  | {
      status: "success";
      data: T;
      meta?: ApiMeta;
    }
  | {
      status: "error";
      error: ApiError;
      meta?: ApiMeta;
    };

export type ApiMeta = {
  requestId: string;
  rowVersion?: number;
  pagination?: PaginationMeta;
  auditLogId?: string;
  key?: string;
  saved?: boolean;
  idempotencyReplay?: boolean;
};

export type ApiError = {
  code: ApiErrorCode;
  message: string;
  fieldErrors?: Record<string, string>;
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type LoginRequestDto = {
  email: string;
  password: string;
};

export type AuthUserDto = {
  id: string;
  name: string;
  email: string;
  departmentId: string;
  departmentName: string;
  roles: AuthRoleCode[];
  permissions: PermissionCode[];
};

export type AuthSessionDto = AuthUserDto & {
  menuAccess?: PageKey[];
};

export type NotificationDto = NotificationItem;

export type ReleaseIdentityDto = {
  ok: boolean;
  service: string;
  releaseVersion: string | null;
  sourceRef: string | null;
  gitCommit: string | null;
  manifestSha256: string | null;
  missing: string[];
  issues: string[];
};

export type ListParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: string;
  filters?: Record<string, string>;
};

export type PaymentRequestStatus =
  | "draft"
  | "submitted"
  | "approval_pending"
  | "approval_in_progress"
  | "approved"
  | "rejected"
  | "held";

export type ApprovalStatus = "approval_pending" | "approval_in_progress" | "approved" | "rejected" | "held";
export type DisbursementStatus = "scheduled" | "due_today" | "completed" | "error" | "held";
export type AccountVerificationStatus = "verified" | "pending" | "mismatch" | "inactive";

export type PaymentRequestDto = {
  id: string;
  requestedAt: string;
  requesterId: string;
  departmentId: string;
  vendorId: string;
  amount: number;
  currency: "KRW";
  status: PaymentRequestStatus;
  reason: string;
  budgetItemId?: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type CreatePaymentRequestDto = {
  vendorId: string;
  departmentId: string;
  amount: number;
  reason: string;
  budgetItemId?: string;
  attachmentIds?: string[];
};

export type ApprovalActionDto = {
  action: "approve" | "reject" | "hold";
  reason?: string;
  rowVersion: number;
  idempotencyKey: string;
};

export type DisbursementActionDto = {
  action: "execute" | "hold" | "retry";
  reason?: string;
  scheduledAt?: string;
  rowVersion: number;
  idempotencyKey: string;
};

export type VendorDto = {
  id: string;
  name: string;
  businessNumber: string;
  bankName: string;
  bankAccountMasked: string;
  accountVerificationStatus: AccountVerificationStatus;
  isActive: boolean;
  rowVersion: number;
};

export type AuditLogDto = {
  id: string;
  entityType: string;
  entityId: string;
  actorId: string;
  action: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  createdAt: string;
};
