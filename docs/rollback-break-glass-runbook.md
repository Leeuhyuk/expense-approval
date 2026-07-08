# Rollback And Break-Glass Runbook

작성일: 2026-07-08

이 문서는 정적 프론트, API 서버, DB migration, object storage, report artifact rollback과 운영자 break-glass 접근을 같은 승인 체계로 묶는 운영 기준이다. 실제 production 후보 전에는 이 절차가 `docs/backup-restore-rehearsal-template.md`, `docs/production-go-live-evidence-template.md`, `docs/final-acceptance-evidence-template.md`의 증빙과 연결되어야 한다.

## 원칙

- 운영자 직접 DB 수정 금지는 기본 원칙이다. 정상 복구는 API, 보정 migration, 승인된 운영 작업, 또는 재처리 job으로 수행한다.
- break-glass는 P0 장애, 데이터 손상 의심, 권한/보안 사고, 지급 정합성 위험처럼 정상 경로로 업무 중단을 해소할 수 없을 때만 허용한다.
- 모든 rollback과 break-glass는 incident ID, release manifest hash, requestId 또는 운영 작업 ID, 승인자, 수행자, 시작/종료 시각, 증적 링크를 남긴다.
- 감사 로그(`audit_logs`)와 보안 이벤트(`security_events`)는 수정/삭제하지 않는다. 잘못 기록된 감사 로그는 정정 기록을 추가로 남긴다.
- 지급, 계좌, 예산, 권한, 파일 원본 접근에 영향을 주는 조치는 재무 책임자와 보안 책임자 중 해당 영역 책임자의 승인이 없으면 수행하지 않는다.

## 승인 매트릭스

| 상황 | 최소 승인 | 필수 증빙 |
| --- | --- | --- |
| 정적 frontend artifact rollback | 운영 책임자 | 직전 artifact checksum, hosting rollback log, 사용자 공지 |
| API 서버 rollback | 운영 책임자, 기능 책임자 | 직전 backend artifact checksum, 배포 로그, health check |
| DB migration 보정 또는 PITR | DBA, 운영 책임자, 재무 책임자 | backup/PITR 확인, migration review hash, 보정 SQL review |
| object storage/report artifact restore | 운영 책임자, 보안 책임자 | bucket versioning 증빙, restored object list, signed URL 검증 |
| break-glass DB 접근 | DBA, 보안 책임자, 운영 책임자, 영향 영역 책임자 | incident ID, 접근 계정, SQL diff, before/after 대사, revoke 기록 |
| 지급 상태 수동 보정 | 재무 책임자, 운영 책임자, 2차 검토자 | 지급번호, 은행 결과, AuditLog, 거래처 지급 이력, 보고서 대사 |

## Rollback 수행 순서

1. incident commander를 지정하고 P0/P1 등급, 영향 범위, 사용자 공지 필요 여부를 기록한다.
2. 신규 배포와 운영 데이터 변경을 freeze하고, 필요하면 `ERP_OPERATION_MODE=read_only`, `payments_paused`, `uploads_paused`, `maintenance` 중 하나로 전환한다.
3. 현재 release identity, `release/release-manifest.json` hash, migration review hash, frontend/backend artifact checksum을 고정한다.
4. 정적 frontend는 직전 versioned artifact로 되돌리고 `dist/_headers`의 HTTPS/cache-control 정책이 유지되는지 확인한다.
5. API 서버는 직전 backend artifact 또는 이미지로 되돌린다. DB schema가 하위 호환되지 않으면 API rollback보다 read-only 전환과 DB 복구 판단을 우선한다.
6. DB migration 문제는 먼저 staging restore에서 재현하고, PITR 또는 보정 migration 중 하나를 승인한다. production에 직접 ad hoc SQL을 적용하지 않는다.
7. object storage 또는 report artifact 문제는 versioning 또는 backup에서 복구한 뒤 DB metadata와 object key를 대사한다.
8. 복구 후 `/api/health/*`, `/api/operations/alerts`, `/api/operations/business-failure-alerts`, `/api/operations/data-quality`, `/api/operations/financial-reconciliation`, `npm run release:core-smoke`를 실행해 health, 업무 smoke, requestId를 남긴다.
9. 사용자 공지, known issue, 우회 절차, 다음 업데이트 시각을 운영 채널에 기록한다.
10. 사후 분석 템플릿에 원인, 영향, 수행한 rollback, 재발 방지 항목, 소유자, 기한을 남긴다.

