# Production Go-Live Evidence Template

작성일: 2026-07-06

이 템플릿은 production 배포 직후 release version, migration version, artifact checksum, environment checksum, health check, frontend smoke, rollback 기준, 최종 승인 증적을 한곳에 고정하기 위한 문서다. 실제 production 후보 전에는 이 파일을 복사해 확정 값을 채우고 `PRODUCTION_GO_LIVE_EVIDENCE_PATH`로 지정한다. `RELEASE_TARGET=production npm run release:check`는 strict mode로 이 문서를 검증하므로 `TBD`, `pending`, `<...>` 값이 남아 있으면 실패한다. 또한 release/manifest/migration hash 형식, `EXPECTED_RELEASE_MANIFEST_SHA256` 일치, production HTTPS URL, `/api/health` 결과, frontend/business smoke 결과, open P0 count, evidence link, 최종 sign-off 시각/증적 형식이 맞지 않아도 실패한다.

## Release Identity

| 항목 | 값 |
| --- | --- |
| Release version | TBD |
| Release source ref | TBD |
| Git commit | TBD |
| Release manifest hash | TBD |
| `EXPECTED_RELEASE_MANIFEST_SHA256` | TBD |
| Migration review hash | TBD |
| Production deployment window | TBD |
| Go-live decision ID | TBD |

## Artifact And Environment Checksums

| 항목 | 값 |
| --- | --- |
| Frontend artifact checksum | TBD |
| Backend artifact checksum | TBD |
| Prisma migration checksum | TBD |
| Release input checksum | TBD |
| Production env checksum | TBD |
| Secret manager version set | TBD |
| Frontend `VITE_ERP_API_MODE` | remote |
| Frontend `VITE_ERP_API_BASE_URL` | TBD |
| Backend `/api/health/version` result | TBD |
| Frontend/backend release identity comparison | TBD |

## Production Migration

| 항목 | 값 |
| --- | --- |
| Production DB backup before migration | TBD |
| Migration deploy command/result | TBD |
| Applied migration version | TBD |
| Migration operator | TBD |
| Migration approver | TBD |
| Rollback/PITR readiness confirmation | TBD |

## Backend Health Checks

| 항목 | 값 |
| --- | --- |
| `/api/health` | TBD |
| `/api/health/db` | TBD |
| `/api/health/storage` | TBD |
| `/api/health/file-security` | TBD |
| `/api/health/jobs` | TBD |
| `/api/health/integrations` | TBD |
| `/api/health/version` | TBD |
| `/api/operations/alerts` | TBD |
| `/api/operations/business-failure-alerts` | TBD |
| `/api/operations/data-quality` | TBD |
| requestId/log evidence | TBD |

## Frontend Smoke

| 항목 | 값 |
| --- | --- |
| Production frontend URL | TBD |
| Login smoke | pending |
| Menu permission smoke | pending |
| Payment request list smoke | pending |
| Attachment access smoke | pending |
| Notification center smoke | pending |
| Report download smoke | pending |
| Browser console error check | pending |
| Network API base URL check | pending |

## Business Smoke

| 항목 | 값 |
| --- | --- |
| 결제 요청 생성 smoke | pending |
| 증빙 첨부 smoke | pending |
| 승인 처리 smoke | pending |
| 지급 보류 또는 실행 전 dry-run smoke | pending |
| 거래처 조회/등록 smoke | pending |
| 시스템 설정 권한 smoke | pending |
| 보고서 생성/다운로드 smoke | pending |
| AuditLog evidence | TBD |

## Open P0 And Exceptions

| 항목 | 값 |
| --- | --- |
| 23장 open P0 count | TBD |
| 24장 open P0 count | TBD |
| 25장 open P0 count | TBD |
| Approved exception list | TBD |
| Exception owner/deadline | TBD |
| Go-live readiness command result | TBD |

## Rollback Readiness

| 항목 | 값 |
| --- | --- |
| Rollback trigger criteria | TBD |
| Rollback owner | TBD |
| Rollback backup owner | TBD |
| Rollback estimated time | TBD |
| Previous release manifest artifact | TBD |
| User notice message | TBD |
| Read-only mode decision path | TBD |

## Communication And Freeze

| 항목 | 값 |
| --- | --- |
| Change freeze start/end | TBD |
| Incident channel | TBD |
| Status update cadence | TBD |
| Hypercare start/end | TBD |
| First business transaction observer | TBD |
| Support handoff link | TBD |

## Evidence Links

| 항목 | 값 |
| --- | --- |
| Production deployment run URL | TBD |
| Production health check log | TBD |
| Frontend smoke recording or screenshot folder | TBD |
| Release manifest artifact | TBD |
| Migration review artifact | TBD |
| Environment checksum archive | TBD |
| Go-live handoff document | TBD |
| Role UAT evidence | TBD |
| Post go-live stabilization evidence path | `POST_GO_LIVE_STABILIZATION_EVIDENCE_PATH` |
| Final acceptance evidence path | `FINAL_ACCEPTANCE_EVIDENCE_PATH` |

## Final Production Sign-Off

| 책임 영역 | 승인자 | 승인 시각 | 증적 링크 또는 ID |
| --- | --- | --- | --- |
| 기능 책임자 | TBD | TBD | TBD |
| 보안 책임자 | TBD | TBD | TBD |
| 재무 책임자 | TBD | TBD | TBD |
| 운영 책임자 | TBD | TBD | TBD |
