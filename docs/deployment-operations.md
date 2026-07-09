# Deployment And Operations Runbook

작성일: 2026-07-04

이 문서는 결제 요청 승인 ERP의 1차 배포 및 운영 기준이다.

## 배포 방식

| 영역 | 방식 |
| --- | --- |
| Frontend | Vite 정적 빌드 산출물(`dist`)을 정적 호스팅에 배포 |
| Backend | Node.js 22+ 런타임에서 Fastify API 서버 실행 |
| Database | PostgreSQL, Prisma migration은 `migrate deploy`만 사용 |
| File storage | S3-compatible object storage, signed URL 방식 |
| Auth | HttpOnly Secure session cookie + RBAC |

## 운영 환경 변수

Frontend:

```env
VITE_ERP_API_MODE=remote
VITE_ERP_API_BASE_URL=https://api.example.com/api
```

Release gate:

```env
EXPECTED_PRODUCTION_API_BASE_URL=https://api.example.com/api
EXPECTED_PRODUCTION_FRONTEND_ORIGIN=https://erp.example.com
PRODUCTION_ENVIRONMENT_INVENTORY_PATH=docs/production-environment-inventory-template.md
STAGING_SMOKE_EVIDENCE_PATH=docs/staging-smoke-evidence-template.md
BACKUP_RESTORE_EVIDENCE_PATH=docs/backup-restore-rehearsal-template.md
DATA_MIGRATION_EVIDENCE_PATH=docs/data-migration-evidence-template.md
ROLE_UAT_EVIDENCE_PATH=docs/role-uat-evidence-template.md
PRODUCTION_GO_LIVE_EVIDENCE_PATH=docs/production-go-live-evidence-template.md
POST_GO_LIVE_STABILIZATION_EVIDENCE_PATH=docs/post-go-live-stabilization-evidence-template.md
FINAL_ACCEPTANCE_EVIDENCE_PATH=docs/final-acceptance-evidence-template.md
RELEASE_NOTE_PATH=docs/release-note-template.md
PRODUCTION_ACCESS_REVIEW_APPROVED=true
PRODUCTION_ACCESS_REVIEW_ID=ACCESS-YYYY-MM-GOLIVE
PRODUCTION_ACCESS_REVIEW_APPROVER=security-owner@example.com
```