## Break-Glass 절차

1. break-glass 요청자는 incident ID, 대상 데이터, 업무 영향, 정상 경로로 해결할 수 없는 이유, 예상 SQL 또는 복구 작업을 기록한다.
2. 승인자는 DBA, 보안 책임자, 운영 책임자, 영향 영역 책임자로 분리한다. 같은 사람이 요청자와 최종 승인자를 겸하지 않는다.
3. 접근 계정은 secret manager에서 time-boxed credential 또는 일회성 권한으로 발급하고, 가능하면 session recording 또는 query audit을 켠다.
4. 변경 전 full backup 또는 PITR restore point를 확인하고, 대상 row count와 합계, 상태별 집계를 캡처한다.
5. SQL은 transaction 안에서 실행하고, `SELECT` 검증, 예상 변경 row count, `COMMIT` 조건을 명시한다. 예상과 다르면 `ROLLBACK`한다.
6. 감사 로그와 보안 이벤트 테이블은 직접 수정하지 않는다. 업무 데이터 보정이 필요한 경우 별도 정정 감사 로그를 추가한다.
7. 변경 후 `data-quality`, `financial-reconciliation`, 관련 업무 화면 smoke, requestId 로그, AuditLog/security_events 대사를 수행한다.
8. break-glass 계정과 임시 권한을 즉시 revoke하고, secret manager version 또는 DB role 변경 기록을 보관한다.
9. 사후 분석에서 왜 정상 운영 기능이 부족했는지 확인하고, 다음 릴리즈 backlog 또는 운영 자동화 항목으로 연결한다.

## 복구 후 검증 쿼리와 Smoke

| 영역 | 검증 |
| --- | --- |
| 사용자/권한 | `/api/operations/data-quality`의 orphan role, inactive user assignment, 권한 불일치가 없어야 함 |
| 결제 요청/승인 | 요청 상태, pending approval step, AuditLog, Notification이 같은 requestId 또는 요청번호 기준으로 일치 |
| 지급 | Disbursement 상태, 은행 결과, 지급 감사 로그, 거래처 지급 이력, 보고서 금액이 일치 |
| 파일 | Attachment metadata, object key, signed URL, malware scan verdict, 파일 권한 이벤트가 일치 |
| 보고서 | ReportRun artifactKey, 저장 metadata, 다운로드 감사 로그가 같은 run 기준으로 일치 |
| 예산 | BudgetItem used/allocated/remaining, 승인 완료 요청 합계, 재무 대사 결과가 일치 |

복구 후에는 최소한 `npm run release:core-smoke`와 운영 endpoint 조회 결과를 incident record에 붙인다. Production에서 이 명령을 실행할 때는 `CORE_SMOKE_API_BASE_URL`, smoke 계정, privileged 포함 여부를 증빙에 함께 기록한다.

## 사후 분석 템플릿

| 항목 | 값 |
| --- | --- |
| Incident ID | TBD |
| Severity | P0/P1/P2 |
| Incident commander | TBD |
| 기능/보안/재무/운영 담당자 | TBD |
| 최초 감지 시각 | TBD |
| 사용자 영향 | TBD |
| 데이터 영향 | TBD |
| 재무 영향 | TBD |
| 수행한 rollback 또는 break-glass | TBD |
| 관련 release manifest hash | TBD |
| 관련 migration review hash | TBD |
| 관련 requestId/AuditLog/security_events | TBD |
| root cause | TBD |
| detection gap | TBD |
| recurrence prevention action | TBD |
| action owner/deadline | TBD |
| 사용자 공지 링크 | TBD |
| 최종 승인자 | TBD |