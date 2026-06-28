# 경비 결재 워크플로우 설계 (Expense Approval Workflow)

작성일: 2026-06-28

## 목표
하드코딩된 보고서 1건을 보여주던 데모를, **담당자가 경비를 상신 → 결재자가 검토·승인/반려 → 작성자가 결과 확인**하는 실제 업무 시스템으로 전환한다.

## 확정 결정
- **결재선**: 조직도 기반 자동 배정
- **단계**: 2단계 — (1차) 상신자의 직속 상위자 `managerUid` → (2차) 재무팀 풀(role=finance 누구나)
- **증빙**: 실제 파일 업로드, 저장소는 **Vercel Blob** (Firebase Storage는 Blaze 필요로 회피)
- **admin 화면**: MVP 포함
- **반려 후 수정·재상신**: MVP 포함

## 역할
| 역할 | 권한 |
|---|---|
| employee | 경비 상신, 내 보고서 조회 |
| (manager) | 별도 역할 아님 — 누군가의 `managerUid`이면 그 사람의 1차 결재자 |
| finance | 2차(최종) 결재, 재무 결재함 |
| admin | 사용자·조직도 관리(역할/소속/상위자) |

모든 사용자는 상신 가능. 1차 결재자는 역할이 아니라 `managerUid` 관계로 결정.

## 결재 흐름
```
담당자 상신 → status=검토대기
  (1차) 직속 상위자 승인 → (2차) 재무 승인 → status=승인 (완료)
       ↓ 반려                    ↓ 반려
     status=반려, 작성자에게 반송 → 작성자 수정 후 재상신(→ 처음부터 다시)
```

## 데이터 모델 (Firestore)
- `users/{uid}`: `name`, `team`, `role`(employee|finance|admin), `managerUid`(string|null), `email`
- `reports/{docNo}`: `title`, `period`, `authorUid`, `author`{name,team,role,initial}, `total`, `limit`, `usage`, `itemCount`, `flagCount`, `status`(검토대기|승인|반려), `decision`(approved|rejected|null), `pendingUid`(현재 1차 결재자 uid|null), `pendingRole`('finance'|null — 2차 대기 표시), `createdAt`, `submittedAt`, `categories`[]
- `reports/{docNo}/items/{id}`: `date`, `category`, `desc`, `amount`, `receiptUrl`(string|null), `hasReceipt`, `flagged`, `flagReason`
- `reports/{docNo}/approvals/{idx}`: `order`, `step`, `person`, `approverUid`, `state`, `tone`, `at`, `comment`
- `counters/expenseSeq`: `{ year, seq }` — 문서번호 발번(EXP-2026-0001 …)

## 화면 (라우트)
| 경로 | 화면 | 접근 |
|---|---|---|
| `/` | 대시보드 — 내 결재 대기 수, 내 보고서 수, 역할별 바로가기 | 전체 |
| `/new` | 경비 상신 — 헤더(제목·기간) + 항목 편집(날짜/분류/내역/금액/영수증 업로드) + 제출 | 전체 |
| `/my` | 내 보고서 — 내가 올린 보고서 + 상태. 반려건은 "수정·재상신" | 전체 |
| `/inbox` | 결재함 — 내 차례 보고서 목록(1차: 내 부하 / 2차: 재무 대기) | 결재자/finance |
| `/r/[docNo]` | 결재 상세 — A 레이아웃(동적), 영수증 열람, 승인/반려(권한자만) | 전체(권한자만 액션) |
| `/admin` | 사용자 관리 — 역할·소속·상위자 설정 | admin |
| `/login` | 로그인 (기존) | 비로그인 |

기존 B·C·모바일 레이아웃은 `/r/[docNo]`의 보기 전환으로 보존(선택, 필수 아님).

## 핵심 로직
1. **상신 (`submitReport` server action)**: 트랜잭션으로
   - `counters/expenseSeq` 증가 → docNo 발번
   - reports 문서 생성(authorUid, author, status=검토대기, pendingUid=author.managerUid, pendingRole=null)
   - items 작성(receiptUrl 포함), categories 집계, flag 판정(영수증 미첨부 등)
   - approvals 생성: [기안=author/done, 1차=managerUid/current, 2차=재무/wait]
2. **영수증 업로드 (`/api/upload` route)**: 클라이언트가 파일 전송 → 서버가 Vercel Blob에 저장 → URL 반환 → 상신 시 item.receiptUrl로 저장. (`@vercel/blob`, `BLOB_READ_WRITE_TOKEN`)
3. **결재 (`submitDecision` 확장)**: 1차는 `pendingUid==나`만, 2차는 `role==finance`만. 승인 시 다음 단계로(1차→2차: pendingUid=null, pendingRole='finance'; 2차→완료: status=승인). 반려 시 status=반려, decision=rejected, pending* 비움.
4. **결재함 쿼리**: `reports where pendingUid==나 && status==검토대기` (1차) + `reports where pendingRole=='finance' && status==검토대기`(내가 finance일 때) 두 쿼리 합치기. 복합 색인 필요.
5. **수정·재상신**: 반려 보고서의 작성자가 `/new`에 기존 내용 로드 → 수정 후 재제출 → 결재선 초기화, status=검토대기.

## 보안
- 클라이언트 Firebase SDK는 **Auth(로그인)에만** 사용. **모든 Firestore 읽기/쓰기는 서버(Admin SDK)** 경유.
- Firestore 보안 규칙: **클라이언트 직접 접근 전면 차단**(read/write 모두 deny). 권한 검증은 서버 코드에서:
  - `/r/[docNo]` 조회: 작성자 본인 / 결재 라인 / finance / admin 만
  - `/inbox`,`/my`: 세션 uid 기준 필터
- 영수증 Blob: 비공개 업로드, 서명 URL 또는 서버 프록시로 열람(권한 확인 후).

## 기존 코드 재사용/변경
- 재사용: `ClassicView`(→ `/r/[docNo]`), `primitives`, `ApprovalActions`, `lib/auth`, `firebaseAdmin`, 디자인 토큰
- 변경: `lib/data.ts`(다중 보고서 조회 + 목록 쿼리), `actions.ts`(submitReport 추가, submitDecision 일반화), `types.ts`(User에 managerUid, Report에 authorUid/pending*), `firestore.rules`(전면 차단)
- 신규: `/new`, `/my`, `/inbox`, `/admin`, `/api/upload`, 대시보드(`/`)

## MVP 비포함(차후)
- B/C/모바일 레이아웃 전환(상세에서)
- 알림(이메일/푸시), 검색·필터 고도화, 첨부 다중/미리보기, 결재 의견 이력 타임라인

## 성공 기준
- employee 계정으로 `/new`에서 영수증 포함 경비 상신 → Firestore에 보고서 생성, 상위자에게 라우팅
- 상위자 계정 `/inbox`에 해당 건 표시 → 승인 → 재무 단계로 이동
- finance 계정 `/inbox`에 표시 → 승인 → status=승인
- 반려 시 작성자 `/my`에서 확인 후 수정·재상신
- admin이 `/admin`에서 사용자 역할·상위자 변경 가능
- 비인가 사용자는 타인 보고서 접근 불가
