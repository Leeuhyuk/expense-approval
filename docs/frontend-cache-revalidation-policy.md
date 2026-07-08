# Frontend Cache Revalidation Policy

작성일: 2026-07-08

이 문서는 화면별 캐시 무효화, 재검증, stale data 표시 기준을 정의한다. 목적은 버튼 클릭 후 화면만 바뀌고 backend, DB, file storage 원본과 어긋나는 상태를 운영 완료로 보지 않도록 고정하는 것이다.

## 기본 원칙

- 업무 데이터 row는 remote mode에서 backend API 응답을 원본으로 삼는다. React state는 화면 렌더링 snapshot이며 장기 저장소가 아니다.
- `localStorage`는 `erp-table-state:{pageKey}` 검색/필터/정렬/페이지 크기 복원, `erp-favorite-route-state` 라우팅 보조, 파일 업로드 recovery metadata처럼 사용자 편의 상태만 저장한다.
- 생성, 수정, 삭제, 상태 변경, 파일 완료, 예약 job 실행 같은 mutation은 성공 후 관련 화면의 cache를 무효화하고 `listPageRows` 또는 전용 GET API로 재검증한다.
- `useManagedTable` 화면은 mutation 직전 rows, 선택, total snapshot을 보관한다. 실패하면 snapshot을 복원하고 `listPageRows`를 다시 호출해 서버 원본에 수렴한다.
- `rowVersion`, 최신 감사 로그 id, idempotencyKey replay/conflict 기준이 맞지 않으면 stale 상태로 본다. 이때 임시 row를 병합하지 않고 stale 메시지, `requestId`, 수동 새로고침 경로를 표시한다.
- 새로고침, 재로그인, 다른 브라우저 접속, 브라우저 포커스 복귀, 수동 새로고침은 모두 backend 재조회 결과를 우선한다.

## Screen Policy

| 화면 | 원본 API/cache 단위 | 무효화 trigger | 재검증 방법 | stale data 표시 | cross-screen invalidation |
| --- | --- | --- | --- | --- | --- |
| 대시보드 | `/dashboard`, 결제 요청, 승인, 예산, 알림 요약 | 결제 요청 제출, 승인/반려, 지급 상태 변경, 예산 조정, 알림 처리 | 대시보드 진입/새로고침/포커스 복귀 시 전용 GET 재호출 | KPI 산출 실패 또는 `requestId` 있는 부분 실패 banner | 결제 요청, 승인 관리, 지급 관리, 예산 관리 mutation 후 대시보드 cache 무효화 |
| 결제 요청 | `listPageRows("payment-request")`, master data, attachment metadata | 임시 저장, 제출, 재상신, 거래처 추가, 파일 업로드 완료/삭제 | 목록 `listPageRows`, 선택 row PATCH/POST 응답 검증, master data 재조회 | `rowVersion` 충돌, 첨부 완료 전 제출 차단, 재조회 안내 | 거래처 추가 후 거래처 master data와 결제 요청 form option 무효화 |
| 승인 관리 | `listPageRows("approval")`, approval step detail | 승인, 반려, 보류, 일괄 승인 | action 후 목록과 상세 패널 재조회 | 권한 실패, 이미 처리된 단계, stale 결재선 메시지 | 최종 승인 후 결제 요청, 지급 관리, 대시보드, 알림 cache 무효화 |
| 지급 관리 | `listPageRows("disbursement")`, 계좌 상태, 은행 export/reconcile 결과 | 지급 실행, 보류, 재처리, 계좌 재확인, 예정일 변경 | 목록 재조회, 선택 지급 row 재조회, export/reconcile 결과 확인 | 계좌 상태 불일치, 재처리 중복, stale 지급 상태 표시 | 지급 완료/보류 후 대시보드, 보고서, 재무 대사 cache 무효화 |
| 예산 관리 | `listPageRows("budget")`, budget adjustment ledger | 예산 등록, 수정, 조정 승인/반려/취소, 마감/재오픈 | 목록과 조정 이력 재조회 | 사용률 계산 기준 시각과 최신 rowVersion 안내 | 결제 요청 승인 완료, 예산 조정 후 대시보드/보고서 cache 무효화 |
| 거래처 관리 | `listPageRows("vendors")`, vendor detail, attachment metadata | 신규 등록, 수정, 비활성화, 계좌 재확인, 파일 업로드 완료/삭제 | 목록 재조회, 결제 요청 master data 재조회 | 중복 사업자번호/계좌, stale 계좌 상태, `requestId` 표시 | 거래처 변경 후 결제 요청 form, 지급 관리, 보고서 필터 cache 무효화 |
| 보고서 | `listPageRows("reports")`, `ReportRun`, schedules, artifact download | 보고서 생성/수정/삭제, 별표, 예약 추가/수정/중지, 다운로드 생성 | 목록 재조회, schedule 재조회, artifact metadata 확인 | 생성 시점 snapshot, 만료 artifact, stale schedule 표시 | 지급/승인/예산 변경 후 새 report run 생성 전 기존 run은 snapshot으로 표시 |
| 즐겨찾기 | `listPageRows("favorites")`, route state | 바로가기 추가/삭제/순서 변경/열기 사용 기록 | 목록 재조회, route state는 보조로만 사용 | 삭제된 대상 route 또는 권한 변경 메시지 | 보고서 별표 변경, 권한 변경 후 즐겨찾기 cache 무효화 |
| 시스템 설정 | `/settings/config`, `/settings/roles`, `/settings`, operations APIs | 정책 저장, 권한 group 변경, 사용자 권한 변경, job 실행, 운영 모드 변경 | 설정 snapshot, 역할 목록, 사용자 목록, 이력 재조회 | 세션 revoke, 권한 stale, 저장 실패 시 원본 snapshot 복원 | 권한 변경 후 모든 업무 화면 권한 상태 재검증 및 재로그인 요구 |
| 파일/증빙 | `/files/presign`, object storage, `Attachment` metadata | presign, upload, complete, delete, download | complete 후 attachment metadata 재조회, download 전 signed URL 재발급 | scan pending/failed, 만료 URL, 삭제된 파일, 접근 거부 메시지 | 결제 요청/거래처 파일 변경 후 해당 row와 감사 로그 cache 무효화 |
| 알림/감사 | `/notifications`, `/operations/audit-logs`, security events | 업무 action, 읽음 처리, 운영 job, 파일 다운로드 | 알림 목록과 감사 검색 재조회 | 동일 `requestId`가 없는 실패는 미완료 상태로 표시 | 모든 mutation 실패/성공 후 알림/감사 로그 조회 기준 유지 |

