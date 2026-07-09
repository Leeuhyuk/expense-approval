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
## Synthetic Monitoring

`npm run release:synthetic-monitor`는 운영 monitor 또는 scheduler에서 로그인부터 지급 전 단계까지 읽기 전용 업무 경로를 주기 점검하는 CLI다. 실제 지급 실행, 은행 이체 파일 생성, 대사 mutation은 호출하지 않는다.

```powershell
$env:SYNTHETIC_MONITOR_API_BASE_URL="https://api.example.com/api"
$env:SYNTHETIC_MONITOR_EMAIL="synthetic-monitor@example.com"
$env:SYNTHETIC_MONITOR_PASSWORD="<secret-manager-value>"
$env:SYNTHETIC_MONITOR_REQUIRE_CONFIG="true"
$env:SYNTHETIC_MONITOR_MAX_LATENCY_MS="3000"
$env:SYNTHETIC_MONITOR_OUTPUT="release/synthetic-monitor-report.json"
npm run release:synthetic-monitor
```

점검 범위는 `/health`, `/health/db`, `/health/storage`, `/health/jobs`, `/auth/login`, `/auth/me`, `/dashboard`, `/payment-requests`, `/approvals`, `/budgets`, `/vendors`, `/reports`, `/disbursements`, `/operations/mode`다. `SYNTHETIC_MONITOR_INCLUDE_PRIVILEGED=true`이면 `/operations/data-quality`, `/operations/financial-reconciliation`, `/operations/business-failure-alerts`도 조회한다.

Staging과 production에서는 5분 또는 10분 주기로 실행하고, 실패 건수, 최대 latency, requestId, output JSON 위치를 monitoring alert와 go-live evidence에 보관한다. 로컬이나 CI에서 API base URL/계정이 없으면 기본 SKIP으로 종료하지만, 운영 scheduler는 `SYNTHETIC_MONITOR_REQUIRE_CONFIG=true`를 설정해 미구성을 실패로 처리한다.
