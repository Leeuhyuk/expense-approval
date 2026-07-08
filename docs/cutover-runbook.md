# Cutover Runbook

작성일: 2026-07-08

이 문서는 초기 데이터 이관과 go-live 전환 당일의 freeze window, 담당자 연락망, 단계별 예상 소요 시간, 이관 실패 rollback/rerun, 수동 보정 감사 로그 기준을 정의한다. 실제 production 후보 전에는 `docs/data-migration-evidence-template.md`를 복사해 확정 증빙을 채우고 `DATA_MIGRATION_EVIDENCE_PATH`로 지정한다.

## 담당자 연락망

| 역할 | 담당자 | 연락 채널 | 승인 범위 |
| --- | --- | --- | --- |
| Cutover commander | TBD | TBD | 전체 진행/중단 판단 |
| Data migration owner | TBD | TBD | 이관 스크립트 실행과 rerun 판단 |
| DBA | TBD | TBD | backup, PITR, DB 권한, 보정 SQL review |
| Security owner | TBD | TBD | 개인정보/계좌정보, 권한, break-glass 승인 |
| Finance owner | TBD | TBD | 금액/지급/예산 대사 승인 |
| Operations owner | TBD | TBD | 사용자 공지, freeze, rollback 수행 |
| Support owner | TBD | TBD | 사용자 문의, requestId 접수 |

## Cutover 단계

| 단계 | 예상 소요 | 완료 기준 |
| --- | --- | --- |
| T-7일 이관 리허설 | 0.5~1일 | staging load, row count, 금액, 예산 잔액, 거래처 지급 이력 대사 통과 |
| T-2일 freeze 공지 | 30분 | freeze window, 변경 금지 범위, 예외 승인자 공지 |
| T-1일 최종 원천 추출 | 1~2시간 | source extract checksum, 컬럼 매핑, backup 증빙 확보 |
| T-0 migration window 시작 | 15분 | 신규 변경 freeze, 운영 채널 open, rollback owner 대기 |
| Target load | 1~3시간 | load result, failed row list, quarantine 여부 기록 |
| Reconciliation | 1~2시간 | `/api/operations/data-quality`, 총액, 건수, 상태별 집계, 예산 잔액, 첨부 orphan 확인 |
| Business smoke | 30~60분 | 로그인, 결제 요청, 승인, 지급 보류/dry-run, 거래처, 보고서, 설정 권한 확인 |
| Go/no-go decision | 15분 | 기능/보안/재무/운영 책임자 승인 또는 abort |

## Freeze Window 기준

- Freeze window start/end, 변경 금지 대상, 예외 승인자를 `DATA_MIGRATION_EVIDENCE_PATH`에 기록한다.
- Freeze 중 신규 결제 요청, 거래처 변경, 권한 변경, 예산 조정, 지급 예정일 변경은 중지한다.
- 긴급 예외는 cutover commander와 영향 영역 책임자 승인을 받고, 변경 ID와 사유를 남긴다.
- Freeze 중 접수된 변경은 cutover 종료 후 재입력 또는 보정 migration 대상 backlog로 분리한다.

## 이관 실패 처리

| 실패 유형 | 처리 기준 |
| --- | --- |
| 원천 extract checksum 불일치 | cutover 중단, 원천 시스템 owner 재승인 후 재추출 |
| load 중 schema/validation 실패 | failed row quarantine, mapping 수정 후 staging rerun 먼저 수행 |
| 일부 row 중복 또는 누락 | idempotent rerun 가능 여부 확인, 중복 키/row count 대사 후 rerun |
| 금액/예산/지급 이력 불일치 | 재무 책임자 승인 전 go-live 금지, 원천 재대사 또는 보정 전표 작성 |
| 개인정보/계좌 암호화 실패 | 보안 책임자 승인 전 go-live 금지, raw 파일 격리와 credential revoke |
| critical data-quality 실패 | cutover abort 또는 read-only 전환, rollback/rerun decision 기록 |

## 수동 보정과 감사 로그

- 수동 보정은 정상 API, 보정 migration, 승인된 운영 작업 순으로 수행한다.
- 직접 DB 보정은 `docs/rollback-break-glass-runbook.md`의 break-glass 절차를 따라야 한다.
- 보정 전/후 row count, 금액 합계, 상태별 집계, 대상 ID, 수행자, 승인자, 사유를 남긴다.
- 업무 데이터 보정 후에는 `AuditLog` 또는 정정 감사 로그에 before/after, requestId, incident/cutover ID를 남긴다.
- `audit_logs`와 `security_events`는 직접 수정하지 않는다.

## Rollback And Rerun

- Cutover abort condition, migration rerun strategy, rollback owner, user communication draft를 `DATA_MIGRATION_EVIDENCE_PATH`에 기록한다.
- Target load 전에는 pre-load backup과 PITR restore point를 확인한다.
- Rerun은 idempotent key, source checksum, target row count를 대사한 뒤 실행한다.
- Rollback은 직전 release manifest, DB/PITR, object storage/report artifact 복구 가능성을 확인한 뒤 `docs/rollback-break-glass-runbook.md` 기준으로 승인한다.

## 증빙 체크리스트

- Source extract checksum
- Column mapping workbook
- Failed row quarantine file
- Manual correction approval and AuditLog evidence
- `/api/operations/data-quality` export
- Financial reconciliation export
- Business smoke log and requestId
- Go/no-go decision ID