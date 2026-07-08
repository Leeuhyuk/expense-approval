import { PrismaClient } from "../../generated/prisma/index.js";

declare global {
  // eslint-disable-next-line no-var
  var __erpPrisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __erpPrismaSlowQueryLoggingAttached: boolean | undefined;
}

function slowQueryThresholdMs() {
  const parsed = Number(process.env.SLOW_QUERY_MS ?? 1_000);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1_000;
}

function prismaLogConfig() {
  return [
    { emit: "event" as const, level: "query" as const },
    { emit: "stdout" as const, level: "error" as const },
    ...(process.env.NODE_ENV === "production"
      ? []
      : [
          { emit: "stdout" as const, level: "warn" as const },
        ]),
  ];
}

export const prisma =
  globalThis.__erpPrisma ??
  new PrismaClient({
    log: prismaLogConfig(),
  });

let recordingSlowQuery = false;

function attachSlowQueryLogging(client: PrismaClient) {
  if (globalThis.__erpPrismaSlowQueryLoggingAttached) return;
  globalThis.__erpPrismaSlowQueryLoggingAttached = true;

  const queryEvents = client as unknown as { $on(event: "query", callback: (event: { duration: number }) => void): void };
  queryEvents.$on("query", (event) => {
    const thresholdMs = slowQueryThresholdMs();
    if (recordingSlowQuery || event.duration < thresholdMs) return;

    recordingSlowQuery = true;
    void client.securityEvent
      .create({
        data: {
          eventType: "slow_query",
          severity: "warning",
          requestId: `slow-query-${Date.now()}`,
          statusCode: 0,
          errorCode: "SLOW_QUERY",
          message: "Prisma query exceeded the slow query threshold.",
          metadata: {
            durationMs: event.duration,
            thresholdMs,
          },
        },
      })
      .catch((error) => {
        console.warn("[prisma] slow query event write failed", error);
      })
      .finally(() => {
        recordingSlowQuery = false;
      });
  });
}

attachSlowQueryLogging(prisma);

if (process.env.NODE_ENV !== "production") {
  globalThis.__erpPrisma = prisma;
}
