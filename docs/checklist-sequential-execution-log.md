# Checklist Sequential Execution Log

작성일: 2026-07-09

이 문서는 `erp-system-checklist.md` 미완료 항목을 순서대로 처리하면서 완료, 차단, 다음 증적을 남기는 실행 로그다.

## 23.1 공통 데이터 계층

| 순서 | 체크리스트 항목 | 결과 | 확인 내용 | 다음 조치 |
| --- | --- | --- | --- | --- |
| 1 | P0: 생성/수정/삭제/상태 변경 후 새로고침, 재로그인, 다른 브라우저 접속에서도 데이터가 유지되는지 검증 | 차단 유지 | `tests/e2e/remote-ui-persistence.test.mjs`와 `scripts/generate-db-test-evidence.mjs`는 준비되어 있으나 현재 환경에 `ERP_TEST_DATABASE_URL`이 없고 local PostgreSQL, Docker, psql 실행 환경도 없다. | staging 또는 disposable PostgreSQL에서 `npm run release:db-test-evidence-run` 실행 후 `release/db-test-evidence.json`을 검증한다. |
| 2 | P1: 목록 검색, 필터, 정렬, 페이지네이션을 서버 쿼리 파라미터와 동기화하고 DB 결과와 화면 결과 일치 검증 | 차단 유지 | `useManagedTable`과 보고서/거래처/예산 목록의 서버 query 연결은 구현되어 있으나 실제 DB 대량 데이터와 화면 total/page 대사가 아직 없다. | 동일 test DB에서 서버 query 결과와 화면 결과를 비교하는 E2E/통합 증적을 추가한다. |
| 3 | P2: 화면별 캐시 무효화, 재검증, stale data 표시 정책 정의 | 완료 | `docs/frontend-cache-revalidation-policy.md`를 추가하고 운영 문서 검증 및 release manifest 입력에 연결했다. | 이후 기능 구현 시 이 정책을 기준으로 stale banner, focus revalidation, cross-screen invalidation 회귀 테스트를 확장한다. |

## 23.2 파일 업로드/다운로드

| 순서 | 체크리스트 항목 | 결과 | 확인 내용 | 다음 조치 |
| --- | --- | --- | --- | --- |
| 4 | P2: PDF/이미지 미리보기, 다운로드 만료, 접근 로그 조회 기능 검증 | 완료 | `disposition=inline` signed URL, PDF/JPG/JPEG/PNG preview eligibility, signed URL 만료 표시, `download_request` 접근 로그 disposition/만료 기록, 결제 요청/거래처 preview 버튼을 구현했다. | staging object storage에서 실제 PDF/이미지 preview와 audit log 검색을 smoke 증적으로 남긴다. |

## 23.10 즐겨찾기 및 사용자 설정 연동

| 순서 | 체크리스트 항목 | 결과 | 확인 내용 | 다음 조치 |
| --- | --- | --- | --- | --- |
| 5 | P2: 비활성 메뉴, 권한 회수, 삭제된 필터 참조 시 대체 경로 처리 | 완료 | 비활성 즐겨찾기는 열기와 신규 바로가기 추가를 차단하고 조회/삭제만 허용한다. 대상 화면 권한이 회수된 즐겨찾기는 `getDefaultPage(currentUser)` 기준 안전 화면으로 이동하며, 삭제되었거나 현재 화면에서 지원하지 않는 저장 필터는 화면별 allow-list로 제외하고 사용자 메시지에 표시한다. | staging role smoke에서 권한 회수 전후 즐겨찾기 열기, 비활성 항목 버튼 상태, 삭제 필터 fallback을 실제 계정으로 확인한다. |

## 23.13 테스트 자동화 및 품질 게이트

| 순서 | 체크리스트 항목 | 결과 | 확인 내용 | 다음 조치 |
| --- | --- | --- | --- | --- |
| 6 | P1: 네트워크 실패, 서버 500, validation 실패, 중복 클릭, timeout/retry 테스트 추가 | 완료 | `tests/unit/remoteFailureRecovery.test.ts`를 추가해 remote API timeout, network error, non-JSON server failure, safe-method retry, destructive mutation retry 차단, validation envelope, UI duplicate-click/idempotency guard를 정적 회귀 테스트로 고정했다. | 실제 브라우저 network offline과 delayed response는 staging remote-mode E2E에서 추가 증적으로 확인한다. |
| 7 | P1: 사용자 A/B 간 알림, 즐겨찾기, 권한, 승인 대기 목록 격리 테스트 추가 | 완료 | `tests/unit/userScopeIsolation.test.ts`를 추가해 알림, 즐겨찾기, 시스템 권한, 승인 대기 목록이 현재 인증 사용자 또는 관리자 권한 기준으로 분리되는지 route/source 회귀 테스트로 고정했다. | 실제 두 계정 동시 로그인 브라우저 증적은 staging remote-mode E2E/UAT에서 추가 확인한다. |
| 8 | P2: 대량 데이터 서버 페이지네이션, 보고서 생성 시간, 파일 업로드 성능 테스트 추가 | 완료 | `scripts/verify-performance-capacity.mjs`에 서버 페이지 경계, 보고서 생성 집계, 파일 업로드 chunk/hash synthetic workload를 추가하고 `tests/unit/performanceCapacity.test.ts`와 `release:performance-capacity`에서 함께 검증했다. | 실제 staging/prod DB row count와 object storage 네트워크 조건의 부하 smoke는 배포 검증 단계에서 별도 증적으로 남긴다. |
## 23.12 Backend/API/DB 완성도

