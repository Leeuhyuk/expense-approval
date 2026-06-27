import type { Report } from "./types";

/**
 * README "Shared Data Model"의 샘플 보고서.
 * Firestore 시드(seed) 및 화면 개발용 기준 데이터.
 */
export const SAMPLE_REPORT: Report = {
  docNo: "EXP-2026-0612",
  title: "2026년 2분기 영업 출장 경비 정산",
  status: "검토 대기",
  author: { name: "김민준", team: "영업1팀", role: "사원", initial: "김" },
  period: "2026.06.10 – 06.21",
  submittedAt: "2026.06.25 14:32",
  total: 1_511_500,
  limit: 2_000_000,
  usage: 75.6,
  itemCount: 7,
  flagCount: 2,
  decision: null,
  items: [
    { id: "i1", date: "06.10", category: "교통", desc: "KTX 서울 → 부산 · 왕복", amount: 226_000, hasReceipt: true, flagged: false },
    { id: "i2", date: "06.10", category: "숙박", desc: "부산 그랜드 호텔 · 2박", amount: 340_000, hasReceipt: true, flagged: false },
    { id: "i3", date: "06.11", category: "식대", desc: "거래처 미팅 오찬 · 4인", amount: 182_000, hasReceipt: true, flagged: true, flagReason: "1인 한도(30,000원) 초과 — 45,500원" },
    { id: "i4", date: "06.12", category: "교통", desc: "택시 · 공항 ↔ 부산지사", amount: 48_500, hasReceipt: true, flagged: false },
    { id: "i5", date: "06.18", category: "접대", desc: "파트너사 만찬 · 6인", amount: 512_000, hasReceipt: false, flagged: true, flagReason: "법인카드 영수증 미첨부 — 추가 증빙 필요" },
    { id: "i6", date: "06.20", category: "기타", desc: "산업전시회 입장권", amount: 90_000, hasReceipt: true, flagged: false },
    { id: "i7", date: "06.21", category: "교통", desc: "KTX 부산 → 서울", amount: 113_000, hasReceipt: true, flagged: false },
  ],
  categories: [
    { category: "접대", amount: 512_000, ratio: 33.9 },
    { category: "교통", amount: 387_500, ratio: 25.6 },
    { category: "숙박", amount: 340_000, ratio: 22.5 },
    { category: "식대", amount: 182_000, ratio: 12.0 },
    { category: "기타", amount: 90_000, ratio: 6.0 },
  ],
  approvalChain: [
    { step: "기안", person: { name: "김민준", team: "영업1팀", role: "사원", initial: "김" }, state: "완료", tone: "done", at: "06.25" },
    { step: "1차 결재", person: { name: "이서연", team: "영업1팀", role: "팀장", initial: "이" }, state: "검토 중", tone: "current", at: "지금" },
    { step: "2차 결재", person: { name: "박지훈", team: "영업본부", role: "본부장", initial: "박" }, state: "대기", tone: "wait", at: "—" },
    { step: "비용 검수", person: { name: "재무팀", team: "재무팀", role: "정산 검수", initial: "재" }, state: "대기", tone: "wait", at: "—" },
  ],
};