Backend:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/payment_approval_erp?schema=public&sslmode=require
PORT=4000
HOST=0.0.0.0
FRONTEND_ORIGIN=https://erp.example.com
NODE_ENV=production
SESSION_IDLE_MINUTES=30
SESSION_ABSOLUTE_MINUTES=720
API_BODY_LIMIT_BYTES=11534336
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=600
FILE_STORAGE_DRIVER=s3
S3_ENDPOINT=https://s3.example.com
S3_BUCKET=payment-approval-erp-files
S3_BUCKET_PUBLIC_ACCESS_BLOCKED=true
S3_SERVER_SIDE_ENCRYPTION_ENABLED=true
S3_REGION=ap-northeast-2
S3_ACCESS_KEY_ID=<secret-manager-value>
S3_SECRET_ACCESS_KEY=<secret-manager-value>
FILE_URL_SECRET=<secret-manager-value>
CSRF_SECRET=<secret-manager-value>
BANK_ACCOUNT_SECRET=<secret-manager-value>
FILE_SCAN_MODE=external
MALWARE_SCAN_ENDPOINT=https://scanner.example.com/scan
MALWARE_SCAN_TOKEN=<secret-manager-value>
REPORT_JOB_WORKER_ENABLED=true
REPORT_QUEUE_URL=<queue-or-worker-control-plane-url>
REPORT_DELIVERY_MODE=internal
REPORT_DELIVERY_WEBHOOK_URL=
REPORT_DELIVERY_WEBHOOK_TOKEN=<secret-manager-value-if-webhook>
REPORT_JOB_BATCH_SIZE=10
REPORT_JOB_MAX_ATTEMPTS=3
REPORT_JOB_TIMEOUT_MS=30000
REPORT_JOB_RETRY_BASE_SECONDS=300
REPORT_JOB_RETRY_MAX_SECONDS=3600
REPORT_JOB_CIRCUIT_FAILURE_THRESHOLD=5
REPORT_JOB_CIRCUIT_WINDOW_MINUTES=15
PERFORMANCE_P95_TARGET_MS=800
PERFORMANCE_P99_TARGET_MS=1500
REPORT_JOB_MAX_PROCESSING_MS=120000
REPORT_DOWNLOAD_MAX_ROWS=5000
REPORT_DOWNLOAD_MAX_BYTES=3145728
ERP_ACCOUNTING_TOKEN=<secret-manager-value>
ERP_BANK_API_TOKEN=<secret-manager-value>
BANK_ACCOUNT_VERIFICATION_MODE=external
BANK_ACCOUNT_VERIFICATION_ENDPOINT=https://bank.example.com/account-verification
ERP_BANK_HOLIDAYS=2026-01-01,2026-02-16
ERP_TAX_INVOICE_TOKEN=<secret-manager-value>
SLOW_QUERY_MS=1000
ALERT_WINDOW_MINUTES=15
ALERT_API_5XX_THRESHOLD=1
ALERT_SLOW_QUERY_THRESHOLD=1
ALERT_LOGIN_FAILURE_THRESHOLD=10
ALERT_PERMISSION_FAILURE_THRESHOLD=10
ALERT_FILE_UPLOAD_FAILURE_THRESHOLD=1
ALERT_APPROVAL_FAILURE_THRESHOLD=1
ALERT_DISBURSEMENT_FAILURE_THRESHOLD=1
ALERT_REPORT_FAILURE_THRESHOLD=1
ALERT_NOTIFICATION_FAILURE_THRESHOLD=1
ALERT_FILE_PROCESSING_FAILURE_THRESHOLD=1
LOGIN_FAILURE_LOCK_THRESHOLD=5
LOGIN_FAILURE_WINDOW_MINUTES=15
DORMANT_ACCOUNT_DAYS=90
PASSWORD_MIN_LENGTH=12
PASSWORD_MAX_AGE_DAYS=90
OFFBOARDING_USER_EMAILS=
TERMINATED_USER_EMAILS=
```

Production에서는 `DEV_LOGIN_PASSWORD`와 `ALLOW_PRODUCTION_SEED`를 사용하지 않는다. 로그인은 `User.passwordHash`의 scrypt hash 검증 또는 승인된 SSO 연동으로 처리하고, 세션은 서버 메모리가 아니라 DB `auth_sessions`에 저장한다. 최근 로그인 실패는 `security_events` 기준으로 집계하며 `LOGIN_FAILURE_LOCK_THRESHOLD`회 이상이면 `LOGIN_FAILURE_WINDOW_MINUTES` 동안 계정을 잠그고, `DORMANT_ACCOUNT_DAYS` 동안 로그인하지 않은 계정은 휴면으로 차단한다. 비밀번호는 `PASSWORD_MIN_LENGTH` 길이와 대문자/소문자/숫자/특수문자 조합을 요구하고, `PASSWORD_MAX_AGE_DAYS`가 지나면 로그인 전 변경을 강제한다. 비밀번호 변경은 감사 로그와 다른 활성 세션 revoke를 남긴다. `OFFBOARDING_USER_EMAILS` 또는 `TERMINATED_USER_EMAILS`에 승인된 퇴사자 이메일 목록을 넣으면 시스템 설정의 계정 수명주기 배치가 해당 계정을 비활성화하고 세션을 종료한다. `FRONTEND_ORIGIN`은 HTTPS origin allowlist여야 하며, mutation API는 signed double-submit CSRF token을 요구한다. `DATABASE_URL`은 `sslmode=require`, `verify-ca`, `verify-full`, `sslaccept=strict` 또는 `PGSSLMODE`로 TLS를 강제해야 한다. 운영 계정은 요청자, 승인자, 재무팀, 관리자, 외부 감사 역할별 최소 권한 정책과 실제 사용자 배정 목록을 보안/운영 책임자가 승인한 뒤 `PRODUCTION_ACCESS_REVIEW_APPROVED`, `PRODUCTION_ACCESS_REVIEW_ID`, `PRODUCTION_ACCESS_REVIEW_APPROVER` 증빙을 release 환경에 설정해야 한다. API 서버는 10MB 첨부 정책을 수용하는 body limit과 health check를 제외한 기본 rate limit을 적용한다. 거래처 계좌번호는 `BANK_ACCOUNT_SECRET`으로 암호화 저장하며, 은행 이체 파일 생성은 복호화 가능한 검증 계좌만 허용한다. 목록, 상세, 감사 로그, 오류 메시지, 운영 점검 요약, 브라우저 콘솔에는 원문 계좌번호나 주민등록번호 형태의 개인정보가 남지 않아야 하며, 은행 이체 CSV는 `disbursement:execute` 권한과 감사 로그가 붙는 통제 예외로만 허용한다. 파일 본문은 server-side encryption 또는 동등한 at-rest encryption이 켜진 S3-compatible private bucket에 저장하고, backend만 object storage credential로 접근한다. 브라우저에는 object storage 직접 URL을 반환하지 않고 파일별 권한 검증 후 10분 만료 API signed path만 반환한다. 저장 전 외부 malware scanner가 HTTPS endpoint에서 `clean` verdict를 반환해야 업로드가 완료된다.

기본 역할 권한은 `src/domain/rolePolicy.ts`가 단일 기준이다.

| 역할 | 기본 권한 |
| --- | --- |
| 요청자 | 대시보드, 즐겨찾기, 본인 결제 요청 생성/조회/수정/제출 |
| 승인자 | 대시보드, 즐겨찾기, 배정된 승인 조회/처리 |
| 재무팀 | 대시보드, 즐겨찾기, 전체 결제 요청 조회, 지급 조회/실행/보류, 예산/거래처/보고서 조회 |
| 외부 감사 | 대시보드, 즐겨찾기, 보고서 조회, 감사 조회 |
| 관리자 | 전체 권한 |

## 배포 전 검증 게이트

루트에서 실행:

```powershell
npm run release:check
npm run release:migration-check
npm run release:audit-append-only
npm run release:mutation-safety
npm run release:sensitive-data
npm run release:db-test-evidence
npm run release:performance-capacity
npm run release:operational-docs
npm run release:environment-inventory
npm run release:staging-smoke-evidence
npm run release:backup-restore-evidence
npm run release:data-migration-evidence
npm run release:role-uat-evidence
npm run release:production-go-live-evidence
npm run release:post-go-live-stabilization-evidence
npm run release:final-acceptance-evidence
npm run release:go-live-handoff
npm test
npm run build
npm run release:frontend-artifact
npm run release:go-live-readiness
npm run release:go-live-readiness-report
npm run release:migration-review
npm run release:verify-migration-review
npm run release:manifest
npm run release:verify-manifest
```

백엔드에서 실행:

```powershell
npm --prefix backend run db:generate
npm --prefix backend run build
npm run release:backend-smoke
npm run release:core-smoke
```

DB migration 검토:

```powershell
npm run release:migration-review
npm --prefix backend run db:deploy
```

`db:deploy`는 staging에서 먼저 실행하고, 운영에는 동일 migration을 승인 후 적용한다.

운영 release candidate에서 `npm run release:check`는 `VITE_ERP_API_MODE=remote`, `EXPECTED_PRODUCTION_API_BASE_URL`과 일치하는 production API base URL, `EXPECTED_PRODUCTION_FRONTEND_ORIGIN`과 일치하는 CORS allowlist, HTTPS API/storage/scanner endpoint, TLS가 강제된 PostgreSQL `DATABASE_URL`, secret 길이, 운영 계정 권한 승인 증빙, `DEV_LOGIN_PASSWORD` 미사용, `ALLOW_PRODUCTION_SEED` 미설정, private object storage bucket 증적, object storage at-rest encryption 증적, 공개 object storage URL 설정 부재, 프론트 production 진입점의 `mockData`/`mockApi` 정적 import 제거를 확인한다. 또한 `RELEASE_VERSION`, `RELEASE_SOURCE_REF`, `RELEASE_GIT_COMMIT`과 frontend build의 `VITE_RELEASE_VERSION`, `VITE_RELEASE_SOURCE_REF`, `VITE_RELEASE_GIT_COMMIT`이 서로 같은지 확인해 frontend/backend가 같은 release identity로 배포되도록 한다. 또한 `EXPECTED_RELEASE_MANIFEST_SHA256`와 `EXPECTED_RELEASE_SOURCE_REF`를 필수로 요구하고 `release/release-manifest.json`, `release/migration-review.json`, `release/go-live-readiness-report.json`, `release/go-live-readiness-report.md`가 현재 산출물과 같은지 재검증해 staging에서 보관한 동일 artifact만 production 후보로 통과시킨다. 또한 `PRODUCTION_ENVIRONMENT_INVENTORY_PATH`로 지정한 운영 환경 inventory를 strict mode로 검증해 배포 플랫폼, production 도메인, DB, object storage, secret manager, monitoring/structured logs/alerting, backup/PITR/WAL, CDN/WAF, rollback 증적에 미확정 placeholder가 남아 있으면 실패한다. `prisma db seed`는 `NODE_ENV=production` 또는 `RELEASE_TARGET=production`이면 기본 차단되며, 임시 rehearsal override는 release 환경에 남겨 두지 않는다. 프론트 빌드 후에는 `npm run release:frontend-artifact`로 `dist`에 mock fixture, test email, local endpoint, seed marker, dev secret이 포함되지 않았는지와 `_headers`의 HTTPS/cache-control 보안 헤더 정책이 포함됐는지 확인한다. Production 후보에서는 `RELEASE_NOTE_PATH`로 지정한 release note가 기능 변경, DB 변경, 권한 변경, 운영 영향, known issue, rollback 조건을 확정해야 한다.
`npm run release:mutation-safety`는 backend `POST/PATCH/PUT/DELETE` route 전체가 표준 mutation, 위임 route, 읽기 전용 reject, 승인된 예외 중 하나로 분류되어 있고, 표준 mutation에는 `idempotencyKey`, 감사 로그, rowVersion/조건부 update/최신 audit id 중 필요한 증거가 남아 있는지 확인한다.
`npm run release:db-test-evidence-run`은 폐기 가능한 PostgreSQL `ERP_TEST_DATABASE_URL`에서 DB integration test, remote auth E2E, remote UI persistence E2E를 실제 실행하고 `release/db-test-evidence.json`을 생성한다. 이 증적에는 test DB URL fingerprint, release identity, 하네스 파일 SHA-256, 각 명령의 exit status, skip 여부, 필수 테스트명 출력이 포함된다. `npm run release:db-test-evidence`는 DB-backed integration test와 remote browser E2E harness가 유지되는지 점검하고, strict mode에서는 `release/db-test-evidence.json`이 현재 코드의 하네스 체크섬과 일치하며 세 명령이 모두 skip 없이 통과했는지 검증한다. 필수 integration harness는 거래처 persistence, 설정/권한 persistence, 결제 요청/파일/승인, 알림/운영 예외, 예산 조정/지급/보고서/즐겨찾기 운영 데이터 흐름을 포함한다. Remote browser E2E는 거래처 등록/증빙 업로드뿐 아니라 결제 요청 생성, 증빙 업로드, 제출, 승인자 순차 승인, 지급 보류, 새로고침, 두 번째 브라우저 재조회, Prisma DB/file/audit 대사를 포함해야 한다. 로컬 기본값은 audit 모드라 증적 파일이나 `ERP_TEST_DATABASE_URL`이 없으면 warning만 출력하지만, `REQUIRE_DB_TEST_EVIDENCE=true npm run release:db-test-evidence`는 실제 실행 증적이 없거나 stale이면 실패한다. CI의 `v*` release tag에서는 `release:db-test-evidence-run` 다음 strict 검증을 실행해 DB-backed 검증이 skip된 상태로 release candidate가 생성되지 않게 한다.
`npm run release:performance-capacity`는 list query pageSize 100 상한, shared pagination/filter/sort, payment request DB pagination, report download backend 생성/감사 로그, 보고서 직접 다운로드 row/byte 제한, p95/p99 목표, report job 최대 처리 시간, Prisma list/report index, 10MB upload policy, API body/rate limit release gate를 정적 검증하고, 기본 20,000건 목록 필터/정렬/page workload와 5,000행 보고서 다운로드 payload workload를 synthetic 기준 시간/크기 안에서 실행한다. 이 게이트는 로컬/CI 회귀 방어이며, staging과 production에서는 실제 DB row count, 네트워크, object storage, WAF/API gateway rate limit 기준으로 별도 부하 smoke를 실행한다.
`npm run release:core-smoke`는 `CORE_SMOKE_API_BASE_URL`, `CORE_SMOKE_EMAIL`, `CORE_SMOKE_PASSWORD`로 staging/production API health, 로그인, 알림, 주요 목록, 운영 상태 endpoint를 점검하고 각 결과의 requestId를 출력한다. Production go-live 증빙에는 이 출력 로그와 smoke 계정 역할을 보관한다.
`npm run release:operational-docs`는 `docs/user-manual.md`, `docs/admin-manual.md`, `docs/incident-response.md`, `docs/deployment-operations.md`, 버튼 액션 매핑, API/이관 문서가 핵심 화면, 권한, 파일, 보고서, requestId, health/data-quality/financial-reconciliation/financial-control-report/business-failure alert, rollback, release gate를 빠뜨리지 않는지 확인한다. 운영 인수 전에는 이 문서와 실제 화면/운영 절차를 함께 검토한다.
`npm run release:environment-inventory`는 `docs/production-environment-inventory-template.md`에 production 배포 플랫폼, 도메인, DB, object storage, secret manager, monitoring/structured logs/alerting, runtime scaling, security controls, backup/restore, external integrations, evidence link 섹션이 있는지 audit한다. Production release gate에서는 같은 검증이 strict mode로 실행되어 `TBD`, `pending`, `<...>` 같은 미확정 값이 남아 있으면 실패한다. 또한 production 도메인과 API/origin 값은 HTTPS non-local이어야 하고 `EXPECTED_*` 값과 일치해야 하며, `DATABASE_URL`과 application secret은 원문 값이 아닌 secret manager reference여야 한다. Object storage public access block/encryption, malware scanner HTTPS endpoint, backend scaling, body/rate limit 값도 구조적으로 검증한다. 실제 production 후보 전에는 `PRODUCTION_ENVIRONMENT_INVENTORY_PATH`로 완성된 inventory 파일을 지정한다.

`npm run release:environment-separation`은 `docs/environment-separation-matrix-template.md`에 dev/staging/production의 DB, object storage, auth/session, secret scope, domain/API origin, logs/monitoring, data policy가 서로 분리되어 있고 같은 artifact/migration promotion 증빙이 연결되는지 audit한다. Production release gate에서는 `ENVIRONMENT_SEPARATION_PATH`의 완성본을 strict mode로 검증해 placeholder, 중복 환경 리소스, staging raw production data 사용, non-HTTPS staging/production origin을 실패 처리한다.
`npm run release:staging-smoke-evidence`는 `docs/staging-smoke-evidence-template.md`에 동일 release artifact, staging 환경 분리, migration 적용, `/api/health` 계열, remote frontend, 결제 요청/첨부/승인/지급 보류/거래처/설정 권한/보고서/즐겨찾기 smoke, 새로고침/재로그인/다른 브라우저 유지, CSRF/signed URL/session 만료 보안 smoke, object storage/malware scanner 증적 섹션이 있는지 audit한다. Production release gate에서는 같은 검증이 strict mode로 실행되어 `TBD`, `pending`, `<...>` 같은 미확정 값이 남아 있거나 `Release manifest hash`와 `EXPECTED_RELEASE_MANIFEST_SHA256 promotion hash`가 다르거나, promotion decision이 `approved`가 아니거나, open blocker count가 `0`이 아니면 실패한다. 실제 production 후보 전에는 `STAGING_SMOKE_EVIDENCE_PATH`로 완성된 staging smoke 증빙 파일을 지정한다.
`npm run release:backup-restore-evidence`는 `docs/backup-restore-rehearsal-template.md`에 RPO/RTO, PostgreSQL full backup, WAL/PITR, object storage versioning, report artifact backup, staging restore rehearsal, row count/총액/예산/첨부 대사, migration failure/partial deploy/DB/object storage/API 장애 rollback rehearsal, backup 성공/실패 alert, backup 암호화, backup 접근 권한, restore 계정 권한 승인 섹션이 있는지 audit한다. Production release gate에서는 같은 검증이 strict mode로 실행되어 `TBD`, `pending`, `<...>` 같은 미확정 값이 남아 있으면 실패한다. 실제 production 후보 전에는 `BACKUP_RESTORE_EVIDENCE_PATH`로 완성된 백업/복구 리허설 증빙 파일을 지정한다.
`npm run release:data-migration-evidence`는 `docs/data-migration-evidence-template.md`에 원천 시스템, 이관 범위, freeze window, 컬럼 매핑, validation query, staging rehearsal, production row count/상태별 집계/총액/예산 잔액/거래처 지급 이력/첨부 orphan 대사, mock/local seed/test marker 제거, 계좌 암호화/마스킹, 개인정보 접근 권한, rollback/rerun, 담당자 승인 섹션이 있는지 audit한다. Production release gate에서는 같은 검증이 strict mode로 실행되어 `TBD`, `pending`, `<...>` 같은 미확정 값이 남아 있으면 실패한다. 실제 production 후보 전에는 `DATA_MIGRATION_EVIDENCE_PATH`로 완성된 데이터 이관 증빙 파일을 지정한다.
`npm run release:role-uat-evidence`는 `docs/role-uat-evidence-template.md`에 요청자/승인자/재무팀/관리자/외부 감사 실제 계정, 권한 경계, 파일럿 부서/기간, 실제 금액 지급 전 dry-run/제한 금액/테스트 계좌 정책, 결제 요청/첨부/예산/승인/반려/보류/지급 보류/은행 이체 파일/거래처/설정/보고서/감사 조회 시나리오, P0/P1 이슈 처리, 교육/지원, 최종 책임자 sign-off 섹션이 있는지 audit한다. Production release gate에서는 같은 검증이 strict mode로 실행되어 `TBD`, `pending`, `<...>` 같은 미확정 값이 남아 있으면 실패한다. 실제 production 후보 전에는 `ROLE_UAT_EVIDENCE_PATH`로 완성된 역할별 UAT 증빙 파일을 지정한다.
`npm run release:production-go-live-evidence`는 `docs/production-go-live-evidence-template.md`에 release version/source ref/git commit, manifest hash, migration review hash, frontend/backend/migration/env checksum, production migration deploy, `/api/health` 계열과 operations alert/data-quality, production frontend login/menu/payment/attachment/notification/report smoke, 업무 smoke, open P0/예외 승인, rollback owner/예상 시간/user notice/read-only 판단, change freeze/incident channel/status cadence/hypercare, 최종 production sign-off 섹션이 있는지 audit한다. Production release gate에서는 같은 검증이 strict mode로 실행되어 `TBD`, `pending`, `<...>` 같은 미확정 값이 남아 있으면 실패한다. 또한 release manifest hash와 `EXPECTED_RELEASE_MANIFEST_SHA256`의 64자리 SHA-256 형식 및 상호 일치, migration review hash 형식, release ref/commit/version env 일치, `VITE_ERP_API_MODE=remote`, production HTTPS API/frontend URL, `/api/health`와 frontend/business smoke의 pass-like 결과, numeric open P0 count와 승인 예외, evidence link, 최종 sign-off 시각/증적 링크를 구조적으로 검증한다. 실제 production 후보 전에는 `PRODUCTION_GO_LIVE_EVIDENCE_PATH`로 완성된 production go-live 증빙 파일을 지정한다.
`npm run release:post-go-live-stabilization-evidence`는 `docs/post-go-live-stabilization-evidence-template.md`에 운영 첫 주 로그인 실패, API 5xx, 승인 실패, 지급 실패, 파일 업로드 실패, 보고서 실패 daily check, 첫 지급 은행 결과/ERP 상태/AuditLog/거래처 지급 이력/report totals 대사, go-live 이후 production data backup/PITR, severity 기준, P0/P1 same-day response, requestId 문의 접수, hypercare processing count/failure count/average processing time/inquiry/remediation, 남은 backlog, 최종 sign-off 섹션이 있는지 audit한다. Production release gate에서는 같은 검증이 strict mode로 실행되어 `TBD`, `pending`, `<...>` 같은 미확정 값이 남아 있으면 실패한다. 안정화 판정 전에는 `POST_GO_LIVE_STABILIZATION_EVIDENCE_PATH`로 완성된 post go-live stabilization 증빙 파일을 지정한다.
`npm run release:release-note`는 `docs/release-note-template.md` 또는 `RELEASE_NOTE_PATH`가 가리키는 release note에 기능 변경, DB 변경, 권한 변경, 운영 영향, known issue, rollback 조건, 기능/보안/재무/운영 승인 섹션이 있는지 audit한다. Production release gate에서는 같은 검증이 strict mode로 실행되어 `TBD`, `pending`, `<...>` 같은 미확정 값이 남아 있거나 `RELEASE_NOTE_PATH`가 없으면 실패한다.
`npm run release:final-acceptance-evidence`는 `docs/final-acceptance-evidence-template.md`에 실제 production 사용자 결제 요청/증빙/승인자 처리/재무팀 지급 전 단계/보고서 업무 증적, DB/object storage 저장과 새로고침/재로그인/다른 기기 유지, 권한 없는 사용자 UI/API 차단, AuditLog/security_events/requestId, 중복 승인/중복 지급/승인 전 지급/마감 후 변경/계좌 불일치 지급 backend 차단, rollback/복구/읽기 전용/사용자 공지, 배포/모니터링/백업/장애 대응/사용자 지원 운영 인수, KPI/오류율, backlog/운영 릴리즈 계획, 최종 sign-off 섹션이 있는지 audit한다. Production release gate에서는 같은 검증이 strict mode로 실행되어 `TBD`, `pending`, `<...>` 같은 미확정 값이 남아 있으면 실패한다. 실사용 가능 최종 판정 전에는 `FINAL_ACCEPTANCE_EVIDENCE_PATH`로 완성된 final acceptance 증빙 파일을 지정한다.
`npm run release:go-live-handoff`는 `docs/go-live-handoff-template.md`에 release identity, 역할별 UAT, known issue, 우회 절차, rollback 기준, 지원 연락망, 최종 sign-off 섹션이 있는지 audit한다. Production release gate에서는 같은 검증이 strict mode로 실행되어 `TBD`, `pending`, `<...>` 같은 미확정 값이 남아 있으면 실패한다. 실제 go-live 전에는 `GO_LIVE_HANDOFF_PATH`로 담당자와 증적이 채워진 handoff 파일을 지정한다.
`npm run release:go-live-readiness`는 23/24/25장 P0 체크리스트를 집계한다. 기본 audit 모드는 미완료 P0를 출력만 하며, production 후보 판정 전에는 `READINESS_TARGET=production-candidate npm run release:go-live-readiness`, 운영 시작 승인 전에는 `READINESS_TARGET=go-live npm run release:go-live-readiness`, go-live 이후 안정화 판정 전에는 `READINESS_TARGET=stable-operation npm run release:go-live-readiness`를 통과해야 한다. `READINESS_APPROVAL_EXCEPTIONS_PATH` 또는 기본 `docs/release-approval-exceptions.json`에 owner, due date, 사용자 영향, 완화책, 승인 증적이 있는 조건부 예외가 있으면 gate는 open P0를 완료 처리하지 않고 `CONDITIONAL`로 분리한다. `RELEASE_TARGET=production npm run release:check`도 production 후보 범위의 미승인 P0가 있으면 실패한다.
`npm run release:go-live-readiness-report`는 `release/go-live-readiness-report.json`과 `release/go-live-readiness-report.md`에 체크리스트 SHA-256, 전체 open P0 blocker, 승인된 예외, 미승인 차단 항목, 목표별 차단 상태, section, 필요 증빙 category를 모두 남긴다. 기본 CLI preview처럼 25개까지만 자르지 않으므로, release evidence artifact와 운영 인수 자료에는 이 report를 함께 보관한다.
`npm run release:submission`은 `docs/release-submission-package.md`에 GitHub 제출 대상, 위임 승인 ID, target별 조건부 readiness 결과, 남은 strict evidence를 고정해 main 브랜치 제출 영수증으로 남긴다.
`npm run release:migration-review`는 각 migration SQL의 checksum, statement count, 주요 operation, 하위 호환 static guard 결과, rollback 영향, production seed 차단 증거를 `release/migration-review.json`에 기록한다. `npm run release:verify-migration-review`는 이 JSON을 현재 migration 파일과 다시 대사해 stale review, release version 불일치, backward compatibility 실패, rollback review 누락, production seed 차단 증거 누락을 차단한다. 이 파일은 release 승인 증적으로 보관하며, 운영 DB 적용 전에는 별도 DBA/운영 승인과 backup/PITR 또는 보정 migration 전략을 함께 확인한다.
`npm run release:manifest`는 frontend/backend/migration/release input 파일, `docs/release-submission-package.md`와 `release/migration-review.json`, `release/go-live-readiness-report.json`, `release/go-live-readiness-report.md` 증빙 파일의 checksum manifest를 생성하고 `RELEASE_SOURCE_REF` 또는 CI의 `GITHUB_REF_NAME`을 `sourceRef`로 기록한다. Manifest 생성 전에는 `npm run release:migration-review`와 `npm run release:go-live-readiness-report`를 먼저 실행해야 한다. `npm run release:verify-manifest`는 현재 산출물과 release evidence가 manifest와 일치하는지 다시 계산하며, staging에서 production으로 승격할 때는 `EXPECTED_RELEASE_MANIFEST_SHA256`에 staging에서 보관한 manifest hash를, `EXPECTED_RELEASE_SOURCE_REF`에 release branch/tag 이름을 넣어 같은 ref의 같은 산출물만 통과시킨다. `RELEASE_TARGET=production npm run release:check`도 같은 manifest/evidence 검증을 실행하므로 production 후보 검증에서 별도 verify 단계를 빠뜨려도 stale artifact가 통과하지 않는다.
`npm run release:audit-append-only`는 `backend/src`와 `prisma/migrations`에서 `auditLog.update/delete/upsert`, `audit_logs` UPDATE/DELETE/TRUNCATE/DROP SQL, 감사 로그 수정/삭제 API route를 차단한다. Production DB에서는 별도 DB role/권한으로 `audit_logs` update/delete도 제한해야 한다.
`npm run release:sensitive-data`는 production source에서 거래처/지급 목록이 마스킹 계좌를 쓰는지, 거래처 계좌가 암호화 저장되는지, 은행 이체 파일의 원문 계좌가 권한 있는 CSV 응답에만 남고 감사/화면 요약에는 제외되는지, data quality와 은행 결과 대사 오류가 원문 계좌를 노출하지 않는지, 브라우저 production entrypoint가 console 출력을 남기지 않는지 검사한다.
`audit_logs`에는 `audit_logs_append_only` trigger가 적용되어 DB 레벨에서도 UPDATE/DELETE를 거부한다. 운영 DB 적용 후에는 migration 적용 결과와 trigger 존재 여부를 확인한다.
`API_BODY_LIMIT_BYTES`는 10MB 첨부 정책보다 작거나 25MB보다 크면 release gate에서 실패한다. `RATE_LIMIT_DISABLED`는 staging/production에서 허용하지 않으며 `RATE_LIMIT_WINDOW_MS`와 `RATE_LIMIT_MAX`도 release gate 범위 검사를 통과해야 한다. 이 내장 rate limit은 API process 단위 기본 방어이므로, production 다중 인스턴스 또는 public internet 노출 환경에서는 WAF/API gateway/로드밸런서의 분산 rate limit도 별도로 적용한다.
장애 완화용 기능 제한은 `ERP_OPERATION_MODE=normal|read_only|payments_paused|uploads_paused|maintenance`와 `ERP_DISABLED_CAPABILITIES=business_mutations,payments,file_uploads`로 전환한다. 로그인 사용자는 `GET /api/operations/mode`와 설정 화면의 장애 기능 제한 모드 카드에서 현재 상태를 확인할 수 있고, 서버 preHandler는 대상 mutation을 `OPERATION_MODE_RESTRICTED`로 차단해 화면 우회 호출도 막는다.

표준 오류 응답은 서버 `onSend` hook에서 `security_events`에 자동 기록된다. 성공/실패 응답 모두 `meta.requestId`를 포함하고, remote frontend는 API 오류 메시지에 `requestId`를 붙인다. 업무 감사 로그는 `requestId`, `ipAddress`, `userAgent`를 함께 저장한다. 운영 점검 시 권한 실패, validation 실패, 부분 실패, idempotency conflict, workflow lock, signed URL 거부, CSRF 거부, rate limit 초과가 같은 requestId 기준으로 프론트 메시지, API 로그, 감사 로그, 보안 이벤트에서 조회되는지 확인한다.

처리되지 않은 서버 예외는 전역 error handler가 `SERVER_ERROR` 표준 응답으로 변환한다. 사용자 응답에는 내부 오류 세부 정보를 노출하지 않고, 서버 로그와 `security_events`에는 requestId 기준으로 남긴다.

## 운영 인수 보조 문서

- `docs/release-readiness-decision.md`는 `release:go-live-readiness-report` 결과를 release별 go/no-go 판정표, 예외 승인, backlog owner/deadline과 연결한다.
- `docs/release-approval-exceptions.json`은 사용자가 위임한 조건부 예외 승인과 후속 owner/due date/user impact/mitigation을 기계 판정 가능한 형태로 보관한다.
- `docs/frontend-hosting-policy.md`는 정적 프론트 호스팅의 HTTPS, cache-control, rollback artifact 보관, `_headers` 적용 기준을 정의한다.
- `docs/cutover-runbook.md`는 데이터 이관 freeze window, 담당자 연락망, 단계별 예상 시간, failed row quarantine, rollback/rerun 기준을 정의한다.
- `docs/user-training-faq.md`는 역할별 사용자 교육, 운영 FAQ, 오류 신고 양식, requestId 전달 방법을 정의한다.
- `docs/hypercare-runbook.md`는 운영 첫 주 daily check, 일일 상태 보고, hypercare 리포트, 2주차 안정화 회고 기준을 정의한다.
## 배포 절차

1. 변경 사항을 main 배포 브랜치에 병합한다.
2. CI에서 `npm run release:migration-check`, `npm run release:migration-review`, `npm run release:verify-migration-review`, `npm run release:audit-append-only`, `npm run release:mutation-safety`, `npm run release:performance-capacity`, `npm run release:operational-docs`, `npm run release:environment-inventory`, `npm run release:staging-smoke-evidence`, `npm run release:backup-restore-evidence`, `npm run release:data-migration-evidence`, `npm run release:role-uat-evidence`, `npm run release:production-go-live-evidence`, `npm run release:post-go-live-stabilization-evidence`, `npm run release:final-acceptance-evidence`, `npm run release:go-live-handoff`, `npm run release:release-note`, `npm run release:go-live-readiness`, `npm run release:go-live-readiness-report`, `npm run release:submission`, `npm test`, `npm run build`, `npm run release:frontend-artifact`, `npm --prefix backend run build`, `npm run release:backend-smoke`, `npm run release:core-smoke`, `npm run release:manifest`, `npm run release:verify-manifest`를 통과시킨다. `release/release-manifest.json`의 `sourceRef`, git commit, manifest hash를 release evidence로 보관하고, `release/migration-review.json`의 review hash와 release version, `release/go-live-readiness-report.json`/`.md`의 전체 open P0 blocker를 release 승인 증적으로 보관한다. `v*` tag release candidate는 추가로 `npm run release:db-test-evidence-run`과 `REQUIRE_DB_TEST_EVIDENCE=true npm run release:db-test-evidence`를 통과하고 `release/db-test-evidence.json`을 evidence artifact로 보관해야 한다.
3. staging DB에 `npm --prefix backend run db:deploy`를 실행한다. shadow DB가 있는 환경에서는 `SHADOW_DATABASE_URL`을 설정해 `npm run release:migration-check`의 migration diff dry-run도 통과시킨다. 정적 migration guard가 통과해도 staging DB deploy 또는 shadow DB dry-run이 없으면 실제 migration 운영 검증은 완료로 보지 않는다.
4. staging API 서버를 배포하고 `/api/health`, `/api/health/version`, `/api/health/db`, `/api/health/storage`, `/api/health/file-security`, `/api/health/jobs`, `/api/health/integrations`, `/api/operations/report-jobs`, `/api/operations/data-quality`, `/api/operations/financial-reconciliation`, `/api/operations/financial-control-report`를 확인한다.
5. staging 프론트를 remote mode로 배포하고 핵심 화면을 확인한 뒤 `docs/staging-smoke-evidence-template.md`를 복사해 결제 요청, 첨부 업로드, 승인, 지급 보류, 거래처 등록, 설정 권한, 보고서 다운로드, 새로고침/재로그인/다른 브라우저 유지, CSRF/signed URL/session 만료 보안 smoke 증적을 채운다. Frontend build의 `VITE_RELEASE_VERSION`, `VITE_RELEASE_SOURCE_REF`, `VITE_RELEASE_GIT_COMMIT`과 backend `/api/health/version`의 `releaseVersion`, `sourceRef`, `gitCommit`이 같은지 기록한다. `Release manifest hash`와 `EXPECTED_RELEASE_MANIFEST_SHA256 promotion hash`에는 staging에서 생성한 같은 64자리 manifest hash를 넣고, open blocker count가 `0`일 때만 promotion decision을 `approved`로 기록한다. Production 승격 전에는 `STAGING_SMOKE_EVIDENCE_PATH`가 이 완성본을 바라봐야 한다.
6. 운영 DB migration을 적용하고, 이관 직후 `/api/operations/data-quality`, `/api/operations/financial-reconciliation`, `/api/operations/financial-control-report`의 critical 실패가 없는지 확인한다.
7. 운영 API 서버를 배포한다.
8. 운영 프론트 정적 산출물을 배포한다. `dist/_headers`의 HTTPS/cache-control 보안 헤더가 hosting platform에 반영됐는지 확인하고, 직전 release manifest artifact rollback 경로를 기록한다.
9. 배포 후 health check, `/api/health/version`, `/api/operations/alerts`, `/api/operations/business-failure-alerts`, `/api/operations/report-jobs`, `/api/operations/data-quality`, `/api/operations/financial-reconciliation`, `/api/operations/financial-control-report`, 로그인, 결제 요청 목록, 알림 센터, 보고서 다운로드를 확인하고 frontend/backend release identity가 같은지 기록한 뒤 `PRODUCTION_GO_LIVE_EVIDENCE_PATH`가 완성된 production go-live 증빙을 바라보게 한다.
10. 운영 monitor 또는 scheduler가 `POST /api/operations/report-jobs/run`, `POST /api/operations/business-failure-alerts/notify`, `POST /api/operations/financial-reconciliation/notify`를 주기적으로 호출해 예약 보고서 처리, retry/dead-letter 기록, 담당자 알림이 생성되는지 확인한다.
11. 운영 첫 주 daily check, 첫 지급 대사, production data backup/PITR, 사용자 문의/장애 severity 처리, hypercare report, 2주차 backlog review를 수행하고 `POST_GO_LIVE_STABILIZATION_EVIDENCE_PATH`가 완성된 안정화 증빙을 바라보게 한다.
12. 실제 production 업무, 데이터 유지, 권한 차단, backend 통제, 장애 복구, 운영 인수, KPI/오류율, backlog 편입을 최종 확인하고 `FINAL_ACCEPTANCE_EVIDENCE_PATH`가 완성된 실사용 최종 인수 증빙을 바라보게 한다.

## 롤백 절차

상세 승인 기준과 break-glass 절차는 `docs/rollback-break-glass-runbook.md`를 따른다. 모든 rollback은 incident ID, release manifest hash, migration review hash, 직전 artifact checksum, 승인자, 시작/종료 시각, 사용자 공지 링크를 남긴다.

Frontend:

- 직전 versioned 정적 산출물로 되돌리고 hosting platform의 HTTPS redirect, HSTS, `index.html` no-store, hashed asset immutable cache가 유지되는지 확인한다.
- frontend rollback 후 `/api/health/version`과 frontend build release identity가 의도한 조합인지 기록한다.

Backend:

- 직전 API 이미지 또는 패키지 버전으로 되돌린다.
- schema가 하위 호환되는 migration만 운영에 반영하는 것을 원칙으로 하며, DB schema가 API rollback과 맞지 않으면 read-only 또는 maintenance 전환을 우선한다.
- rollback 후 `/api/health/*`, `/api/operations/alerts`, `/api/operations/business-failure-alerts`, `/api/operations/data-quality`, `npm run release:core-smoke` 결과를 증빙으로 보관한다.

Database:

- 컬럼 삭제/타입 변경은 2단계 배포로 진행한다.
- 긴급 복구는 PITR 또는 최근 backup에서 staging 복원 후 운영 반영 여부를 결정한다.
- DB 보정은 DBA, 운영 책임자, 영향 영역 책임자 승인 후 보정 migration 또는 transaction SQL로 수행하고, 운영자 직접 DB 수정 금지 원칙의 예외로 break-glass 기록을 남긴다.
- Production 승격 전 `BACKUP_RESTORE_EVIDENCE_PATH`에 지정한 리허설 증빙으로 PITR, object storage restore, report artifact restore, migration/partial deploy rollback 수행 결과를 확인한다.

Object storage와 report artifact:

- object storage versioning 또는 backup에서 복구한 뒤 `Attachment` metadata, signed URL, malware scan verdict, 파일 권한 이벤트를 대사한다.
- report artifact는 `ReportRun.artifactKey`, 저장 metadata, 다운로드 감사 로그가 같은 run 기준으로 일치하는지 확인한다.

## 모니터링 기준

| 항목 | 기준 |
| --- | --- |
| API health | `/api/health`, `/api/health/db`, `/api/health/storage`, `/api/health/file-security`, `/api/health/jobs`, `/api/health/integrations` |
| Error rate | 5xx 비율과 `SERVER_ERROR` 응답 추적 |
| Auth | `UNAUTHORIZED`, `FORBIDDEN`, `login_rejected`, `auth_required`, `access_denied` 급증 모니터링 |
| Request security | `csrf_rejected`, `rate_limited`, 동일 IP 반복 실패 추적 |
| Workflow | 승인/반려/지급 실패, `CONFLICT`, `WORKFLOW_LOCKED`, report schedule backlog, retry, dead-letter, circuit breaker 추적 |
| Race condition | 중복 클릭, stale `rowVersion`, 중복 `idempotencyKey`, 지급 2인 확인 불일치, 설정 동시 변경 `CONFLICT` 추적 |
| DB | 연결 실패, slow query, migration 실패 |
| File storage | object storage health 실패, signed URL 발급 실패, upload complete 실패, malware scan 실패 |
| External integrations | 회계/은행 연동 credential reference 누락, HTTPS endpoint 누락, 마지막 연동 테스트 점검 상태 추적 |
| Security event | `security_events`의 login rejected, access denied, CSRF rejected, rate limited, file access denied, signed URL rejected, validation rejected, malware blocked 증가 추적 |
| Operational alerts | `GET /api/operations/alerts`가 API 5xx, DB 연결 실패, slow query, 로그인/권한 실패 급증, 파일 업로드 실패 임계치를 503으로 노출 |
| Business failure alerts | `GET /api/operations/business-failure-alerts`가 승인/지급/보고서/알림/파일 실패를 업무 도메인별 503으로 노출하고, `POST /api/operations/business-failure-alerts/notify`가 담당자 알림 생성 |
| Operational dashboard | Dashboard 운영 지표 카드가 `/api/operations/alerts`와 `/api/operations/business-failure-alerts` 기준 처리량, alert rule 오류율, p95 latency, 지급/보고서/업로드 실패 count를 표시 |
| Data quality | `GET /api/operations/data-quality`가 이관/운영 데이터의 critical 정합성 실패를 409로 노출 |
| Financial reconciliation | `GET /api/operations/financial-reconciliation`이 예산 사용액, 승인 요청, 지급 완료, 보고서 스냅샷 금액 불일치를 409로 노출하고, `POST /api/operations/financial-reconciliation/notify`가 담당자 알림 생성 |
| Financial control report | `GET /api/operations/financial-control-report`가 재무 대사 예외, 수동 복구 대기, 은행 결과 대사, 지급 감사 로그, 보고서 스냅샷 검토를 월말 결산 점검표로 노출 |
| Frontend | Vite bundle load error, console error, blank screen |

## 데이터 이관 품질 게이트

1. 원천 시스템, freeze window, 컬럼 매핑, 책임자 승인 흐름을 release별로 확정한다.
2. `docs/data-migration-evidence-template.md`를 복사해 `DATA_MIGRATION_EVIDENCE_PATH`로 지정하고, staging rehearsal과 production 대사 증빙을 채운다.
3. staging 이관 후 `/api/operations/data-quality`를 실행해 critical 실패를 모두 해소한다.
4. 상태별 결제 요청 총액, 지급 상태별 총액, 예산 배정/사용/잔액, 첨부파일 orphan 건수를 원천 시스템과 대사한다.
5. production 이관 직후 같은 점검을 반복하고, 결과를 go-live 승인 증적으로 보관한다.
6. test email, local seed marker, 샘플 계좌, mock attachment가 발견되면 cutover를 중단한다.

## 장애 대응 절차

1. 영향 범위 확인: 로그인, 목록 조회, 승인/지급 액션, 다운로드 중 어디가 실패하는지 분류한다.
2. health check 확인: API, DB, object storage, file security, report jobs, external integrations 순서로 확인한다.
3. 최근 배포 여부 확인: 직전 배포 이후 오류가 증가했는지 본다.
4. 감사 로그와 보안 이벤트 확인: 상태 변경 실패, 권한 오류, signed URL 거부, 파일 접근 차단, 중복 처리 차단 여부를 확인한다.
5. 업무 실패 알림 확인: `/api/operations/business-failure-alerts`의 triggered 도메인과 담당자 `operational_alert` 알림 생성 여부를 확인한다.
6. 재현 경로 기록: 사용자 역할, 메뉴, 요청번호, requestId, 발생 시각을 남긴다.
7. 임시 완화: `ERP_OPERATION_MODE` 또는 `ERP_DISABLED_CAPABILITIES`로 읽기 전용, 지급 일시 중지, 파일 업로드 중지를 적용하고 `/api/operations/mode`로 반영 여부를 확인한다.
8. 복구: rollback 또는 hotfix 배포 후 health check와 핵심 흐름을 재검증한다.
9. 사후 기록: 원인, 영향, 조치, 재발 방지 항목을 문서화한다.

상세 장애 등급, 접수 정보, 업무별 확인표, 완화 조치, rollback 기준, 커뮤니케이션 기준은 `docs/incident-response.md`를 따른다.

## 운영 점검 체크

- 운영 환경변수와 secret이 staging과 분리되어 있다.
- production 환경 inventory에 배포 플랫폼, production 도메인, DB, object storage, secret manager, monitoring, backup/PITR, CDN/WAF, rollback 증적이 확정되어 있다.
- backup/restore rehearsal 증빙에 RPO/RTO, full backup, WAL/PITR, object storage versioning, report artifact backup, staging restore, rollback rehearsal, alert/encryption/access 검증이 확정되어 있다.
- data migration 증빙에 원천 시스템, 컬럼 매핑, staging rehearsal, production 대사, 개인정보/계좌정보 보호, rollback/rerun, 담당자 승인 검증이 확정되어 있다.
- role UAT 증빙에 요청자, 승인자, 재무팀, 관리자, 외부 감사 실제 계정/권한, 파일럿 범위, 지급 dry-run, 주요 업무 시나리오, P0/P1 이슈 처리, 교육/지원, 최종 sign-off 검증이 확정되어 있다.
- production go-live 증빙에 release/migration/artifact/env checksum, production migration 결과, backend health, frontend smoke, 업무 smoke, open P0/예외 승인, rollback, communication, 최종 sign-off 검증이 확정되어 있다.
- post go-live stabilization 증빙에 운영 첫 주 daily check, 첫 지급 대사, production data backup/PITR, P0/P1 same-day response, hypercare report, backlog review, 최종 sign-off 검증이 확정되어 있다.
- final acceptance 증빙에 실제 production 업무 처리, DB/object storage 저장, 새로고침/재로그인/다른 기기 유지, 권한 없는 사용자 UI/API 차단, backend 업무 통제, rollback/복구/읽기 전용/사용자 공지, 운영 인수, KPI/오류율, backlog/운영 릴리즈 계획, 최종 sign-off 검증이 확정되어 있다.
- 운영 DB에 seed가 자동 실행되지 않는다.
- 운영 release 환경에 `ALLOW_PRODUCTION_SEED`가 없다.
- 운영 계정 권한 승인 증빙(`PRODUCTION_ACCESS_REVIEW_APPROVED`, `PRODUCTION_ACCESS_REVIEW_ID`, `PRODUCTION_ACCESS_REVIEW_APPROVER`)이 release gate에 등록되어 있다.
- `GET /api/operations/permission-review`에서 특권 사용자, 비활성 특권 계정, 예외 권한 만료/30일 이내 만료/만료일 누락, `permission_review` 감사 로그 점검 결과를 확인하고 미해결 항목을 go-live 예외 승인 또는 권한 회수로 처리한다.
- 프론트 production 진입점이 `mockData` 또는 `mockApi`를 정적으로 import하지 않는다.
- 감사 로그 삭제 API가 없다.
- 파일 접근 거부와 signed URL 실패가 `security_events`에 남고, token/secret/cookie 값이 마스킹된다.
- backend 운영 로그는 `createSafeLoggerOptions` redaction을 사용해 signed file URL query, cookie, authorization, CSRF token, credential/secret/checksum/token 필드, 계좌번호 패턴을 마스킹한다. 외부 APM/로그 수집기에도 동일한 redaction rule 또는 `sanitizeLogValue` 적용 여부를 staging에서 확인한다.
- 원문 계좌번호는 권한 있는 은행 이체 CSV 응답 외의 목록, 감사 로그, 오류 메시지, 운영 요약, 브라우저 콘솔에 남지 않는다.
- Object storage bucket public access block 또는 private bucket 증적이 있으며, 공개 object storage base URL env가 없다.
- PostgreSQL 연결은 TLS를 강제하고, object storage는 server-side encryption 또는 동등한 at-rest encryption 증적이 있다.
- 파일 다운로드/미리보기는 권한 검증 후 10분 만료 API signed path만 사용하고 object storage 직접 URL을 노출하지 않는다.
- 파일 본문은 DB가 아닌 object storage에 저장된다.
- 파일 업로드는 확장자, `Content-Type`, 10MB 제한, malware scan을 통과해야 하며 blocked 파일은 object storage에 저장하지 않고 quarantine metadata로 남는다.
- 알림 보관 기간과 배치 정리 정책이 설정되어 있다.
- 배포 전 자동화 테스트와 빌드가 모두 통과한다.