| 순서 | 체크리스트 항목 | 결과 | 확인 내용 | 다음 조치 |
| --- | --- | --- | --- | --- |
| 9 | P2: migration, backup/restore, data retention, 장애 복구 리허설 | 차단 유지 | migration review, backup/restore evidence template, data retention policy, rollback/break-glass runbook, `release:backup-restore-evidence` gate는 준비되어 있으나 실제 staging/prod DB, object storage, PITR/WAL, retention 대상 데이터로 수행한 리허설 결과가 없다. | staging 또는 production-like 환경에서 migration deploy/rollback rehearsal, DB restore/PITR, object restore, retention archive/delete dry-run, 장애 복구 smoke를 수행하고 evidence template을 placeholder 없이 채운 뒤 검증한다. |
## 24.2 계정, 권한, 인증 보안

| 순서 | 체크리스트 항목 | 결과 | 확인 내용 | 다음 조치 |
| --- | --- | --- | --- | --- |
| 10 | P2: 정기 권한 검토 리포트와 예외 권한 만료일 관리 | 완료 | `backend/src/operations/permissionReviewReport.ts`와 `GET /operations/permission-review`를 추가해 특권 사용자, 비활성 특권 계정, 예외 권한 만료/만료 예정/만료일 누락, `permission_review` 감사 로그 점검표를 생성한다. 설정 화면 보관 정책 탭에 권한 검토 리포트 카드를 연결하고 mock/remote 서비스 계약과 문서/테스트를 갱신했다. | 실제 production 권한 검토 시 `Role.permissions`의 `exception:<permission>:YYYY-MM-DD` marker, 권한 회수/예외 승인, `permission_review` 감사 로그 증적을 운영 승인 자료에 보관한다. |
| 11 | P2: 개인정보 처리 현황과 외부 감사용 접근 리포트 생성 | 완료 | `backend/src/operations/privacyAccessReport.ts`와 `GET /operations/privacy-access-report`를 추가해 개인정보 처리 inventory, 계좌 암호화/마스킹 상태, 파일 다운로드 사유, 외부 감사 read-only 접근 이력을 생성한다. 설정 화면 보관 정책 탭에 개인정보 접근 리포트 카드를 연결하고 mock/remote 서비스 계약과 문서/테스트를 갱신했다. | 실제 운영 감사 시 리포트 결과와 접근 사유 누락 0건, 외부 감사 read-only 접근, 원문 개인정보/계좌/signed URL token 미포함 증적을 보관한다. |
## 24.5 감사 로그 및 컴플라이언스

| 순서 | 체크리스트 항목 | 결과 | 확인 내용 | 다음 조치 |
| --- | --- | --- | --- | --- |
| 12 | P2: 감사 로그 무결성 검증 hash chain 또는 외부 보관소 연계 검토 | 완료 | `backend/src/operations/auditIntegrityReport.ts`와 `GET /operations/audit-integrity-report`를 추가해 월 단위 AuditLog hash chain, head/tail hash, checkpoint, 외부 보관소 연계 상태를 반환한다. 설정 화면 보관 정책 탭에 감사 로그 무결성 리포트 카드를 연결하고 mock/remote 서비스 계약과 문서/테스트를 갱신했다. | 운영 월마감 시 tail hash와 외부 WORM/감사 저장소 영수증 또는 `AUDIT_ARCHIVE_*` 설정 증적을 함께 보관한다. |
## 24.6 백업, 복구, 재해 대응

| 순서 | 체크리스트 항목 | 결과 | 확인 내용 | 다음 조치 |
| --- | --- | --- | --- | --- |
| 13 | P2: synthetic monitoring으로 로그인부터 지급 전 단계까지 주요 경로 주기 점검 | 완료 | `scripts/run-synthetic-business-monitor.mjs`와 `npm run release:synthetic-monitor`를 추가해 로그인, 주요 업무 조회, 지급 전 목록, 운영 상태를 읽기 전용으로 점검한다. 실패 requestId, latency, output JSON을 운영 monitor 증적으로 남기도록 문서화했다. | staging/prod scheduler에서 5분 또는 10분 주기로 실행하고, go-live 전 최소 24시간 오류율/latency 통과 증빙은 P1 항목에서 별도 보관한다. |
| 14 | P1: 운영 로그와 APM trace에서 secret, cookie, 계좌번호, 파일 URL이 마스킹되는지 확인 | 완료 | `sanitizeLogValue`의 key-value secret redaction을 보강하고 `tests/unit/logApmRedaction.test.ts`, `npm run release:log-apm-redaction`을 추가해 logger와 APM trace 형태 payload를 자동 검증한다. | 실제 외부 APM 수집기 화면 캡처와 vendor 설정 증적은 production environment inventory strict evidence로 보관한다. |
| 15 | P2: DR 환경 전환, DNS failover, 장기 장애 커뮤니케이션 템플릿 준비 | 완료 | docs/disaster-recovery-failover-runbook.md에 전환 승인, DNS failover, 데이터 대사, 장기 장애 공지, failback, 리허설 증적 기준을 정의하고 운영 문서 release gate와 manifest에 연결했다. | 실제 DR endpoint와 DNS provider를 사용한 전환 리허설은 backup/restore P0 증적으로 별도 수행한다. |
| 16 | P2: 데이터 품질 리포트와 반복 정합성 점검 배치 운영 | 완료 | DataQualityRun DB 이력, scheduleKey 중복 방지 worker, 내부 scheduler, critical 관리자 알림, system:manage 실행/이력/JSON 다운로드 API와 시스템 설정 카드를 연결했다. | Production release env gate에서 worker 활성화와 주기 범위를 강제하고 실제 실행 이력은 DB/release evidence로 보관한다. |
