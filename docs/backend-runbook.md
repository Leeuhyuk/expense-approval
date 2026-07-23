# Backend Runbook

작성일: 2026-07-04

이 문서는 로컬 개발 환경에서 백엔드 API와 PostgreSQL DB를 연결해 실행하는 절차다.

## 1. 환경 변수

루트의 `.env.example`을 기준으로 실제 `.env`를 준비한다.

```env
VITE_ERP_API_MODE=remote
VITE_ERP_API_BASE_URL=http://127.0.0.1:4000/api

DATABASE_URL=postgresql://erp:erp@127.0.0.1:5432/payment_approval_erp?schema=public
PORT=4000
HOST=127.0.0.1
FRONTEND_ORIGIN=http://127.0.0.1:5173
SESSION_IDLE_MINUTES=30
SESSION_ABSOLUTE_MINUTES=720
CSRF_SECRET=local-csrf-secret-change-before-shared-env
BANK_ACCOUNT_SECRET=local-bank-account-secret-change-before-shared-env
FILE_STORAGE_DRIVER=local
FILE_STORAGE_DIR=.local-file-storage
FILE_SCAN_MODE=local
REPORT_JOB_WORKER_ENABLED=false
SLOW_QUERY_MS=1000
ALERT_WINDOW_MINUTES=15
ALERT_APPROVAL_FAILURE_THRESHOLD=1
ALERT_DISBURSEMENT_FAILURE_THRESHOLD=1
ALERT_REPORT_FAILURE_THRESHOLD=1
ALERT_NOTIFICATION_FAILURE_THRESHOLD=1
ALERT_FILE_PROCESSING_FAILURE_THRESHOLD=1
```

프론트만 mock으로 확인할 때는 `VITE_ERP_API_MODE=mock`을 유지한다.

## 2. 백엔드 의존성 설치

```powershell
cd backend
npm install
```

## 3. Prisma client 생성

```powershell
npm run db:generate
```

## 4. 로컬 DB 마이그레이션

```powershell
npm run db:migrate
```

운영 또는 staging 배포 환경에서는 migration 파일을 검토한 뒤 `npm run db:deploy`를 사용한다.

## 5. 초기 seed 적용

```powershell
npm run db:seed
```

seed는 local/test 전용 샘플 데이터다. 부서, 사용자, 역할, 거래처, 예산, 결제 요청, 승인 단계, 지급 예정, 첨부파일 메타데이터, 감사 로그를 포함한다.
seed 사용자 비밀번호는 local/test 전용 `password`이며, 로그인 API는 `DEV_LOGIN_PASSWORD`가 아니라 `User.passwordHash`의 scrypt hash를 검증한다.

## 6. API 서버 실행

```powershell
npm run dev
```

확인 엔드포인트:

- `GET http://127.0.0.1:4000/api/health`
- `GET http://127.0.0.1:4000/api/health/version`
- `GET http://127.0.0.1:4000/api/health/db`
- `GET http://127.0.0.1:4000/api/health/storage`
- `GET http://127.0.0.1:4000/api/health/file-security`
- `GET http://127.0.0.1:4000/api/health/jobs`
- `GET http://127.0.0.1:4000/api/health/integrations`
- `GET http://127.0.0.1:4000/api/operations/alerts` (`system:manage` 로그인 필요)
- `GET http://127.0.0.1:4000/api/operations/business-failure-alerts` (`system:manage` 로그인 필요)
- `POST http://127.0.0.1:4000/api/operations/business-failure-alerts/notify` (`system:manage` 로그인 필요)
- `GET http://127.0.0.1:4000/api/operations/data-quality` (`system:manage` 로그인 필요)
- `GET http://127.0.0.1:4000/api/payment-requests?page=1&pageSize=10`

`/api/health/jobs`는 활성 보고서 예약, 실행 대기 건수, 최근 실패 실행, worker/queue 설정을 확인한다. `/api/health/integrations`는 시스템 설정의 외부 연동 스냅샷에서 회계/은행 credential reference, 서버 secret 존재 여부, HTTPS 테스트 endpoint, 마지막 점검 상태를 확인한다.
`/api/operations/alerts`는 최근 `ALERT_WINDOW_MINUTES` 동안의 `security_events`와 DB 연결 상태를 기준으로 API 5xx, slow query, 로그인 실패, 권한 실패, 파일 업로드 실패 임계치를 평가한다.
`/api/operations/business-failure-alerts`는 승인/지급/보고서/알림/파일 route 실패를 업무 도메인별로 집계한다. `POST /api/operations/business-failure-alerts/notify`는 임계치를 넘은 도메인에 대해 활성 `system:manage` 담당자에게 중복 없이 운영 알림을 만든다.
`/api/operations/data-quality`는 운영 전 또는 이관 직후 사용자/권한/거래처/계좌/예산/결제 요청/지급/첨부파일 정합성을 점검한다. critical 실패가 있으면 HTTP 409를 반환하므로 release gate 또는 cutover 점검에서 실패로 처리한다.

로그인 확인:

- `POST http://127.0.0.1:4000/api/auth/login`
- body: `{ "email": "kim.minsu@example.local", "password": "password" }`
- `GET http://127.0.0.1:4000/api/auth/me`
- 로그인 성공 후 mutating API는 `erp_csrf` cookie 값을 `X-CSRF-Token` 헤더로 함께 보내야 한다. 프론트 remote API는 이 헤더를 자동으로 붙인다.

## 7. 프론트 연결

프론트 개발 서버는 루트에서 실행한다.

```powershell
npm run dev
```

remote mode에서는 `src/api/service.ts`가 `VITE_ERP_API_BASE_URL`을 통해 실제 백엔드 목록 API를 호출한다. 화면 컴포넌트는 `erpApi`만 사용하므로 mock/remote 전환 시 UI 코드 변경이 필요 없다.
