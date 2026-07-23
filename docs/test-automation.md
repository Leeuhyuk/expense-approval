# Test Automation

작성일: 2026-07-04

이 문서는 ERP 기능화 작업의 1차 자동화 테스트 기준이다.

## 실행 명령

```powershell
npm test
```

세부 실행:

```powershell
npm run test:unit
npm run test:e2e
npm run test:integration
```

## 단위 테스트 범위

위치: `tests/unit`

- 업무 상태 규칙: 결제 요청 저장/제출, 승인 처리, 지급 실행/보류 가능 조건
- 권한 규칙: wildcard 관리자 권한, 요청자 메뉴 접근 제한, 기본 진입 메뉴
- 첨부파일 규칙: 허용 확장자, 10MB 제한, 성공/실패 분리, 파일 크기 표시, 바이러스 검사 대상, PDF 미리보기, 세금계산서 분류
- 포맷터 규칙: 원화 표시, 날짜 표시, 금액/날짜/문자열 테이블 정렬 비교
- mock API 계층: 목록, 상세, 생성, 수정, 액션 실행, 삭제 패턴
- 보안/예외 규칙: 비밀번호 정책, 저장 중 이탈, 관리자 수동 복구, 데이터 정합성 정책
- 운영 준비 점검: `/api/operations/alerts`, `/api/operations/business-failure-alerts`, `/api/operations/data-quality`, health endpoint 권한과 실패 응답 정책
- Go-live readiness gate: 23/24/25장 P0 미완료 항목을 production 후보, go-live 승인, 안정화 판정 범위별로 차단하는지 검증
- Mutation safety gate: backend `POST/PATCH/PUT/DELETE` route 전체가 표준 mutation, 위임 route, 읽기 전용 reject, 승인된 예외로 분류되고 `idempotencyKey`, 감사 로그, rowVersion/조건부 update/최신 audit id 증거를 갖는지 검증
- DB-backed release evidence gate: `v*` tag release candidate에서 `ERP_TEST_DATABASE_URL` 기반 실제 DB integration/remote UI E2E 실행 증적이 없거나 skip/stale이면 통과하지 않는지 검증
- Race condition 방어: 중복 클릭, 결제 요청 저장/제출, 예산 생성/수정, 파일 presign/complete/delete, 보고서 생성/예약/삭제, 즐겨찾기 생성/수정/삭제, 시스템 설정 스냅샷 저장, 동시 승인, 동시 지급, 동시 설정 변경의 idempotencyKey, rowVersion, 최신 AuditLog id, 조건부 update/delete 검증
- 검증 기준: 1,000/10,000건 테이블 fixture 정렬, 기본 색 대비 계산

## E2E 스모크 테스트 범위

위치: `tests/e2e/ui-smoke.test.mjs`

- Vite 개발 서버가 없으면 테스트가 직접 서버를 기동한다.
- 1440 x 900 viewport에서 대시보드 진입을 확인한다.
- 상단 알림 센터를 열고 알림 9건, 미확인 6건, 전체 읽음 후 배지 제거를 검증한다.
- 결제 요청 목록에서 금액 정렬과 목록 새로고침 버튼을 검증한다.
- 새 결제 요청을 생성하고 거래처, 부서, 금액, 요청 사유를 입력한 뒤 제출 완료 메시지를 검증한다.
- 승인 관리에서 내 요청 토글, 선택 행 일괄 승인, 부분 실패/감사 로그 메시지, 반려 사유 입력 후 반려 처리를 검증한다.
- 지급 관리에서 선택 행 일괄 지급, 부분 실패/재시도 메시지, 오류 건 재처리 차단 메시지, 계좌 재확인, 보류 사유 입력 후 보류 처리를 검증한다.
- 예산 관리에서 부서 선택, 조정 금액/사유 입력, 승인 필요 여부, 기간/부서/항목 필터 순환을 검증한다.
- 거래처 관리에서 검색, 거래처 추가, 사업자번호 중복 검증, 증빙 파일 업로드, 저장, 계좌 재확인, 비활성화를 검증한다.
- 보고서 화면에서 유형 필터, 보고서 생성, 검색/정렬/상세 미리보기, 예약 발송 추가와 API 연결 회귀 테스트를 검증한다.
- 보고서 화면에서 CSV와 PDF 다운로드가 실제 파일로 생성되는지 검증한다.
- 시스템 설정에서 탭 전환, 승인 한도 추가/직접 수정/삭제, 결재선 규칙 저장, 권한 그룹 상세 입력/사용자 추가, 알림/연동 저장, 정책 저장 이력을 검증한다.
- 즐겨찾기에서 자주 쓰는 메뉴/저장 필터 표시, 입력 기반 바로가기 추가, 중복 방지, 사용자별 저장, 순서 편집, 연결 필터, 비활성 기준, 삭제/undo를 검증한다.
- 1920 x 1080, 1280 x 800, 390 x 844 viewport에서 주요 라우트가 오류 없이 로드되는지 검증한다.
- 결제 요청 사유에 긴 문자열을 입력하고 값 보존과 키보드 포커스 이동을 검증한다.
- Vite/webpack/Next error overlay와 console error가 없는지 확인한다.

위치: `tests/e2e/remote-auth-smoke.test.mjs`

- `ERP_TEST_DATABASE_URL`이 설정된 폐기 가능한 test DB에서만 실행한다.
- backend test server와 Vite remote mode frontend를 별도 포트로 기동한다.
- test DB에 wildcard 권한 사용자를 생성하고 실제 `/auth/login`으로 브라우저 로그인을 수행한다.
- 새로고침 후 세션이 유지되는지, 설정 화면 접근 권한이 backend 세션/RBAC와 일치하는지, 로그아웃 후 로그인 화면으로 돌아오는지 검증한다.
- `ERP_TEST_DATABASE_URL`이 없으면 명시적으로 skip한다.

