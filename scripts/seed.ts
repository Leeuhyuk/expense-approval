// Firestore 시드 스크립트 — README 샘플 보고서를 DB에 입력.
// 실행: npm run seed   (= node --env-file=.env.local scripts/seed.ts)
//
// 구조:
//   reports/{docNo}                  헤더 + author(중첩) + categories(배열)
//   reports/{docNo}/items/{id}       경비 항목
//   reports/{docNo}/approvals/{idx}  결재선(순서 보존용 0,1,2,...)
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { SAMPLE_REPORT } from "../src/lib/sample-data.ts";

const privateKey = process.env.FB_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert({
        projectId: process.env.FB_ADMIN_PROJECT_ID,
        clientEmail: process.env.FB_ADMIN_CLIENT_EMAIL,
        privateKey,
      }),
    });

const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

async function main() {
  const r = SAMPLE_REPORT;
  const reportRef = db.collection("reports").doc(r.docNo);

  // 헤더 (items/approvalChain 제외, categories는 배열로 임베드)
  const { items, approvalChain, ...header } = r;
  await reportRef.set(header);

  // 경비 항목
  const itemsBatch = db.batch();
  for (const it of items) {
    itemsBatch.set(reportRef.collection("items").doc(it.id), it);
  }
  await itemsBatch.commit();

  // 결재선 (인덱스로 순서 보존)
  const apprBatch = db.batch();
  approvalChain.forEach((step, i) => {
    apprBatch.set(reportRef.collection("approvals").doc(String(i)), { order: i, ...step });
  });
  await apprBatch.commit();

  console.log(`✓ 시드 완료: reports/${r.docNo} (항목 ${items.length}, 결재선 ${approvalChain.length})`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("✗ 시드 실패:", e);
    process.exit(1);
  });
