import type { PrismaClient } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma.js";
import { dormantAccountCutoff, dormantAccountDays } from "../auth/loginPolicy.js";

export type AccountLifecycleScope = "dormant" | "offboarding" | "all";

export function offboardingEmailsFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return [
    ...(env.OFFBOARDING_USER_EMAILS ?? "").split(","),
    ...(env.TERMINATED_USER_EMAILS ?? "").split(","),
  ].map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export function accountLifecycleScope(value: unknown): AccountLifecycleScope {
  return value === "offboarding" || value === "all" ? value : "dormant";
}

export async function getAccountLifecycleCandidates(
  scope: AccountLifecycleScope = "all",
  db: Pick<PrismaClient, "user"> = prisma,
  now = new Date(),
) {
  const cutoff = dormantAccountCutoff(now);
  const offboardingEmails = offboardingEmailsFromEnv();
  const [dormantUsers, offboardingUsers] = await Promise.all([
    scope === "offboarding"
      ? Promise.resolve([])
      : db.user.findMany({
          where: {
            isActive: true,
            OR: [
              { lastLoginAt: { lte: cutoff } },
              { lastLoginAt: null, createdAt: { lte: cutoff } },
            ],
          },
          select: { id: true, email: true, name: true, createdAt: true, lastLoginAt: true },
          orderBy: { name: "asc" },
        }),
    scope === "dormant" || offboardingEmails.length === 0
      ? Promise.resolve([])
      : db.user.findMany({
          where: {
            isActive: true,
            email: { in: offboardingEmails },
          },
          select: { id: true, email: true, name: true, createdAt: true, lastLoginAt: true },
          orderBy: { name: "asc" },
        }),
  ]);

  const byId = new Map<string, (typeof dormantUsers)[number] & { reasons: string[] }>();
  dormantUsers.forEach((user) => byId.set(user.id, { ...user, reasons: ["dormant"] }));
  offboardingUsers.forEach((user) => {
    const current = byId.get(user.id);
    if (current) current.reasons.push("offboarding");
    else byId.set(user.id, { ...user, reasons: ["offboarding"] });
  });

  return {
    generatedAt: now.toISOString(),
    dormantAccountDays,
    dormantCutoff: cutoff.toISOString(),
    offboardingEmails,
    candidates: [...byId.values()].map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      reasons: user.reasons,
    })),
  };
}

export async function getAccountLifecycleSummary(db: Pick<PrismaClient, "user"> = prisma) {
  const snapshot = await getAccountLifecycleCandidates("all", db);
  const dormantCount = snapshot.candidates.filter((candidate) => candidate.reasons.includes("dormant")).length;
  const offboardingCount = snapshot.candidates.filter((candidate) => candidate.reasons.includes("offboarding")).length;
  return {
    ok: snapshot.candidates.length === 0,
    actionRequired: snapshot.candidates.length > 0,
    generatedAt: snapshot.generatedAt,
    dormantAccountDays: snapshot.dormantAccountDays,
    dormantCutoff: snapshot.dormantCutoff,
    offboardingConfigured: snapshot.offboardingEmails.length > 0,
    summary: {
      dormantCount,
      offboardingCount,
      totalCandidates: snapshot.candidates.length,
    },
    candidates: snapshot.candidates,
  };
}
