# Environment Separation Matrix Template

작성일: 2026-07-08

이 템플릿은 dev, staging, production의 DB, object storage, auth/session, secret, domain/API origin, logs/monitoring, data policy가 서로 분리되었는지 release마다 확인하기 위한 문서다. 실제 production 후보 전에는 이 파일을 복사해 확정 값을 채우고 `ENVIRONMENT_SEPARATION_PATH`로 지정한다. `RELEASE_TARGET=production npm run release:check`는 strict mode로 이 문서를 검증하므로 `TBD`, `pending`, `<...>` 값이 남아 있으면 실패한다.

## Environment Matrix

| Environment | Database | Object storage | Auth/session | Secret scope | Domain/API origin | Logs/monitoring | Data policy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dev | TBD | TBD | TBD | TBD | TBD | TBD | synthetic/local-only |
| staging | TBD | TBD | TBD | TBD | TBD | TBD | masked production-like or synthetic |
| production | TBD | TBD | TBD | TBD | TBD | TBD | production data only, no mock/local seed |

## Isolation Checks

| 항목 | 기준 | 증빙 |
| --- | --- | --- |
| DB isolation | dev/staging/production은 서로 다른 cluster/database/user를 사용한다 | TBD |
| Object storage isolation | 각 환경은 다른 bucket/container/prefix와 다른 credential을 사용한다 | TBD |
| Auth/session isolation | cookie domain, session store, SSO tenant 또는 password realm이 환경별로 다르다 | TBD |
| Secret isolation | secret manager project/path/role이 환경별로 다르고 production secret은 하위 환경에서 읽을 수 없다 | TBD |
| Domain isolation | staging과 production domain/API origin은 HTTPS non-local이며 서로 다르다 | TBD |
| Log isolation | 로그 저장소, retention, dashboard, alert channel이 환경별로 구분된다 | TBD |
| Data isolation | staging에는 production raw 개인정보/계좌정보가 직접 복제되지 않고 비식별 또는 synthetic 정책을 따른다 | TBD |

## Secret Boundaries

| 항목 | dev | staging | production |
| --- | --- | --- | --- |
| Secret manager namespace | TBD | TBD | TBD |
| Runtime service account | TBD | TBD | TBD |
| Deployment service account | TBD | TBD | TBD |
| Secret reader role | TBD | TBD | TBD |
| Break-glass secret access | disabled or local-only | time-boxed, audited | time-boxed, multi-approval, audited |

## Data Boundaries

| 항목 | dev | staging | production |
| --- | --- | --- | --- |
| Seed/mock data policy | allowed | blocked unless synthetic fixture approved | blocked |
| Production data import | prohibited | masked/anonymized only | approved cutover only |
| File/object retention | local/test retention | rehearsal retention | production retention/lifecycle |
| Bank/account data | synthetic only | masked or test account only | encrypted production account only |

## Promotion Controls

| 항목 | 기준 | 증빙 |
| --- | --- | --- |
| Same artifact promotion | staging smoke와 production go-live evidence가 같은 release manifest hash를 사용한다 | STAGING_SMOKE_EVIDENCE_PATH / PRODUCTION_GO_LIVE_EVIDENCE_PATH |
| Same migration promotion | staging migration review hash와 production migration review hash가 같다 | Migration review hash |
| Environment checksum | production env checksum과 secret manager version set을 go-live evidence에 기록한다 | PRODUCTION_GO_LIVE_EVIDENCE_PATH |
| Release note/user notice | release note에 사용자 영향, known issue, rollback 조건, 공지 대상이 들어 있다 | RELEASE_NOTE_PATH |

## Evidence Links

| 항목 | 값 |
| --- | --- |
| Production environment inventory | `PRODUCTION_ENVIRONMENT_INVENTORY_PATH` target, TBD |
| Staging smoke evidence | `STAGING_SMOKE_EVIDENCE_PATH` target, TBD |
| Production go-live evidence | `PRODUCTION_GO_LIVE_EVIDENCE_PATH` target, TBD |
| Release note | `RELEASE_NOTE_PATH` target, TBD |
| Monitoring dashboard | TBD |
| Alert channel evidence | TBD |
| Access review evidence | TBD |