# Incident Response Runbook

작성일: 2026-07-06

이 문서는 결제 요청 승인 ERP 운영 중 장애가 발생했을 때 영향 범위, 책임자, 증거, 완화, 복구, 사후 기록을 일관되게 남기기 위한 절차다.

## Severity 기준

| 등급 | 기준 | 초기 대응 |
| --- | --- | --- |
| P0 | 로그인 불가, 결제 요청/승인/지급 핵심 흐름 중단, 데이터 손상 의심, 권한 우회, 파일 원본 접근 위험 | 즉시 운영/보안/재무 책임자 호출, 변경 freeze, rollback 또는 읽기 전용 전환 판단 |
| P1 | 특정 화면 또는 특정 역할의 업무 실패, 보고서/파일/알림 부분 실패, 반복 5xx 또는 slow query | 담당 운영자 배정, 우회 절차 공지, hotfix 또는 설정 보정 |
| P2 | 사용성 문제, 단건 실패, 문구/필터/정렬 오류, 재시도 가능 오류 | backlog 등록, 다음 릴리즈 또는 운영 개선으로 처리 |

## 접수 정보

장애 접수 시 다음 정보를 반드시 기록한다.

- 발생 시각과 사용자 역할
- 화면명과 수행 버튼
- 요청번호, 승인번호, 지급번호, 거래처명 또는 보고서명
- 오류 메시지와 `requestId`
- 새로고침, 재로그인, 다른 브라우저에서 재현되는지 여부
- 파일 업로드/다운로드 장애인 경우 파일명, 확장자, 크기, scan 상태

## 1차 triage

1. `/api/health`, `/api/health/db`, `/api/health/storage`, `/api/health/file-security`, `/api/health/jobs`, `/api/health/integrations`를 확인한다.
2. `/api/operations/alerts`에서 API 5xx, DB 연결 실패, slow query, 로그인 실패, 권한 실패, 파일 업로드 실패 임계치를 확인한다.
3. `/api/operations/business-failure-alerts`에서 승인, 지급, 보고서, 알림, 파일 도메인의 업무 실패를 확인한다.
4. `/api/operations/data-quality`에서 사용자, 권한, 거래처, 계좌, 예산, 결제 요청, 지급, 첨부파일 critical 정합성 실패를 확인한다.
5. 사용자 오류 메시지의 `requestId`로 API 로그, `audit_logs`, `security_events`를 대사한다.

## 업무별 확인

| 업무 | 확인 기준 |
| --- | --- |
| 결제 요청 | `PaymentRequest`, `ApprovalStep`, `Attachment`, `Notification`, `AuditLog`가 같은 요청번호 기준으로 생성 또는 갱신됐는지 확인 |
| 승인 관리 | 현재 승인자, 결재 순서, `rowVersion`, `WORKFLOW_LOCKED`, requester self-approval 차단 여부 확인 |
| 지급 관리 | 승인 완료, 계좌 확인, 2인 확인 감사 로그, 지급번호/승인번호/금액/거래처 일치 여부 확인 |
| 예산 관리 | 마감 기간, 예산 항목, 사용액/잔액, 조정 이력, 승인 완료 시 원장 반영 여부 확인 |
| 거래처 관리 | 사업자번호 중복, 계좌 암호화/마스킹, 비활성화 영향, 첨부 metadata와 storage 객체 확인 |
| 보고서 | `ReportRun`, `ReportSchedule`, 다운로드 감사 로그, report job health, queue 설정 확인 |
| 시스템 설정 | `settings/config` 최신 AuditLog id, 권한 그룹/사용자 권한, 외부 연동 credential reference와 HTTPS endpoint 확인 |
| 즐겨찾기 | `FavoriteItem` row, 정렬 순서, 저장 필터, 다른 브라우저 동기화 여부 확인 |

## 완화 조치

- P0 장애는 신규 배포와 운영 데이터 변경을 freeze한다.
- 특정 mutation이 실패하면 해당 버튼을 업무 공지로 보류하고 조회 전용 운영을 검토한다.
- 파일 storage 또는 malware scanner 장애면 신규 업로드를 중지하고 기존 파일 다운로드 권한과 signed path 상태를 확인한다.
- 지급 관련 장애는 은행 이체 파일 생성과 지급 실행을 중지하고 재무 책임자 승인을 받기 전 재처리하지 않는다.
- 권한 이상 또는 데이터 노출 의심은 세션 무효화, 관련 권한 그룹 비활성화, 보안 이벤트 보관을 우선한다.

## Rollback 기준

다음 중 하나라도 해당하면 rollback 또는 직전 artifact 승격을 검토한다.

- 직전 배포 이후 P0가 발생했고 hotfix 예상 시간이 업무 중단 허용 시간을 초과한다.
- migration 또는 데이터 이관 후 `data-quality` critical 실패가 발생했다.
- production API와 frontend artifact version 또는 manifest checksum이 staging 승인 증적과 다르다.
- 권한 우회, 원문 계좌 노출, 파일 직접 URL 노출 같은 보안 실패가 확인된다.
- 지급 상태, 은행 결과, 감사 로그가 서로 불일치하고 보정 기준이 승인되지 않았다.

Rollback 후에는 `/api/health/*`, 로그인, 결제 요청 목록, 승인 처리 dry-run, 파일 다운로드, 보고서 다운로드, `operations/alerts`, `business-failure-alerts`, `data-quality`를 다시 확인한다.

## 커뮤니케이션

1. P0/P1은 운영 채널에 최초 인지 시각, 영향 범위, 임시 조치, 다음 업데이트 시각을 공지한다.
2. 사용자 공지에는 내부 stack trace나 secret을 포함하지 않는다.
3. 재무 영향이 있으면 재무 책임자와 승인 책임자에게 별도 공유한다.
4. 해결 후 원인, 영향 건수, 복구 완료 시각, 재발 방지 항목을 남긴다.

## 사후 기록

장애 종료 후 다음 자료를 보관한다.

- 관련 release manifest hash, migration review hash, 배포 시각
- 사용자 제보와 `requestId`
- API 로그, 감사 로그, 보안 이벤트, business failure alert 결과
- 수행한 rollback, hotfix, 수동 보정 내역
- 남은 known issue, 우회 절차, 책임자, 보완 기한
