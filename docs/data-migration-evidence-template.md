# Data Migration Evidence Template

작성일: 2026-07-06

이 템플릿은 production 초기 데이터 이관 전후에 원천 시스템, 컬럼 매핑, 이관 범위, freeze window, staging rehearsal, production 대사, 개인정보/계좌정보 보호, rollback 조건을 실제 증빙으로 확정하기 위한 문서다. 실제 production 후보 전에는 이 파일을 복사해 확정 값을 채우고 `DATA_MIGRATION_EVIDENCE_PATH`로 지정한다. `RELEASE_TARGET=production npm run release:check`는 strict mode로 이 문서를 검증하므로 `TBD`, `pending`, `<...>` 값이 남아 있으면 실패한다.

## Migration Identity

| 항목 | 값 |
| --- | --- |
| Migration owner | TBD |
| Migration approval ID | TBD |
| Release manifest hash | TBD |
| Migration review hash | TBD |
| Source data extract timestamp | TBD |
| Target environment | production |
| Cutover window | TBD |

## Source Systems

| 항목 | 값 |
| --- | --- |
| User source system | TBD |
| Department source system | TBD |
| Role/permission source system | TBD |
| Vendor source system | TBD |
| Bank account source system | TBD |
| Budget source system | TBD |
| Open payment request source system | TBD |
| Attachment metadata source system | TBD |
| Source owner approval evidence | pending |

## Scope And Freeze Window

| 항목 | 값 |
| --- | --- |
| User migration scope | TBD |
| Department migration scope | TBD |
| Role/permission migration scope | TBD |
| Vendor/account migration scope | TBD |
| Budget migration scope | TBD |
| Open payment request migration scope | TBD |
| Attachment metadata migration scope | TBD |
| Freeze window start/end | TBD |
| Freeze exception approver | TBD |
| Change ban communication evidence | pending |

## Column Mapping

| 항목 | 값 |
| --- | --- |
| User column mapping | TBD |
| Department column mapping | TBD |
| Role/permission column mapping | TBD |
| Vendor column mapping | TBD |
| Bank account encryption mapping | TBD |
| Budget column mapping | TBD |
| Open payment request column mapping | TBD |
| Attachment metadata column mapping | TBD |
| Validation query archive | TBD |
| Mapping owner approval evidence | pending |

## Load Procedure

| 항목 | 값 |
| --- | --- |
| Migration script or runbook link | TBD |
| Pre-load backup evidence | TBD |
| Idempotent rerun strategy | TBD |
| Manual correction audit log policy | TBD |
| Production seed disabled evidence | TBD |
| Rollback condition | TBD |
| Rollback owner | TBD |

## Staging Rehearsal

| 항목 | 값 |
| --- | --- |
| Staging rehearsal date | pending |
| Staging source extract checksum | TBD |
| Staging load result | pending |
| Staging row count reconciliation | TBD |
| Staging status aggregate reconciliation | TBD |
| Staging payment total reconciliation | TBD |
| Staging budget balance reconciliation | TBD |
| Staging vendor payment history reconciliation | TBD |
| Staging attachment metadata reconciliation | TBD |
| Staging data-quality endpoint result | TBD |

## Production Reconciliation

| 항목 | 값 |
| --- | --- |
| Production migration start/end | TBD |
| Production row count reconciliation | TBD |
| Production status aggregate reconciliation | TBD |
| Production payment total reconciliation | TBD |
| Production disbursement total reconciliation | TBD |
| Production budget balance reconciliation | TBD |
| Production vendor payment history reconciliation | TBD |
| Production attachment orphan check | TBD |
| Production data-quality endpoint result | TBD |
| Production mock/local seed/test marker check | TBD |

## Sensitive Data Controls

| 항목 | 값 |
| --- | --- |
| Bank account encryption verification | TBD |
| Bank account masking verification | TBD |
| Personal data access permission verification | TBD |
| Raw account export restriction evidence | TBD |
| Secret manager reference for migration credentials | `<secret-manager-reference>` |
| Migration file retention/deletion evidence | pending |

## Test Data And Marker Checks

| 항목 | 값 |
| --- | --- |
| mockData marker check | TBD |
| local seed marker check | TBD |
| test email check | TBD |
| test account check | TBD |
| sample/mock/demo text check | TBD |
| sample attachment check | TBD |

## Rollback And Rerun

| 항목 | 값 |
| --- | --- |
| Cutover abort condition | TBD |
| Migration rerun strategy | TBD |
| Failed row quarantine procedure | TBD |
| Manual correction approval flow | TBD |
| Rollback drill evidence | pending |
| User communication draft | TBD |

## Evidence Links

| 항목 | 값 |
| --- | --- |
| Source extract archive | TBD |
| Column mapping workbook | TBD |
| Validation query archive | TBD |
| Staging rehearsal log | TBD |
| Production reconciliation export | TBD |
| `/api/operations/data-quality` export | TBD |
| AuditLog correction evidence | TBD |
| Approver sign-off link | TBD |

## Approvals

| 항목 | 값 |
| --- | --- |
| Business owner approver | TBD |
| Security owner approver | TBD |
| Finance owner approver | TBD |
| Operations owner approver | TBD |
| Production cutover decision | pending |
