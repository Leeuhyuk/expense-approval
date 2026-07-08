# Production Environment Inventory Template

작성일: 2026-07-06

이 템플릿은 production release candidate 전에 실제 운영 환경 값을 확정하기 위한 인수 문서다. 실제 go-live 전에는 이 파일을 복사해 확정 값을 채우고 `PRODUCTION_ENVIRONMENT_INVENTORY_PATH`로 지정한다. `RELEASE_TARGET=production npm run release:check`는 strict mode로 이 문서를 검증하므로 `TBD`, `pending`, `<...>` 값이 남아 있으면 실패한다. 또한 production 도메인/API URL은 HTTPS non-local 값이어야 하고 `EXPECTED_*` 값과 일치해야 하며, `DATABASE_URL`과 application secret은 원문 값이 아니라 secret manager reference여야 한다. Object storage는 HTTPS endpoint, production bucket, public access block, server-side encryption, external malware scan endpoint를 증명해야 production inventory로 인정된다. Break-glass 계정은 일반 관리자 계정과 분리하고 time-boxed approval, audit evidence, revoke evidence를 남겨야 한다.

## Environment Identity

| 항목 | 값 |
| --- | --- |
| Release target | production |
| Inventory owner | TBD |
| Inventory approval ID | TBD |
| Release manifest hash | TBD |
| Migration review hash | TBD |
| Change window | TBD |
| Rollback owner | TBD |

## Deployment Platform

| 항목 | 값 |
| --- | --- |
| Frontend hosting platform | TBD |
| Backend runtime platform | TBD |
| Deployment project/app ID | TBD |
| Release branch or tag | TBD |
| Branch protection evidence | TBD |
| CDN provider and cache policy | TBD |
| Frontend artifact versioning policy | release manifest hash + immutable hashed assets |
| Frontend cache headers evidence | TBD |
| Frontend rollback artifact evidence | TBD |
| WAF or API gateway policy | TBD |

## Production Domains

| 항목 | 값 |
| --- | --- |
| Frontend domain | TBD |
| API domain | TBD |
| TLS certificate owner | TBD |
| HTTPS redirect policy | TBD |
| `VITE_ERP_API_BASE_URL` | TBD |
| `EXPECTED_PRODUCTION_API_BASE_URL` | TBD |
| `FRONTEND_ORIGIN` | TBD |
| `EXPECTED_PRODUCTION_FRONTEND_ORIGIN` | TBD |

## Database

| 항목 | 값 |
| --- | --- |
| PostgreSQL service/cluster | TBD |
| Production database name | TBD |
| `DATABASE_URL` secret reference | `<secret-manager-reference>` |
| `PGSSLMODE` or URL TLS policy | TBD |
| Migration deploy approver | TBD |
| Backup retention | TBD |
| PITR/WAL retention | TBD |
| Restore rehearsal evidence | pending |

## Object Storage

| 항목 | 값 |
| --- | --- |
| `FILE_STORAGE_DRIVER` | s3 |
| `S3_ENDPOINT` | TBD |
| `S3_BUCKET` | TBD |
| `S3_BUCKET_PUBLIC_ACCESS_BLOCKED` | TBD |
| `S3_SERVER_SIDE_ENCRYPTION_ENABLED` | TBD |
| Bucket versioning/lifecycle policy | TBD |
| Signed URL expiration policy | API signed path, 10 minutes |
| Report artifact backup policy | TBD |

## Secret Manager

| 항목 | 값 |
| --- | --- |
| Secret manager product | TBD |
| Production secret access role | TBD |
| Rotation owner | TBD |
| `FILE_URL_SECRET` reference | `<secret-manager-reference>` |
| `CSRF_SECRET` reference | `<secret-manager-reference>` |
| `BANK_ACCOUNT_SECRET` reference | `<secret-manager-reference>` |
| `S3_ACCESS_KEY_ID` reference | `<secret-manager-reference>` |
| `S3_SECRET_ACCESS_KEY` reference | `<secret-manager-reference>` |
| `MALWARE_SCAN_TOKEN` reference | `<secret-manager-reference>` |

## Monitoring And Logging

| 항목 | 값 |
| --- | --- |
| Monitoring tool | TBD |
| APM/trace tool | TBD |
| Trace redaction rule evidence | TBD |
| APM trace masking verification | TBD |
| Structured logs destination | TBD |
| Alerting channel | TBD |
| `requestId` search procedure | TBD |
| API 5xx alert rule | TBD |
| Slow query alert rule | TBD |
| File upload failure alert rule | TBD |
| Business failure alert owner | TBD |
| Log retention period | TBD |

## Runtime And Scaling

| 항목 | 값 |
| --- | --- |
| Node.js runtime version | 22 |
| Backend instance count | TBD |
| Rate limit layer | process + WAF/API gateway |
| `API_BODY_LIMIT_BYTES` | 11534336 |
| `RATE_LIMIT_WINDOW_MS` | 60000 |
| `RATE_LIMIT_MAX` | 600 |
| API request timeout policy | 15s client read timeout, gateway/server timeout evidence TBD |
| `SLOW_QUERY_MS` | 1000 |
| Report worker/queue platform | TBD |
| Health check path | `/api/health` |

## Security Controls

| 항목 | 값 |
| --- | --- |
| Auth method | password hash or approved SSO |
| MFA/SSO evidence | TBD |
| Production access review ID | TBD |
| General administrator account policy | TBD |
| Break-glass account reference | TBD |
| Break-glass approval workflow | time-boxed, multi-approval, audited |
| Break-glass audit evidence | TBD |
| Break-glass revoke evidence | TBD |
| CSRF/CORS validation evidence | TBD |
| TLS/HTTPS validation evidence | TBD |
| WAF/API gateway rule set | TBD |
| Audit log append-only DB control | TBD |
| Sensitive data masking verification | TBD |

## Backup And Restore

| 항목 | 값 |
| --- | --- |
| Database full backup schedule | TBD |
| PITR/WAL restore target | TBD |
| Object storage backup/versioning | TBD |
| Report artifact backup | TBD |
| Restore rehearsal date | pending |
| Restore rehearsal result | pending |
| Rollback criteria link | TBD |

## External Integrations

| 항목 | 값 |
| --- | --- |
| `FILE_SCAN_MODE` | external |
| `MALWARE_SCAN_ENDPOINT` | TBD |
| Accounting integration endpoint | TBD |
| Bank integration endpoint | TBD |
| Tax invoice integration endpoint | TBD |
| Integration credential references | `<secret-manager-reference>` |
| Last integration health evidence | pending |

## Evidence Links

| 항목 | 값 |
| --- | --- |
| Staging smoke test evidence | `STAGING_SMOKE_EVIDENCE_PATH` target, TBD |
| Data migration evidence | `DATA_MIGRATION_EVIDENCE_PATH` target, TBD |
| Role UAT evidence | `ROLE_UAT_EVIDENCE_PATH` target, TBD |
| Production go-live evidence | `PRODUCTION_GO_LIVE_EVIDENCE_PATH` target, TBD |
| Post go-live stabilization evidence | `POST_GO_LIVE_STABILIZATION_EVIDENCE_PATH` target, TBD |
| Final acceptance evidence | `FINAL_ACCEPTANCE_EVIDENCE_PATH` target, TBD |
| Remote DB E2E evidence | TBD |
| Object storage health evidence | TBD |
| Malware scanner health evidence | TBD |
| Monitoring dashboard link | TBD |
| Alerting test evidence | TBD |
| Backup/restore rehearsal evidence | `BACKUP_RESTORE_EVIDENCE_PATH` target, TBD |
| Production go-live handoff | TBD |
