# Admin Manual

작성일: 2026-07-06

이 문서는 관리자와 운영자가 시스템 설정, 권한, 운영 점검, 배포 전 검증을 수행할 때 사용하는 기준이다. 실제 production 승인 전에는 역할별 UAT와 go-live 승인 기록을 별도로 보관한다.

## 권한과 사용자 관리

1. 시스템 설정에서 권한 그룹, 사용자 권한, 부서, 활성 상태를 관리한다.
2. 기본 역할은 요청자, 승인자, 재무팀, 외부 감사, 관리자이며 `src/domain/rolePolicy.ts`가 최소 권한 기준이다.
3. 관리자 역할만 wildcard 또는 `system:manage` 성격의 권한을 가진다.
4. 외부 감사는 감사/보고서 조회 중심의 read-only 권한으로 유지한다.
5. 권한 그룹 삭제는 배정된 사용자가 없는 경우에만 허용된다.
6. 사용자 권한 변경은 다음 API 호출부터 backend permission check에 반영된다.
7. production 계정 배정은 보안/운영 책임자 승인 후 `PRODUCTION_ACCESS_REVIEW_*` 증적을 release 환경에 설정한다.
8. 시스템 설정의 보관 정책 탭에서 정기 권한 검토 리포트를 조회해 특권 사용자, 비활성 특권 계정, 예외 권한 만료/만료 예정/만료일 누락을 확인한다. 임시 예외는 `Role.permissions`에 `exception:<permission>:YYYY-MM-DD` marker를 함께 저장하고, 검토 완료 시 `permission_review` 감사 로그를 남긴다.
9. 같은 탭의 개인정보 접근 리포트에서 사용자/거래처/첨부/보고서 처리 현황, 계좌 암호화/마스킹 상태, 파일 다운로드 사유, 외부 감사 read-only 접근 이력을 확인한다. 리포트 응답에는 `beforeValue`, `afterValue`, 계좌 원문, signed URL token을 포함하지 않는다.
10. 감사 로그 무결성 리포트에서 월 단위 hash chain 길이, head/tail hash, checkpoint, 외부 보관소 연계 상태를 확인한다. 운영 월마감에는 tail hash와 `AUDIT_ARCHIVE_ENDPOINT` 또는 `AUDIT_ARCHIVE_BUCKET` 보관 증적을 함께 보관한다.

## 결재 정책과 업무 설정

1. 승인 한도와 결재선 규칙은 시스템 설정의 결재 정책에서 관리한다.
2. 정책 변경은 신규 결제 요청과 신규 결재선 선택에 즉시 적용된다.
3. 진행 중 결재 건은 생성 당시 결재선 스냅샷을 유지한다.
4. 알림 설정과 외부 연동 설정은 `PATCH /settings/config/{key}`로 append-only AuditLog snapshot에 저장된다.
5. 외부 연동 테스트는 credential reference, 서버 secret, HTTPS endpoint를 요구하며 원문 secret을 화면이나 DB에 저장하지 않는다.
6. 설정 저장은 `idempotencyKey`와 최신 AuditLog id 기준으로 중복 저장과 stale save conflict를 처리한다.

## 파일과 보안

- 모든 허용 확장자 파일은 바이러스 검사 대상으로 관리한다.
- 파일은 PDF, JPG, JPEG, PNG, XLSX와 10MB 제한을 따른다.
- PDF와 다운로드는 권한 검증 후 API signed path를 제공한다.
- 세금계산서 파일은 5년 보관 기준을 따른다.
- 비밀번호는 최소 12자, 대문자, 소문자, 숫자, 특수문자를 포함해야 하며 기본 90일 만료 정책을 따른다.
- 시스템 설정의 보안 탭에서 본인 비밀번호를 변경할 수 있고, 변경 시 다른 활성 세션은 종료되며 감사 로그에 기록된다.
- production에서는 HttpOnly Secure session cookie와 CSRF double-submit token을 사용한다.
- 거래처 계좌번호는 `BANK_ACCOUNT_SECRET`으로 암호화 저장하고 화면, 로그, 운영 점검 요약에는 마스킹 값만 노출한다.