위치: `tests/e2e/remote-ui-persistence.test.mjs`

- `ERP_TEST_DATABASE_URL`이 설정된 폐기 가능한 test DB에서만 실행한다.
- backend test server와 Vite remote mode frontend를 별도 포트로 기동하고, 파일 저장소는 테스트 전용 local storage root로 분리한다.
- 브라우저에서 wildcard 권한 사용자로 로그인한 뒤 거래처 관리 화면의 `거래처 추가` 버튼, 기본 정보 입력, 증빙 파일 업로드, 저장 버튼을 실제 UI로 수행한다.
- 저장 후 새로고침과 검색을 거쳐 생성 거래처와 증빙 파일 metadata가 다시 표시되는지 확인한다.
- 결제 요청 화면에서 새 요청을 생성하고, backend master data의 거래처/부서/예산 항목을 선택한 뒤 증빙 파일 업로드와 제출을 실제 UI로 수행한다.
- 승인자 브라우저 세션 2개가 순차 승인한 뒤 두 번째 관리자 브라우저에서 승인 완료 상태가 유지되는지 확인한다.
- 지급 관리 화면에서 test DB seed 지급 건을 보류 처리하고 새로고침 후 보류 상태가 유지되는지 확인한다.
- Prisma로 `Vendor`, `Attachment`, 계좌 암호화/마스킹, 거래처 생성 감사 로그를 직접 대사한다.
- Prisma로 `PaymentRequest`, `ApprovalStep`, 결제 증빙 `Attachment`, `Disbursement`, 승인/지급 감사 로그를 직접 대사한다.
- `ERP_TEST_DATABASE_URL`이 없으면 명시적으로 skip한다.

## DB-backed release 증적

- `npm run release:db-test-evidence-run`은 `ERP_TEST_DATABASE_URL`이 설정된 폐기 가능한 PostgreSQL test DB에서 `npm run test:integration`, `node --test tests/e2e/remote-auth-smoke.test.mjs`, `node --test tests/e2e/remote-ui-persistence.test.mjs`를 실행한다.
- 실행 결과는 `release/db-test-evidence.json`에 저장하며, release identity, test DB URL fingerprint, 하네스 파일 SHA-256, 명령별 exit status, skip 여부, 필수 테스트명 출력을 포함한다.
- `REQUIRE_DB_TEST_EVIDENCE=true npm run release:db-test-evidence`는 증적 파일이 없거나, 현재 하네스 파일 checksum과 다르거나, 세 명령 중 하나라도 skip/실패/필수 출력 누락이면 release candidate를 실패 처리한다.
- 로컬 audit mode에서는 증적 파일이나 test DB URL이 없어도 warning만 출력하되, 실제 운영 승인에는 strict mode 증적을 사용한다.

## DB 통합 테스트 범위

위치: `tests/integration`

- `ERP_TEST_DATABASE_URL`이 설정된 폐기 가능한 test DB에서만 실행한다.
- `backendDataPersistence.test.ts`는 실제 로그인/CSRF 세션으로 거래처를 생성하고, 새로고침/세션 refresh/새 로그인 후에도 DB와 감사 로그가 유지되는지 검증한다.
- `backendSettingsPersistence.test.ts`는 권한 그룹과 사용자 권한 변경이 DB rowVersion, idempotencyKey, 감사 로그와 함께 유지되는지 검증하고, 시스템 설정 스냅샷 저장의 최신 AuditLog id conflict와 idempotency replay를 DB 감사 로그로 대사한다.
- `backendNotificationOperationsFlow.test.ts`는 알림 단건 읽음이 같은 `readAt`으로 수렴하는지, 업무 실패 운영 알림 발송이 같은 window 안에서 담당자별 중복 알림을 만들지 않는지 test DB로 검증한다.
- `backendPaymentRequestFlow.test.ts`는 결제 요청 master data 조회, draft 생성, 실제 파일 presign/upload/complete, 제출, `ApprovalStep` 생성, 승인자 알림, 감사 로그를 Prisma로 직접 대사한다.
- `backendOperatingDataFlow.test.ts`는 예산 조정, 지급 보류, 보고서 생성, 보고서 예약 생성/수정/중지, 즐겨찾기 생성/열기/삭제가 실제 route를 거쳐 `BudgetAdjustment`, `Disbursement`, `ReportRun`, `ReportDefinition`, `ReportSchedule`, `FavoriteItem`, `AuditLog`, `Notification`에 저장되는지 대사한다.
- `ERP_TEST_DATABASE_URL`이 없으면 명시적으로 skip한다.

## 산출물

E2E 테스트는 검증 증거를 `generated-images/automated-tests`에 저장한다.

- `ui-smoke-reports.png`
- `ui-smoke-payment-request.png`
- `ui-smoke-approval.png`
- `ui-smoke-disbursement.png`
- `ui-smoke-budget.png`
- `ui-smoke-vendors.png`
- `ui-smoke-settings.png`
- `ui-smoke-favorites.png`
- `ui-viewport-1920.png`
- `ui-viewport-1280.png`
- `ui-viewport-mobile.png`
- `ui-smoke-long-input.png`
- `payment-approval-report.csv`
- `payment-approval-report.pdf`

## 1차 한계

- 1920, 1280, 모바일 회귀 테스트는 별도 viewport matrix로 확장한다.
- 대량 테이블 성능 테스트는 fixture 생성 후 별도 스크립트로 확장한다.
- remote auth/UI persistence E2E와 백엔드 DB 통합 테스트는 테스트 전용 PostgreSQL 연결이 준비된 환경에서만 실제 실행된다.
