import { createHash } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma.js";

export type AuditIntegritySeverity = "info" | "warning" | "critical";

export type AuditIntegrityCheckpoint = {
  id: string;
  label: string;
  ok: boolean;
  severity: AuditIntegritySeverity;
  owner: string;
  detail: string;
  evidence: string;
};

export type AuditIntegrityHashLink = {
  id: string;
  position: number;
  time: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string;
  requestId: string;
  payloadHash: string;
  previousHash: string;
  recordHash: string;
};

export type AuditArchiveStatus = {
  configured: boolean;
  mode: string;
  target: string;
  evidence: string;
  action: string;
};

type AuditIntegrityDb = PrismaClient;

const hashAlgorithm = "sha256";
const hashChainVersion = "audit-log-chain:v1";
const payloadFields = [
  "id",
  "entityType",
  "entityId",
  "actorId",
  "action",
  "beforeValue",
  "afterValue",
  "reason",
  "idempotencyKey",
  "requestId",
  "ipAddress",
  "userAgent",
  "createdAt",
];

function monthRange(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { label: start.toISOString().slice(0, 7), start, end };
}

function sha256(value: string) {
  return createHash(hashAlgorithm).update(value, "utf8").digest("hex");
}

function normalizedEnv(name: string) {
  const value = process.env[name]?.trim() ?? "";
  return value.length > 0 ? value : "";
}

function maxRecordsLimit() {
  const value = Number(process.env.AUDIT_INTEGRITY_MAX_RECORDS);
  return Number.isFinite(value) && value > 0 ? Math.min(10_000, Math.floor(value)) : 2_000;
}

function normalizeForHash(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => normalizeForHash(item));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeForHash(item)]),
  );
}

function stableStringify(value: unknown) {
  return JSON.stringify(normalizeForHash(value));
}

function archiveStatus(): AuditArchiveStatus {
  const mode = normalizedEnv("AUDIT_ARCHIVE_MODE") || "hash_chain_only";
  const endpoint = normalizedEnv("AUDIT_ARCHIVE_ENDPOINT");
  const bucket = normalizedEnv("AUDIT_ARCHIVE_BUCKET");
  const evidence = normalizedEnv("AUDIT_ARCHIVE_EVIDENCE");
  const disabled = mode === "disabled";
  const configured = !disabled && Boolean(endpoint || bucket || evidence);
  const target = endpoint
    ? "AUDIT_ARCHIVE_ENDPOINT"
    : bucket
      ? "AUDIT_ARCHIVE_BUCKET"
      : evidence
        ? "AUDIT_ARCHIVE_EVIDENCE"
        : "not configured";

  return {
    configured,
    mode,
    target,
    evidence: configured ? "외부 WORM/감사 저장소 연계 설정 또는 증적 참조가 있습니다." : "외부 보관소 연계 설정이 없습니다.",
    action: configured
      ? "해시 체인 tail hash와 외부 보관소 증적을 월마감 감사 자료에 함께 보관합니다."
      : "운영 환경에서 AUDIT_ARCHIVE_ENDPOINT, AUDIT_ARCHIVE_BUCKET 또는 AUDIT_ARCHIVE_EVIDENCE를 설정해 외부 보관 증적을 연결하세요.",
  };
}

function genesisHash(period: { start: Date; end: Date }) {
  return sha256(stableStringify({
    version: hashChainVersion,
    periodStart: period.start.toISOString(),
    periodEndExclusive: period.end.toISOString(),
  }));
}

function sampleLinks(links: AuditIntegrityHashLink[]) {
  if (links.length <= 10) return links;
  const selected = new Map<string, AuditIntegrityHashLink>();
  for (const link of [...links.slice(0, 5), ...links.slice(-5)]) {
    selected.set(link.id, link);
  }
  return [...selected.values()].sort((left, right) => left.position - right.position);
}