## 복구와 정합성

- 관리자 수동 복구는 `system:manage` 권한을 가진 관리자가 요청하고, 다른 관리자가 2차 승인해야 적용된다.
- 복구 사유와 감사 로그 기록은 필수다.
- 지급 완료 건 복구는 2차 검토자 승인을 요구한다.
- 승인/지급/예산 데이터는 rowVersion, idempotencyKey, 승인번호, 금액, 거래처 기준으로 대사한다.
- 운영 전 또는 이관 직후 `GET /api/operations/data-quality`로 사용자, 권한, 거래처, 계좌, 예산, 결제 요청, 지급, 첨부파일 정합성을 점검한다.
- 승인/지급/보고서/알림/파일 처리 실패는 `GET /api/operations/business-failure-alerts`로 확인하고, `POST /api/operations/business-failure-alerts/notify`로 운영 담당자 알림을 생성한다.
- API 5xx, 로그인 실패, 권한 실패, slow query, 파일 업로드 실패는 `GET /api/operations/alerts`로 확인한다.
- 장애 대응과 rollback 판단은 `docs/incident-response.md`, `docs/deployment-operations.md`, `docs/rollback-break-glass-runbook.md`를 함께 따른다.

## 운영자 직접 DB 수정 금지와 Break-Glass

- 운영자 직접 DB 수정 금지는 기본 원칙이며, 정상 복구는 API, 보정 migration, 승인된 운영 작업, 재처리 job을 우선한다.
- break-glass DB 접근은 P0 장애, 데이터 손상 의심, 권한/보안 사고, 지급 정합성 위험처럼 정상 경로로 해결할 수 없는 경우에만 incident ID 기준으로 허용한다.
- break-glass 승인자는 DBA, 보안 책임자, 운영 책임자, 영향 영역 책임자로 분리하고, 요청자와 최종 승인자는 겸하지 않는다.
- 접근 계정은 secret manager에서 time-boxed credential로 발급하고, 수행 후 즉시 revoke한다.
- 변경 전 backup 또는 PITR restore point, 대상 row count, 금액 합계, 상태별 집계를 보관하고, 변경 후 `data-quality`, `financial-reconciliation`, `release:core-smoke`, 관련 AuditLog/security_events 대사를 수행한다.
- `audit_logs`와 `security_events`는 직접 수정하지 않고, 잘못된 기록은 정정 감사 로그를 추가로 남긴다.

## 배포 운영

