import type { AuthRoleCode, PermissionCode } from "../types";

export type RolePolicy = {
  code: AuthRoleCode;
  name: string;
  tag: string;
  permissions: PermissionCode[];
};

export const defaultRolePolicies: RolePolicy[] = [
  {
    code: "REQUESTER",
    name: "요청자",
    tag: "기본",
    permissions: ["dashboard:read", "favorite:read", "payment_request:create", "payment_request:read_own", "payment_request:submit", "payment_request:update_own"],
  },
  {
    code: "APPROVER",
    name: "승인자",
    tag: "그룹",
    permissions: ["approval:act", "approval:read_assigned", "dashboard:read", "favorite:read"],
  },
  {
    code: "FINANCE",
    name: "재무팀",
    tag: "그룹",
    permissions: ["budget:read", "dashboard:read", "disbursement:execute", "disbursement:hold", "disbursement:read", "favorite:read", "payment_request:read_all", "report:read", "vendor:read"],
  },
  {
    code: "AUDITOR",
    name: "외부 감사",
    tag: "외부",
    permissions: ["audit:read", "dashboard:read", "favorite:read", "report:read"],
  },
  {
    code: "ADMIN",
    name: "관리자",
    tag: "관리자",
    permissions: ["*"],
  },
];

export const privilegedMutationPermissions = [
  "approval:act",
  "disbursement:execute",
  "disbursement:hold",
  "payment_request:create",
  "payment_request:submit",
  "payment_request:update_own",
  "system:manage",
] as const;

export function rolePolicyByCode(code: AuthRoleCode) {
  return defaultRolePolicies.find((role) => role.code === code);
}