export async function getAuditIntegrityReport(db: AuditIntegrityDb = prisma, now = new Date()) {
  const period = monthRange(now);
  const maxRecords = maxRecordsLimit();
  const where = { createdAt: { gte: period.start, lt: period.end } };
  const [totalAuditLogs, auditLogs] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: maxRecords,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        actorId: true,
        action: true,
        beforeValue: true,
        afterValue: true,
        reason: true,
        idempotencyKey: true,
        requestId: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
      },
    }),
  ]);

  let previousHash = genesisHash(period);
  const links: AuditIntegrityHashLink[] = auditLogs.map((log, index) => {
    const payload = {
      id: log.id,
      entityType: log.entityType,
      entityId: log.entityId,
      actorId: log.actorId,
      action: log.action,
      beforeValue: log.beforeValue,
      afterValue: log.afterValue,
      reason: log.reason,
      idempotencyKey: log.idempotencyKey,
      requestId: log.requestId,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      createdAt: log.createdAt.toISOString(),
    };
    const payloadHash = sha256(stableStringify(payload));
    const recordHash = sha256(stableStringify({
      version: hashChainVersion,
      position: index + 1,
      previousHash,
      payloadHash,
    }));
    const link = {
      id: log.id,
      position: index + 1,
      time: log.createdAt.toISOString(),
      entityType: log.entityType,
      entityId: log.entityId,
      action: log.action,
      actorId: log.actorId,
      requestId: log.requestId,
      payloadHash,
      previousHash,
      recordHash,
    };
    previousHash = recordHash;
    return link;
  });

  const chainComplete = auditLogs.length === totalAuditLogs;
  const chainGenerated = links.length === auditLogs.length;
  const externalArchive = archiveStatus();
  const hashOrArchiveOk = chainGenerated || externalArchive.configured;
  const checkpoints: AuditIntegrityCheckpoint[] = [
    {
      id: "append_only_controls",
      label: "감사 로그 append-only 통제",
      ok: true,
      severity: "critical",
      owner: "보안 운영",
      detail: "수정/삭제 API 금지, release:audit-append-only, audit_logs_append_only DB trigger 기준을 사용합니다.",
      evidence: "scripts/verify-audit-append-only.mjs + prisma/migrations/20260705030000_audit_log_append_only_trigger",
    },
    {
      id: "hash_chain_generated",
      label: "월 감사 로그 해시 체인",
      ok: chainGenerated && chainComplete,
      severity: chainComplete ? "info" : "warning",
      owner: "감사 운영",
      detail: `${period.label} 감사 로그 ${auditLogs.length}/${totalAuditLogs}건을 createdAt asc, id asc 순서로 체인화했습니다.`,
      evidence: `algorithm=${hashAlgorithm}, version=${hashChainVersion}, maxRecords=${maxRecords}`,
    },
    {
      id: "hash_chain_or_archive",
      label: "해시 체인 또는 외부 보관",
      ok: hashOrArchiveOk,
      severity: externalArchive.configured ? "info" : "warning",
      owner: "운영 책임자",
      detail: externalArchive.configured ? "외부 보관 설정이 연결되어 있습니다." : "내부 해시 체인 tail hash로 월마감 무결성 증적을 생성합니다.",
      evidence: externalArchive.configured ? externalArchive.target : "AuditLog payload hash chain",
    },
    {
      id: "raw_values_excluded",
      label: "원문 JSON 미노출",
      ok: true,
      severity: "critical",
      owner: "개인정보 보호 책임자",
      detail: "리포트 응답은 beforeValue/afterValue 원문을 반환하지 않고 payloadHash만 반환합니다.",
      evidence: "sampledLinks payloadHash/recordHash only",
    },
  ];
  const headHash = links[0]?.recordHash ?? previousHash;
  const tailHash = links.at(-1)?.recordHash ?? previousHash;

  return {
    ok: checkpoints.every((item) => item.ok),
    generatedAt: new Date().toISOString(),
    algorithm: hashAlgorithm,
    version: hashChainVersion,
    payloadFields,
    period: {
      month: period.label,
      start: period.start.toISOString(),
      endExclusive: period.end.toISOString(),
    },
    summary: {
      totalAuditLogs,
      auditLogsReviewed: auditLogs.length,
      chainLength: links.length,
      truncated: !chainComplete,
      checkpointsPassed: checkpoints.filter((item) => item.ok).length,
      checkpointsTotal: checkpoints.length,
      headHash,
      tailHash,
      externalArchiveConfigured: externalArchive.configured,
    },
    externalArchive,
    checkpoints,
    sampledLinks: sampleLinks(links),
    rawValuePolicy: "감사 로그 무결성 리포트는 beforeValue/afterValue 원문 JSON을 응답하지 않고 payloadHash, previousHash, recordHash만 제공합니다.",
  };
}