## Mutation Flow

1. 버튼 클릭 직전 현재 row snapshot, 선택 상태, total, panel draft를 보관한다.
2. mutation 요청에는 idempotencyKey와 가능한 경우 `rowVersion` 또는 최신 원본 기준을 포함한다.
3. 성공 응답이 갱신 row를 포함해도 관련 list cache는 무효화한다. 서버가 row를 반환하지 않으면 즉시 `listPageRows`로 재조회한다.
4. 실패 응답은 화면 임시 상태를 완료 처리하지 않는다. snapshot 복원, 재조회, 표준 오류 메시지, `requestId`를 같이 표시한다.
5. 부분 실패는 성공 row와 실패 row를 분리해 표시하고 실패 row 선택을 유지한다.

## Revalidation Triggers

- 수동 새로고침 버튼: 현재 화면 list/detail/master data를 모두 재조회한다.
- 재로그인: localStorage 편의 상태만 유지하고 업무 데이터는 첫 진입 시 전부 재조회한다.
- 브라우저 포커스 복귀: 최근 mutation 또는 5분 이상 경과한 화면은 재검증한다.
- 다른 브라우저에서 변경: `rowVersion` 불일치 또는 action conflict 응답을 stale로 표시하고 최신 목록 재조회 버튼을 제공한다.
- 파일 업로드 화면 이탈 복귀: recovery metadata를 보여주되 완료 여부는 backend `Attachment` metadata와 object storage 상태로 확인한다.

## Completion Criteria

- 화면별 버튼 map에 backend route 또는 허용된 local-only 상태가 명시되어야 한다.
- `docs/button-action-map.md`의 업무 mutation은 이 문서의 무효화/재검증 기준 중 하나를 따라야 한다.
- 운영 문서 검증은 `useManagedTable`, `erp-table-state`, `listPageRows`, `rowVersion`, `stale`, `수동 새로고침`, `재로그인`, `파일 업로드`, `cross-screen invalidation`, `requestId` 기준을 확인한다.
- 실제 완료 판정은 `ERP_TEST_DATABASE_URL`이 있는 remote UI persistence E2E에서 새로고침, 재로그인, 다른 브라우저 접속 후 데이터 유지가 통과해야 한다.