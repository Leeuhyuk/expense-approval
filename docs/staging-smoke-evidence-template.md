# Staging Smoke Evidence Template

작성일: 2026-07-06

이 템플릿은 production 승격 전에 staging에서 같은 release artifact, 같은 migration, production과 분리된 실제형 DB/object storage/scanner/secret/domain 구성으로 핵심 업무 smoke를 수행했다는 증적을 남기기 위한 문서다. 실제 production 후보 전에는 이 파일을 복사해 확정 값을 채우고 `STAGING_SMOKE_EVIDENCE_PATH`로 지정한다. `RELEASE_TARGET=production npm run release:check`는 strict mode로 이 문서를 검증하므로 `TBD`, `pending`, `<...>` 값이 남아 있으면 실패한다. 또한 `Release manifest hash`와 `EXPECTED_RELEASE_MANIFEST_SHA256 promotion hash`는 같은 64자리 SHA-256이어야 하고, `VITE_ERP_API_MODE=remote`, `Production promotion decision=approved`, `Open blocker count=0`이어야 production 승격 증적으로 인정된다.

## Release Identity

| 항목 | 값 |
| --- | --- |
| Release target promoted from staging | production |
| Staging smoke owner | TBD |
| Staging smoke approval ID | TBD |
| Release branch or tag | TBD |
| Release manifest hash | TBD |
| `EXPECTED_RELEASE_MANIFEST_SHA256` promotion hash | TBD |
| Migration review hash | TBD |
| Smoke execution window | TBD |

## Environment Separation

| 항목 | 값 |
| --- | --- |
| Staging frontend domain | TBD |
| Staging backend API domain | TBD |
| Staging DB service/cluster | TBD |
| Staging object storage bucket | TBD |
| Staging secret manager project | TBD |
| Staging auth/session store | TBD |
| Production resource separation evidence | pending |

## Artifact And Migration

| 항목 | 값 |
| --- | --- |
| Frontend artifact version | TBD |
| Backend artifact version | TBD |
| `VITE_ERP_API_MODE` | remote |
| `VITE_ERP_API_BASE_URL` | TBD |
| Backend `/api/health/version` result | TBD |
| DB migration command/result | TBD |
| Migration rollback/PITR note | TBD |

## Health Checks

| 항목 | 값 |
| --- | --- |
| `/api/health` | TBD |
| `/api/health/db` | TBD |
| `/api/health/storage` | TBD |
| `/api/health/file-security` | TBD |
| `/api/health/jobs` | TBD |
| `/api/health/integrations` | TBD |
| `/api/operations/data-quality` | TBD |
| requestId/log evidence | TBD |

## Remote Frontend

| 항목 | 값 |
| --- | --- |
| Frontend remote mode confirmation | TBD |
| Frontend/backend release identity comparison | TBD |
| Mock fallback disabled evidence | TBD |
| Login/session persistence evidence | TBD |
| Second browser login evidence | TBD |
| Browser console error check | TBD |
| Network API base URL check | TBD |

## Business Smoke Flows

| 항목 | 값 |
| --- | --- |
| 거래처 등록 | TBD |
| 거래처 증빙 파일 업로드 | TBD |
| 결제 요청 생성 | TBD |
| 결제 요청 첨부 업로드 | TBD |
| 결제 요청 제출 | TBD |
| 승인자 순차 승인 | TBD |
| 지급 보류 또는 실행 전 단계 | TBD |
| 시스템 설정 권한 그룹 변경 | TBD |
| 보고서 생성/다운로드 | TBD |
| 즐겨찾기 저장/열기 | TBD |

## Persistence And Cross Browser

| 항목 | 값 |
| --- | --- |
| 새로고침 후 거래처/첨부 유지 | TBD |
| 재로그인 후 결제 요청 상태 유지 | TBD |
| 다른 브라우저 접속 후 승인 상태 유지 | TBD |
| 다른 브라우저 접속 후 설정 권한 유지 | TBD |
| Prisma DB row evidence | TBD |
| File/object storage metadata evidence | TBD |
| AuditLog evidence | TBD |

## Security Smoke

| 항목 | 값 |
| --- | --- |
| API 직접 호출 권한 우회 차단 | TBD |
| CSRF 거부 확인 | TBD |
| signed URL 직접 접근 차단 | TBD |
| session 만료 확인 | TBD |
| Secure/HttpOnly/SameSite cookie 확인 | TBD |
| CORS allowlist 확인 | TBD |
| Security event requestId evidence | TBD |

## File And Integration Smoke

| 항목 | 값 |
| --- | --- |
| Object storage private bucket evidence | TBD |
| Malware scanner clean verdict evidence | TBD |
| Malware scanner blocked verdict evidence | TBD |
| Report artifact download evidence | TBD |
| Accounting integration health evidence | pending |
| Bank integration health evidence | pending |
| Tax invoice integration health evidence | pending |

## Evidence Links

| 항목 | 값 |
| --- | --- |
| CI run URL | TBD |
| Staging deployment URL | TBD |
| Staging smoke recording or screenshot folder | TBD |
| Remote DB E2E run URL | TBD |
| Health check log query | TBD |
| Data-quality result export | TBD |
| Security smoke requestId list | TBD |
| Approver sign-off link | TBD |

## Promotion Decision

| 항목 | 값 |
| --- | --- |
| Production promotion decision | pending |
| Open blocker count | TBD |
| Known issue approval | TBD |
| Rollback criteria link | TBD |
| Final staging approver | TBD |
