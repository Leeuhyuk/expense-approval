# Core Smoke Runbook

작성일: 2026-07-08

`npm run release:core-smoke`는 staging/production 배포 전후에 API health, 로그인, 주요 화면 조회, 알림, 운영 상태 endpoint를 빠르게 점검하는 CLI다. 실제 업무 생성/승인/파일 업로드 E2E는 `release:db-test-evidence-run`과 staging smoke evidence에서 수행하고, 이 스크립트는 배포 직후 핵심 경로가 살아 있는지 확인하는 용도다.

## 실행 예시

```powershell
$env:CORE_SMOKE_API_BASE_URL="https://api.example.com/api"
$env:CORE_SMOKE_EMAIL="admin@example.com"
$env:CORE_SMOKE_PASSWORD="<secret-manager-value>"
$env:CORE_SMOKE_REQUIRE_AUTH="true"
npm run release:core-smoke
```

## 점검 범위

| 구분 | Endpoint |
| --- | --- |
| Public health | `/health`, `/health/version`, `/health/db`, `/health/storage`, `/health/file-security`, `/health/jobs`, `/health/integrations` |
| Auth | `/auth/login`, `/auth/me` |
| User paths | `/notifications`, `/dashboard`, `/payment-requests`, `/approvals`, `/disbursements`, `/budgets`, `/vendors`, `/reports`, `/settings`, `/operations/mode` |
| Privileged paths | `/operations/alerts`, `/operations/business-failure-alerts`, `/operations/data-quality` |

기본값은 privileged path까지 조회한다. smoke 계정이 `system:manage` 권한이 아니라면 `CORE_SMOKE_INCLUDE_PRIVILEGED=false`로 제한한다.

## Evidence

각 성공/실패 라인은 `[core-smoke]` prefix와 `requestId`를 포함한다. Staging 또는 production 증빙 파일에는 실행 시각, release manifest hash, API base URL, smoke 계정 역할, 출력 로그 위치, 실패 시 requestId와 remediation owner를 기록한다.