- 배포 전 `npm test`, `npm run build`, `npm --prefix backend run build`, `npm run release:operational-docs`, `npm run release:environment-inventory`, `npm run release:staging-smoke-evidence`, `npm run release:backup-restore-evidence`, `npm run release:data-migration-evidence`, `npm run release:role-uat-evidence`, `npm run release:production-go-live-evidence`, `npm run release:post-go-live-stabilization-evidence`, `npm run release:final-acceptance-evidence`, `npm run release:release-note`, `npm run release:go-live-readiness`, `npm run release:go-live-readiness-report`, `npm run release:submission`, `npm run release:log-apm-redaction`, `npm run release:core-smoke`, `npm run release:synthetic-monitor`를 통과시킨다.
- release candidate는 `npm run release:migration-check`, `npm run release:migration-review`, `npm run release:verify-migration-review`, `npm run release:audit-append-only`, `npm run release:mutation-safety`, `npm run release:sensitive-data`, `npm run release:log-apm-redaction`, `npm run release:db-test-evidence-run`, `npm run release:db-test-evidence`, `npm run release:performance-capacity`, `npm run release:environment-inventory`, `npm run release:staging-smoke-evidence`, `npm run release:backup-restore-evidence`, `npm run release:data-migration-evidence`, `npm run release:role-uat-evidence`, `npm run release:production-go-live-evidence`, `npm run release:post-go-live-stabilization-evidence`, `npm run release:final-acceptance-evidence`, `npm run release:manifest`, `npm run release:verify-manifest` 증적을 보관한다. `release/db-test-evidence.json`에는 폐기 가능한 test DB에서 실행한 DB integration, remote auth E2E, remote UI E2E가 모두 skip 없이 통과했다는 결과가 있어야 한다. Production 후보의 `npm run release:check`에는 `EXPECTED_RELEASE_MANIFEST_SHA256`와 `EXPECTED_RELEASE_SOURCE_REF`를 넣어 staging에서 보관한 manifest와 같은 release evidence만 승격되게 한다.
- 운영 배포는 staging에서 동일 artifact와 동일 migration을 먼저 검증한 뒤 production에 승격하는 절차로 수행한다.
- production 후보 전 `docs/production-environment-inventory-template.md`를 복사해 배포 플랫폼, production 도메인, DB, object storage, secret manager, monitoring, backup/PITR, WAF/CDN 증적을 채우고 `PRODUCTION_ENVIRONMENT_INVENTORY_PATH`로 지정한다. Production release gate는 미확정 placeholder가 남아 있으면 실패한다.
- production 후보 전 `docs/staging-smoke-evidence-template.md`를 복사해 동일 release artifact, staging DB/object storage/scanner, health check, 업무 smoke, 새로고침/재로그인/다른 브라우저 유지, 보안 smoke 증적을 채우고 `STAGING_SMOKE_EVIDENCE_PATH`로 지정한다. Production release gate는 미확정 placeholder가 남아 있으면 실패한다.
- production 후보 전 `docs/backup-restore-rehearsal-template.md`를 복사해 RPO/RTO, PostgreSQL full backup, WAL/PITR, object storage versioning, report artifact backup, staging restore rehearsal, rollback rehearsal, backup alert/encryption/access 증적을 채우고 `BACKUP_RESTORE_EVIDENCE_PATH`로 지정한다. Production release gate는 미확정 placeholder가 남아 있으면 실패한다.
- production 후보 전 `docs/data-migration-evidence-template.md`를 복사해 원천 시스템, 컬럼 매핑, 이관 범위, freeze window, staging rehearsal, production 대사, 개인정보/계좌정보 보호, rollback 조건, 담당자 승인 증적을 채우고 `DATA_MIGRATION_EVIDENCE_PATH`로 지정한다. Production release gate는 미확정 placeholder가 남아 있으면 실패한다.
- production 후보 전 `docs/role-uat-evidence-template.md`를 복사해 요청자, 승인자, 재무팀, 관리자, 외부 감사 역할별 실제 계정, 권한 경계, 파일럿 부서/기간, 지급 dry-run, 주요 업무 시나리오, P0/P1 이슈 처리, 교육/지원, 최종 역할별 sign-off 증적을 채우고 `ROLE_UAT_EVIDENCE_PATH`로 지정한다. Production release gate는 미확정 placeholder가 남아 있으면 실패한다.
- production 후보 전 `docs/production-go-live-evidence-template.md`를 복사해 release/migration/artifact/env checksum, production migration, backend health, frontend smoke, 업무 smoke, open P0/예외 승인, rollback, freeze/communication, 최종 production sign-off 증적을 채우고 `PRODUCTION_GO_LIVE_EVIDENCE_PATH`로 지정한다. Production release gate는 미확정 placeholder뿐 아니라 잘못된 hash 형식, manifest hash 불일치, non-HTTPS production URL, health/smoke 미통과, open P0 count 미기록, evidence link/sign-off 형식 누락이 있으면 실패한다.
- 안정화 판정 전 `docs/post-go-live-stabilization-evidence-template.md`를 복사해 첫 주 로그인 실패, API 5xx, 승인 실패, 지급 실패, 파일 업로드 실패, 보고서 실패 daily check, 첫 지급 은행 결과/ERP 상태/AuditLog/거래처 지급 이력/report totals 대사, production data backup/PITR, P0/P1 당일 대응, hypercare 리포트, 남은 backlog, 최종 sign-off 증적을 채우고 `POST_GO_LIVE_STABILIZATION_EVIDENCE_PATH`로 지정한다. Production release gate는 미확정 placeholder가 남아 있으면 실패한다.
- 실사용 가능 최종 판정 전 `docs/final-acceptance-evidence-template.md`를 복사해 실제 production 사용자 결제 요청/승인/재무팀 지급 전 단계 처리, DB/object storage 저장, 새로고침/재로그인/다른 기기 유지, 권한 없는 사용자 UI/API 차단, AuditLog/security_events/requestId, 중복 승인/중복 지급/승인 전 지급/마감 후 변경/계좌 불일치 지급 backend 차단, rollback/복구/읽기 전용/사용자 공지, 배포/모니터링/백업/장애 대응/사용자 지원 인수, KPI/오류율, backlog/운영 릴리즈 계획, 최종 sign-off 증적을 채우고 `FINAL_ACCEPTANCE_EVIDENCE_PATH`로 지정한다. Production release gate는 미확정 placeholder가 남아 있으면 실패한다.
- `npm run release:go-live-readiness-report`로 전체 open P0 blocker를 `release/go-live-readiness-report.json`과 `release/go-live-readiness-report.md`에 남겨 증빙 담당자, 필요한 외부 증적, 목표별 차단 상태를 추적한다.
- `npm run release:submission`으로 `docs/release-submission-package.md`를 갱신해 위임 승인과 조건부 readiness 제출 상태를 GitHub main 커밋에 남긴다.
- go-live 전 `docs/go-live-handoff-template.md`를 복사해 실제 담당자, known issue, 우회 절차, rollback 기준, 지원 연락망, sign-off 증적을 채우고, `docs/release-note-template.md`를 복사해 기능 변경, DB 변경, 권한 변경, 운영 영향, known issue, rollback 조건을 확정한 뒤 `RELEASE_NOTE_PATH`로 지정하고 `GO_LIVE_HANDOFF_PATH`로 지정한다. Production release gate는 미확정 placeholder가 남아 있으면 실패한다.
- staging에서 DB migration과 `/api/health`, `/api/health/version`, `/api/health/db`, `/api/health/storage`, `/api/health/file-security`, `/api/health/jobs`, `/api/health/integrations`, `/api/operations/data-quality`를 먼저 확인한다.
- 운영 DB에는 seed를 자동 실행하지 않는다.
- 장애 대응은 `docs/deployment-operations.md`의 절차를 따른다.

