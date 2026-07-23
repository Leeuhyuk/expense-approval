import { buildApp } from "./app.js";
import { ensureBudgetsForActiveDepartments } from "./routes/pageResources.js";

const app = await buildApp();
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";

// 모든 활성 부서가 결제 요청을 제출할 수 있도록 예산이 없는 부서에 기본 예산을 보장한다.
try {
  await ensureBudgetsForActiveDepartments();
} catch (error) {
  app.log.warn({ err: error }, "default budget backfill failed");
}

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