## 운영 인수 보조 문서

- Cutover 당일에는 `docs/cutover-runbook.md`의 담당자 연락망, freeze window, 이관 실패/rerun, 수동 보정 감사 로그 기준을 따른다.
- 사용자 교육, 운영 FAQ, 오류 신고 양식, requestId 수집 방법은 `docs/user-training-faq.md`를 따른다.
- 운영 첫 주 daily check와 hypercare 리포트는 `docs/hypercare-runbook.md`를 따른다. `npm run release:synthetic-monitor`는 운영 monitor 또는 scheduler에서 5분/10분 주기로 실행하고 실패 requestId와 output JSON을 보관한다.
- Release마다 `docs/release-readiness-decision.md`를 복사해 `release:go-live-readiness-report` 결과와 open blocker/backlog를 연결한다.
- dev/staging/production 환경 분리 확인은 `docs/environment-separation-matrix-template.md`를 복사해 `ENVIRONMENT_SEPARATION_PATH`로 지정하고 release gate에서 검증한다.
## 백업과 이관

1. production DB는 migration 전 backup, PITR/WAL 보관, 접근 권한을 확인한다.
2. object storage는 private bucket, versioning, lifecycle, at-rest encryption, malware scan 경로를 확인한다.
3. staging 이관 rehearsal 후 건수, 총액, 상태별 집계, 예산 잔액, 지급 이력, 첨부 orphan을 대사한다.
4. production 이관 직후 `/api/operations/data-quality` critical 실패가 없어야 한다.
5. 데이터 이관 증빙과 backup/복구 리허설 증적은 go-live 승인 자료와 함께 보관한다.
