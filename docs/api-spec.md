# ERP API Specification

작성일: 2026-07-04

기준: `docs/core-business-rules.md`, `src/api/contracts.ts`

## 공통 규칙

- Base path: `/api`
- 응답은 `status`, `data` 또는 `error`, `meta`를 가진 표준 포맷을 사용한다.
- 성공/실패 응답 모두 `meta.requestId`를 포함해 프론트 오류 메시지, API 로그, 감사/보안 이벤트를 같은 요청으로 추적한다.
- 목록 API는 `page`, `pageSize`, `search`, `sort`, `filters`를 공통 파라미터로 받는다.
- 상태 변경 API는 `rowVersion`과 `idempotencyKey`를 필수로 받는다.
- 승인, 반려, 보류, 지급 실행은 모두 감사 로그를 남긴다.
- 파일 다운로드와 미리보기는 권한 검증과 다운로드 사유 감사 로그 기록 후 signed URL을 반환한다.
- 파일 업로드는 확장자/용량 검증 뒤 malware scan을 통과해야 저장소에 기록되고, 차단 파일은 `blocked` scan status로 남긴다.
- 권한 실패, 파일 접근 거부, signed URL 거부, 파일 업로드 검증 실패는 업무 감사 로그와 별도로 보안 이벤트에 기록한다.
- 실패 응답의 `error.code`와 `meta.requestId`는 프론트 오류 메시지와 `security_events`에 그대로 연결된다. `FORBIDDEN`은 `access_denied`, `IDEMPOTENCY_CONFLICT`는 `duplicate_request_blocked`, `PARTIAL_FAILURE`는 `partial_failure`, `OPERATION_MODE_RESTRICTED`는 `workflow_blocked`, `SERVER_ERROR`는 `server_failure`로 분류한다.

## 응답 포맷

```ts
type ApiResponse<T> =
  | { status: "success"; data: T; meta?: ApiMeta }
  | { status: "error"; error: ApiError; meta?: ApiMeta };
```

주요 에러 코드:

| 코드 | 의미 |
| --- | --- |
| `VALIDATION_ERROR` | 필수값, 금액, 날짜, 상태값 검증 실패 |
| `UNAUTHORIZED` | 로그인 필요 |
| `FORBIDDEN` | 역할 또는 데이터 범위 권한 부족 |
| `ACCOUNT_LOCKED` | 로그인 실패 반복으로 계정 잠금 |
| `DORMANT_ACCOUNT` | 휴면 계정 로그인 차단 |
| `PASSWORD_EXPIRED` | 비밀번호 만료로 로그인 전 변경 필요 |
| `NOT_FOUND` | 대상 없음 |
| `CONFLICT` | rowVersion 불일치 또는 이미 처리됨 |
| `IDEMPOTENCY_REPLAY` | 같은 idempotencyKey 재요청 |
| `IDEMPOTENCY_CONFLICT` | idempotencyKey가 다른 업무 처리에 이미 사용됨 |
| `PARTIAL_FAILURE` | 일괄 처리 중 일부 항목 실패 |
| `WORKFLOW_LOCKED` | 최종 상태 또는 업무 마감으로 처리 불가 |
| `OPERATION_MODE_RESTRICTED` | 장애/점검 기능 제한 모드로 변경 작업 차단 |
| `SERVER_ERROR` | 서버 오류 |
| `MALWARE_BLOCKED` | 파일 보안 검사 차단 |
| `SCAN_UNAVAILABLE` | 파일 보안 검사 실패 또는 검사 엔진 장애 |
| `RATE_LIMITED` | API rate limit 초과 |

## 인증

| Method | Path | 설명 |
| --- | --- | --- |
| `POST` | `/auth/login` | 이메일/비밀번호 hash 검증, 로그인 실패 잠금/휴면 계정 차단, DB 세션 생성, HttpOnly 세션 쿠키 발급 |
| `POST` | `/auth/logout` | 현재 세션 폐기. body `{ "allSessions": true }` 전달 시 사용자 전체 활성 세션 폐기 |
| `GET` | `/auth/me` | 현재 사용자, 역할, 권한, 부서 범위 반환 |
| `POST` | `/auth/refresh` | 세션 idle 만료 연장 및 세션 id 회전 |
| `GET` | `/auth/password-policy` | 비밀번호 최소 길이, 만료 주기, 필수 조합 정책 조회 |
| `POST` | `/auth/password/change-expired` | 만료 로그인 사용자가 현재 비밀번호와 새 비밀번호로 세션 없이 비밀번호 변경 |
| `POST` | `/auth/password/change` | 로그인 사용자가 현재 비밀번호 검증 후 새 비밀번호로 변경 |

세션 기본 정책은 유휴 만료 30분, 절대 만료 12시간이다. 세션 상태는 DB `auth_sessions`에 저장하며 `revokedAt`, `idleExpiresAt`, `absoluteExpiresAt`을 서버에서 검증한다.
`POST`, `PUT`, `PATCH`, `DELETE` API는 `/auth/login`과 signed file content upload를 제외하고 `erp_csrf` cookie와 동일한 `X-CSRF-Token` 헤더를 요구한다.
비밀번호 정책은 기본 최소 12자, 대문자/소문자/숫자/특수문자 포함, 90일 만료이며 `PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_AGE_DAYS`로 조정한다. 비밀번호 변경은 `password_change` 감사 로그를 남기고 다른 활성 세션을 종료한다.

## Health

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/health` | API 프로세스 기본 생존 확인 |
| `GET` | `/health/db` | PostgreSQL 연결과 latency 확인 |
| `GET` | `/health/storage` | 파일 저장소 driver와 read/write 가능 상태 확인 |
| `GET` | `/health/file-security` | 파일 보안 scan mode와 외부 scanner 설정 확인 |
| `GET` | `/health/jobs` | 보고서 예약 job backlog, 최근 실패/dead-letter, retry/timeout/circuit breaker 정책, worker/queue 설정 확인 |
| `GET` | `/health/integrations` | 회계/은행 외부 연동 credential reference, HTTPS endpoint, 마지막 점검 상태 확인 |

운영 의존성이 준비되지 않은 health 항목은 HTTP 503과 `data.ok=false`로 응답한다.

## Operations

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/operations/mode` | 로그인 사용자에게 현재 운영 제한 모드와 차단 capability 조회 |
| `GET` | `/operations/alerts` | API 5xx, DB 연결 실패, slow query, 로그인/권한 실패 급증, 파일 업로드 실패 임계치 평가 |
| `GET` | `/operations/business-failure-alerts` | 승인/지급/보고서/알림/파일 처리 실패를 업무 도메인별로 집계 |
| `POST` | `/operations/business-failure-alerts/notify` | 업무 실패 임계치 초과 시 `system:manage` 담당자에게 운영 알림 생성 |
| `GET` | `/operations/report-jobs` | 보고서 예약 job due schedule, retry/dead-letter/circuit breaker 상태 dry-run 조회 |
| `POST` | `/operations/report-jobs/run` | 보고서 예약 job을 batch 실행하고 성공/재시도/dead-letter 결과 기록 |
| `GET` | `/operations/performance-policy` | p95/p99 latency 목표, report job 최대 처리 시간, 대량 다운로드 제한 기준 조회 |
| `GET` | `/operations/data-quality` | 이관/운영 전 사용자, 권한, 거래처, 예산, 결제 요청, 지급, 첨부파일 정합성 점검 |
| `GET` | `/operations/financial-reconciliation` | 예산 사용액, 승인 요청, 지급 완료, 보고서 드릴다운 스냅샷 금액 대사 |
| `POST` | `/operations/financial-reconciliation/notify` | 재무 대사 불일치 발생 시 `system:manage` 담당자에게 운영 알림 생성 |
| `GET` | `/operations/manual-recoveries` | 관리자 수동 복구 요청, 승인, 반려 이력과 대기 건 조회 |
| `POST` | `/operations/manual-recoveries` | 지급 건 수동 복구 요청 생성. 사유/idempotencyKey 필수 |
| `POST` | `/operations/manual-recoveries/{id}/approve` | 다른 관리자가 수동 복구를 승인하고 지급 상태 변경 적용 |
| `POST` | `/operations/manual-recoveries/{id}/reject` | 다른 관리자가 수동 복구 요청 반려 |
| `GET` | `/operations/financial-control-report` | 재무 통제 예외와 월말 결산 점검표 생성 |
| `GET` | `/operations/audit-logs` | `audit:read` 또는 `system:manage` 권한으로 감사 로그 요약 검색 |
| `GET` | `/operations/retention-policy` | 감사 로그, 알림, 첨부 metadata, 보고서 산출물 보관/불변성 정책과 정리 대상 조회 |
| `GET` | `/operations/account-lifecycle` | 휴면/퇴사자 계정 비활성화 후보 조회 |
| `POST` | `/operations/account-lifecycle/deactivate` | 사유/idempotencyKey 기준으로 휴면/퇴사자 계정 비활성화와 세션 종료 실행 |

`/operations/mode`는 로그인 사용자가 현재 운영 제한 모드를 조회하는 endpoint다. `ERP_OPERATION_MODE=normal|read_only|payments_paused|uploads_paused|maintenance`와 `ERP_DISABLED_CAPABILITIES=business_mutations,payments,file_uploads`를 기준으로 `disabledCapabilities`, `restrictions`, `readOnly`, `active`를 반환한다. 서버 전역 preHandler는 이 상태를 사용해 `read_only`/`maintenance`에서 인증 유지 route를 제외한 business mutation을 차단하고, `payments_paused`에서는 `/api/disbursements`의 지급 변경 mutation을 차단하며, `uploads_paused`에서는 `/api/files/presign-upload`, signed content `PUT`, `/api/files/complete`를 `OPERATION_MODE_RESTRICTED`로 차단한다.

`/operations/alerts`는 `system:manage` 권한이 필요하며, 최근 `ALERT_WINDOW_MINUTES` 동안의 `security_events` 집계와 DB 연결 check를 기준으로 `data.ok=false`인 경우 HTTP 503을 반환한다. Slow query 이벤트는 `SLOW_QUERY_MS`를 초과한 Prisma query duration만 기록하며 raw SQL과 parameter는 저장하지 않는다. 응답의 `metrics`는 reviewed event 수, alert rule failure rate, critical/warning triggered 수, slow query `durationMs` 기반 p95/p99/max latency, DB health latency, `PERFORMANCE_P95_TARGET_MS`/`PERFORMANCE_P99_TARGET_MS` 목표 대비 상태를 포함하며 dashboard 운영 지표 카드에서 사용한다.

`/operations/business-failure-alerts`는 `system:manage` 권한이 필요하며, 최근 `ALERT_WINDOW_MINUTES` 동안의 `security_events.path`와 `eventType`을 기준으로 승인, 지급, 보고서, 알림, 파일 실패를 업무 이벤트 단위로 묶는다. `ALERT_APPROVAL_FAILURE_THRESHOLD`, `ALERT_DISBURSEMENT_FAILURE_THRESHOLD`, `ALERT_REPORT_FAILURE_THRESHOLD`, `ALERT_NOTIFICATION_FAILURE_THRESHOLD`, `ALERT_FILE_PROCESSING_FAILURE_THRESHOLD`로 도메인별 임계치를 조정한다. `POST /operations/business-failure-alerts/notify`는 임계치를 넘은 도메인마다 활성 `system:manage` 담당자에게 `operational_alert` 알림을 생성하며, 같은 window 안에서는 사용자/도메인별 중복 생성을 피한다.

`/operations/report-jobs`와 `/operations/report-jobs/run`은 `system:manage` 권한이 필요하다. worker는 `ReportSchedule.nextRunAt <= now`인 활성 예약을 batch로 읽고, 성공 시 `ReportRun(READY)`, 다음 실행 시각, `report_schedule_job_delivered` 감사 로그와 내부 알림을 남긴다. 실패 시 `REPORT_JOB_RETRY_BASE_SECONDS`와 `REPORT_JOB_RETRY_MAX_SECONDS` 기반 exponential backoff로 `nextRunAt`을 재설정하고 `report_schedule_job_failed` 감사 로그를 남기며, `REPORT_JOB_MAX_ATTEMPTS`를 넘으면 schedule을 비활성화하고 `report_schedule_dead_letter` 감사 로그와 운영 알림을 만든다. 최근 실패가 `REPORT_JOB_CIRCUIT_FAILURE_THRESHOLD`/`REPORT_JOB_CIRCUIT_WINDOW_MINUTES` 기준을 넘으면 circuit breaker가 열려 신규 실행을 건너뛴다. `REPORT_DELIVERY_MODE=internal|webhook`, `REPORT_DELIVERY_WEBHOOK_URL`, `REPORT_DELIVERY_WEBHOOK_TOKEN`, `REPORT_JOB_TIMEOUT_MS`, `REPORT_JOB_BATCH_SIZE`로 운영 정책을 조정한다.

`/operations/performance-policy`는 `system:manage` 권한이 필요하며, `PERFORMANCE_P95_TARGET_MS`, `PERFORMANCE_P99_TARGET_MS`, `REPORT_JOB_MAX_PROCESSING_MS`, `REPORT_DOWNLOAD_MAX_ROWS`, `REPORT_DOWNLOAD_MAX_BYTES` 기준과 현재 latency 상태를 반환한다. 보고서 직접 다운로드는 `ReportRun.rowCount`가 `REPORT_DOWNLOAD_MAX_ROWS`를 초과하거나 base64 payload가 `REPORT_DOWNLOAD_MAX_BYTES`를 초과하면 HTTP 413과 `REPORT_DOWNLOAD_ROW_LIMIT_EXCEEDED` 또는 `REPORT_DOWNLOAD_SIZE_LIMIT_EXCEEDED`로 차단한다.

`/operations/data-quality`는 `system:manage` 권한이 필요하며, 사용자/역할/부서, 거래처 계좌·세금계산서 정보, 예산 배정/사용액, 미결 결제 요청, 결재 단계, 지급, 첨부파일 orphan 여부, production test marker를 점검한다. critical 실패가 있으면 HTTP 409와 `data.ok=false`를 반환하고, 대사용 총액·건수·상태별 집계를 함께 제공한다. 계좌번호 원문은 응답에 포함하지 않는다.

`/operations/financial-reconciliation`은 `system:manage` 권한이 필요하며, `Budget.usedAmount`와 `BudgetItem.usedAmount`, 승인 완료 결제 요청 합계, 지급 완료 합계, `ReportRun.summary`의 드릴다운 스냅샷 요청번호/지급번호/금액/상태를 현재 원천과 대사한다. critical 불일치가 있으면 HTTP 409와 `data.ok=false`를 반환하고, 일/월 단위 승인 요청·지급 완료 버킷과 최대 100건의 상세 불일치를 제공한다. `POST /operations/financial-reconciliation/notify`는 같은 날짜에 담당자/점검 항목별 중복 알림을 만들지 않는다.

`/operations/manual-recoveries`는 `system:manage` 권한이 필요하며, 지급 건 수동 복구를 2차 승인 workflow로 처리한다. 요청자는 지급번호, 복구 상태, 계좌 확인 상태, 지급예정일, 사유, `idempotencyKey`를 제출하고, 다른 관리자가 승인해야 실제 `Disbursement` 상태가 변경된다. 요청/승인/반려는 모두 `manual_recovery` 감사 로그에 요청자, 승인자, 전/후 상태, 사유, requestId를 남긴다. 같은 사용자는 본인이 만든 복구 요청을 승인할 수 없다.

`/operations/financial-control-report`는 `system:manage` 권한이 필요하며, 재무 대사 불일치, 수동 복구 대기, 은행 결과 대사 감사 로그, 지급 변경 감사 로그, 보고서 스냅샷 검토 여부를 월 단위 결산 점검표로 반환한다. critical 예외 또는 미통과 결산 항목이 있으면 HTTP 409와 `data.ok=false`를 반환하고, 설정 화면 재무 통제 리포트 카드에서 예외 목록과 점검표를 함께 표시한다.

`/operations/audit-logs`는 `audit:read` 또는 `system:manage` 권한이 필요하다. `search`, `entityType`, `action`, `requestId`, `actor`, `from`, `to`, `page`, `pageSize` query를 받으며 `pageSize`는 최대 100이다. 응답은 actor, entity, action, reason, requestId, ip/userAgent, 요약, 보관/아카이브 정책을 포함하지만 `beforeValue`/`afterValue` 원문 JSON은 포함하지 않는다. `audit_logs`에는 `entityType/entityId/createdAt`, `actorId/createdAt`, `action/createdAt`, `requestId` 인덱스를 둔다.

`/operations/account-lifecycle`는 `system:manage` 권한이 필요하며, `DORMANT_ACCOUNT_DAYS` 기준 휴면 계정과 `OFFBOARDING_USER_EMAILS` 또는 `TERMINATED_USER_EMAILS`에 지정된 퇴사자 후보를 반환한다. 비활성화 실행은 `reason`과 `idempotencyKey`가 필수이며, 사용자 비활성화, 활성 세션 revoke, `account_lifecycle_deactivate` 감사 로그를 같은 트랜잭션에 남긴다.

## 알림

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/notifications` | 현재 사용자 알림 목록 조회 |
| `PATCH` | `/notifications/{id}/read` | 알림 1건 읽음 처리 |
| `POST` | `/notifications/read-all` | 현재 사용자 알림 전체 읽음 처리 |

지원 알림 유형:

- 승인 요청
- 반려
- 보류
- 승인 완료
- 지급 예정
- 지급 완료
- 예산 초과
- 결재 지연
- 시스템 설정 변경
- 운영 알림

기본 보관 기간은 90일이며, 만료된 알림은 목록 조회에서 제외한다.

## 결제 요청

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/payment-requests` | 요청 목록 조회 |
| `POST` | `/payment-requests` | 신규 요청 생성 |
| `GET` | `/payment-requests/{id}` | 요청 상세 조회 |
| `PATCH` | `/payment-requests/{id}` | 임시 저장/반려 건 수정 |
| `POST` | `/payment-requests/{id}/submit` | 제출 또는 재상신 |
| `DELETE` | `/payment-requests/{id}` | 임시 저장 건 삭제 |

생성 필수값:

- `vendorId`
- `departmentId`
- `amount`
- `reason`
- `budgetItemId`
- `attachmentIds`

현재 테이블 payload 기반 화면은 같은 값을 `첨부파일ID` comma-separated 문자열로 전송할 수 있다. 서버는 생성/수정 트랜잭션 안에서 해당 `Attachment` metadata가 업로드 완료, 보안 검사 통과, 요청자 업로드, 현재 결제 요청 소속인지 확인한 뒤 결제 요청 감사 로그에 첨부 ID와 건수를 남긴다.

중복/동시성 제한:

- 신규 요청 생성과 임시 저장/제출 수정은 `idempotencyKey`를 감사 로그에 저장하고, 같은 키 재요청은 기존 `PaymentRequest`를 replay한다.
- 수정 요청은 `rowVersion` 또는 `요청RowVersion`을 받을 수 있으며, 클라이언트 버전이 낡았거나 DB 조건부 update가 실패하면 `CONFLICT`로 차단한다.
- 결제 요청 목록/상세 응답 row는 `rowVersion`과 `요청RowVersion`을 포함한다.

제출 제한:

- 승인 완료 건은 수정/재제출 불가
- 예산 초과 상태는 추가 승인 규칙이 없으면 제출 차단
- 반려 건은 보완 후 재상신 가능

## 승인

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/approvals` | 승인 대기/진행 목록 조회 |
| `GET` | `/approvals/{id}` | 승인 상세 조회 |
| `PATCH` | `/approvals/{id}` | 승인/반려/보류 처리. `요청RowVersion`, `결재RowVersion`, `idempotencyKey`, `처리 사유`를 포함 |
| `POST` | `/approvals/{id}/approve` | 승인 처리 |
| `POST` | `/approvals/{id}/reject` | 반려 처리 |
| `POST` | `/approvals/{id}/hold` | 보류 처리 |
| `POST` | `/approvals/{id}/{action}` | 화면 action adapter. `approve`, `reject`, `hold`를 `PATCH /approvals/{id}`로 위임 |
| `GET` | `/approvals/{id}/history` | 결재선 및 처리 이력 조회 |

액션 본문:

```json
{
  "reason": "사유 또는 메모",
  "rowVersion": 3,
  "idempotencyKey": "uuid"
}
```

처리 제한:

- 현재 결재 단계 담당자만 처리 가능
- 승인 완료, 반려 건은 재처리 불가
- 보류 건은 재개 또는 반려만 가능
- 요청자는 본인 결제 요청을 승인 완료 처리할 수 없음

## 지급

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/disbursements` | 지급 예정/오늘 지급/완료/오류 목록 조회 |
| `GET` | `/disbursements/{id}` | 지급 상세 조회 |
| `PATCH` | `/disbursements/{id}` | 지급 보류, 오류 재처리, 계좌 재확인, 지급 예정일 변경 |
| `POST` | `/disbursements/{id}/execution-approval` | 지급 실행 2인 확인 |
| `POST` | `/disbursements/{id}/execute` | 지급 실행 |
| `POST` | `/disbursements/{id}/hold` | 지급 보류 |
| `POST` | `/disbursements/{id}/retry` | 오류 건 재처리 |
| `POST` | `/disbursements/{id}/{action}` | 화면 action adapter. `execute`, `hold`, `retry`, `verify-account` 등을 `PATCH /disbursements/{id}`로 위임 |
| `GET` | `/disbursements/{id}/history` | 지급 이력 조회 |
| `GET` | `/disbursements/bank-transfer-export` | DB 승인/계좌 검증 기준 은행 이체 CSV 생성 |
| `POST` | `/disbursements/bank-result-reconcile` | 은행 결과 파일/외부 지급 결과와 ERP 지급 상태 대사 |

지급 처리 제한:

- 승인 완료 건만 지급 생성 가능
- 계좌 확인 완료 상태만 지급 실행 가능
- 지급 완료 건은 재실행/보류 불가
- 오류 건 재처리는 관리자 또는 재무팀 권한 필요
- 지급 실행 요청은 `idempotencyKey`, `rowVersion`, 승인번호, 금액, 거래처를 함께 보내야 하며 backend가 DB 원장과 일치 여부를 검증
- 지급 실행 전 같은 `rowVersion`에 대해 다른 재무 담당자의 `execution-approval` 감사 로그가 필요하며, 확인자와 실행자는 서로 달라야 함
- 결제 요청자와 원 결재 승인자는 같은 건의 지급 실행 확인/실행을 할 수 없음
- 동일 `idempotencyKey` 재요청은 감사 로그 기준으로 replay 응답하고, 다른 지급 건에 이미 사용된 키는 `IDEMPOTENCY_CONFLICT`로 차단
- 이미 지급 완료된 건, 계좌 불일치 건, 승인 미완료 건, 금액/거래처/승인번호 불일치 건은 backend에서 `DISBURSEMENT_CONTROL_FAILED` 또는 `CONFLICT`로 차단
- 지급 목록/상세 row는 `rowVersion`과 `지급RowVersion`을 포함한다. 지급 보류, 오류 재처리, 계좌 재확인, 지급 예정일 변경도 `idempotencyKey`와 `rowVersion` 또는 `지급RowVersion`이 필요하며 backend가 rowVersion 조건으로 갱신
- 보류는 지급 예정/오늘 지급/오류 상태와 보류 사유가 필요하고, 재처리는 오류 상태 및 계좌 확인 완료 상태에서만 허용
- 계좌 재확인은 지급 완료 건에는 적용할 수 없고, 완료 시 `Disbursement.accountVerificationStatus`와 `Vendor.accountVerificationStatus`를 함께 확인 완료로 갱신
- `BANK_ACCOUNT_VERIFICATION_MODE=external` 또는 `BANK_ACCOUNT_VERIFICATION_ENDPOINT`가 설정된 운영 환경에서는 계좌 재확인 전에 `ERP_BANK_API_TOKEN`으로 외부 은행 계좌 검증 API를 호출하고, 불일치/대기/비활성 결과는 `BANK_ACCOUNT_VERIFICATION_FAILED`로 차단한다. 원문 계좌번호는 검증 요청 본문에만 사용하고 감사 로그/화면 응답에는 남기지 않는다.
- 은행 이체 파일은 지급 예정/오늘 지급, 승인 완료, 결재 단계 승인 완료, 계좌 확인 완료, 활성 거래처, 복호화 가능한 암호화 계좌 조건을 모두 통과한 건만 생성
- 은행 이체 파일 생성 응답과 `bank_transfer_export` 감사 로그는 대상 건수, 생성 건수, 총액, 거래처 수, 지급/거래처 계좌 확인 건수, 승인 확인 건수, 지급 예정/오늘 지급 건수, 계좌번호를 제외한 행별 대사 스냅샷을 포함
- 거래처 계좌가 legacy placeholder 또는 복호화 불가 상태이면 `BANK_TRANSFER_EXPORT_BLOCKED`로 파일 생성을 차단
- 은행 결과 대사는 지급번호, 승인번호, 금액, 은행 성공/실패 상태를 기준으로 ERP `Disbursement`와 비교하며 `idempotencyKey`가 필요
- 은행 결과 성공은 ERP 지급 완료 상태와 일치해야 하며, 은행 결과 실패는 해당 `Disbursement`를 `ERROR`로 보정하고 `bank_result_reconcile` 감사 로그에 대상 건수/총액/결과를 저장
- `Budget` 또는 `BudgetItem`이 `CLOSED`인 마감 예산 기간에서는 신규 결제 요청 제출, 예산 금액 조정/재오픈, 지급 예정일 변경, 오류 지급 복구를 backend에서 차단
- 지급 예정일 변경은 은행 영업일만 허용한다. 주말, 기본 한국 공휴일, `ERP_BANK_HOLIDAYS` 추가 휴일은 차단하며, KST 16:00 이후 당일 지급 예정일 변경은 다음 가능일 안내와 함께 거부한다.

## 예산

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/budgets` | 예산 목록/사용률 조회 |
| `POST` | `/budgets` | 예산 등록 |
| `GET` | `/budgets/{id}` | 예산 상세 조회 |
| `PATCH` | `/budgets/{id}` | 예산 배정액/상태 수정. `rowVersion` 조건부 갱신 및 감사 로그 기록 |
| `GET` | `/budgets/{id}/adjustments` | 예산 조정 이력 조회 |
| `POST` | `/budgets/{id}/adjustments` | 예산 조정 |
| `POST` | `/budgets/{id}/{action}` | 화면 action adapter. `adjust`는 조정 API로 위임하고, 상태 변경 action은 `PATCH /budgets/{id}`로 위임 |
| `GET` | `/budgets/{id}/payment-requests` | 예산 연계 요청 목록 |

예산 등록/수정 제한:

- 예산 생성/수정은 `idempotencyKey`를 감사 로그에 저장하고 같은 키 재요청은 기존 `Budget` 결과를 replay한다.
- 예산 직접 수정은 `rowVersion` 또는 `예산RowVersion`이 전달되면 stale 값을 `CONFLICT`로 차단하고, DB update도 현재 `Budget.rowVersion` 조건으로 수행한다.

## 거래처

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/vendors` | 거래처 목록 조회 |
| `POST` | `/vendors` | 거래처 추가 |
| `GET` | `/vendors/{id}` | 거래처 상세 조회 |
| `PATCH` | `/vendors/{id}` | 거래처 수정 |
| `DELETE` | `/vendors/{id}` | 거래처 비활성화 |
| `POST` | `/vendors/{id}/deactivate` | 비활성화 |
| `POST` | `/vendors/{id}/verify-account` | 계좌 재확인 |
| `POST` | `/vendors/{id}/{action}` | 화면 action adapter. `deactivate`, `verify-account` 등을 `PATCH /vendors/{id}`로 위임 |

거래처 등록/수정 제한:

- 거래처명, 사업자번호, 담당자, 은행명, 계좌번호, 세금계산서 수신 이메일은 등록 시 필수
- 사업자번호는 `000-00-00000`, 계좌번호는 숫자/하이픈 6~30자, 세금계산서 이메일은 이메일 형식으로 backend에서 검증
- 세금계산서 발행 방식은 `이메일 발행`, `전자세금계산서 연동`, `수기 확인` 중 하나만 허용
- 거래처명 또는 사업자번호 중복은 `VALIDATION_ERROR`로 차단
- 담당자, 세금계산서 수신 이메일, 발행 방식은 `Vendor` DB에 저장되고 결제 요청 master data에 포함
- 거래처 row는 `거래처RowVersion`을 포함하며, 수정, 비활성화, 계좌 재확인은 `rowVersion`과 `idempotencyKey`를 함께 보내야 한다.
- 거래처 수정은 backend가 `Vendor.rowVersion` 조건부 update로 처리하며 stale row는 `CONFLICT`, 다른 업무에서 사용된 idempotency key는 `IDEMPOTENCY_CONFLICT`로 차단한다.
- 동일 거래처 idempotency key 재요청은 감사 로그 기준으로 replay 응답하고, 버튼 중복 클릭은 frontend에서도 진행 중 요청을 차단한다.

## 파일

| Method | Path | 설명 |
| --- | --- | --- |
| `POST` | `/files/presign-upload` | 업로드용 signed URL 발급 |
| `POST` | `/files/complete` | 업로드 완료 등록 |
| `GET` | `/files/{id}` | 파일 메타데이터 조회 |
| `GET` | `/files/{id}/download?reason=...` | 다운로드 사유를 감사 로그에 남긴 뒤 signed URL 발급 |
| `DELETE` | `/files/{id}` | 삭제 가능 조건 검증 후 삭제 |

파일 처리 기준:

- 업로드 완료 후 바이러스 검사 상태를 관리한다.
- PDF/이미지 미리보기는 권한 검증 후 `disposition=inline` signed URL로 제공한다.
- 세금계산서 파일은 거래처와 결제 요청 기준으로 별도 분류한다.
- 다운로드/미리보기 signed URL 발급은 `reason` query를 필수로 받고, `AuditLog(action=download_request)`에 파일 owner, 파일명, 만료 시각, `disposition`, 보관 정책, 접근 로그 보관 기준을 기록한다. signed URL token 원문은 감사 로그에 저장하지 않는다.
- `presign-upload`, `complete`, `DELETE /files/{id}`는 선택적 `idempotencyKey`를 받으며, 같은 key 재요청은 감사 로그 기준으로 replay하거나 다른 업무에 쓰인 key는 `IDEMPOTENCY_CONFLICT`로 차단한다.
- signed upload content `PUT /files/{id}/content`는 bearer token 성격의 만료 URL과 storage checksum으로 보호하며, 인증 쿠키 대신 서명 토큰을 검증한다.
- remote frontend는 signed upload를 `XMLHttpRequest`로 전송해 진행률을 표시하고, 실패 row는 원본 `File`이 브라우저 세션에 남아 있을 때 재시도할 수 있다. 화면 이탈 후에는 recovery metadata를 표시해 원본 파일 재선택 또는 삭제로 정리한다.

## 보고서

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/reports` | 저장된 보고서 목록 |
| `POST` | `/reports` | 보고서 생성 |
| `GET` | `/reports/{id}` | 보고서 상세 |
| `PATCH` | `/reports/{id}` | 보고서 이름/요약/상태 수정 |
| `DELETE` | `/reports/{id}` | 보고서 삭제 또는 비활성화 |
| `POST` | `/reports/{id}/{action}` | 화면 action adapter. `delete`, `rename` 등 보고서 mutation 위임 |
| `GET` | `/reports/{id}/download?format=csv\|pdf` | `ReportRun.artifactKey` object storage artifact 기준 CSV/PDF payload 다운로드 |
| `GET` | `/reports/schedules` | 예약 발송 목록 |
| `POST` | `/reports/schedules` | 예약 발송 등록 |
| `PATCH` | `/reports/schedules/{id}` | 예약 발송 수신자/주기/시간/형식/활성 상태 수정 |
| `DELETE` | `/reports/schedules/{id}` | 예약 발송 중지 |

보고서 변경 제한:

- 보고서 목록/상세 row는 `rowVersion`과 `보고서RowVersion`을 포함한다.
- 보고서 생성, 수정, 삭제는 `idempotencyKey`를 감사 로그에 저장하고 같은 키 재요청은 기존 `ReportRun` 결과를 replay한다.
- 보고서 수정/삭제는 `rowVersion` 또는 `보고서RowVersion`이 전달되면 stale 값을 `CONFLICT`로 차단하고, DB update도 현재 `ReportRun.rowVersion` 조건으로 수행한다.
- 예약 발송 응답은 `rowVersion`을 포함하며 생성/수정/삭제 요청은 `idempotencyKey`, 수정/삭제 요청은 `rowVersion` 또는 `예약RowVersion`을 함께 보낸다.
- 예약 발송 수정/중지는 현재 `ReportSchedule.rowVersion` 조건부 update로 처리하며 실패 시 `CONFLICT`로 차단한다.
- 예약 job 실행은 `/operations/report-jobs/run`에서만 수행하며 성공, retry, dead-letter 상태를 `ReportRun`, `ReportSchedule`, `AuditLog`, `Notification`에 함께 기록한다.
- 보고서 생성과 예약 job 성공 run은 `reports/{reportRunId}.artifact.json` object storage artifact를 저장하고 `ReportRun.artifactKey`를 채운다. 기존 run에 artifactKey가 없으면 최초 다운로드 시 artifact를 생성해 연결한다.
- 보고서 직접 다운로드는 `REPORT_DOWNLOAD_MAX_ROWS`와 `REPORT_DOWNLOAD_MAX_BYTES` 정책을 초과하면 HTTP 413으로 차단하고, 대량 추출은 배치 export 또는 필터 축소로 처리한다.

## 시스템 설정

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/settings/config` | 결재 정책/알림/외부 연동 설정 스냅샷 조회 |
| `PATCH` | `/settings/config/{settingKey}` | 결재 정책/알림/외부 연동 설정 스냅샷 저장 |
| `POST` | `/settings/integrations/{integrationId}/test` | 외부 연동 credential reference와 HTTPS endpoint 테스트 |
| `GET` | `/settings/roles` | 권한 그룹 조회 |
| `POST` | `/settings/roles` | 권한 그룹 생성 |
| `PATCH` | `/settings/roles/{id}` | 권한 그룹 수정 |
| `DELETE` | `/settings/roles/{id}` | 사용자 미배정 권한 그룹 삭제 |
| `GET` | `/settings` | 사용자 권한 배정 목록 조회 |
| `POST` | `/settings` | 사용자 생성 및 권한 그룹 배정 |
| `PATCH` | `/settings/{userName}` | 사용자 권한 그룹/부서/활성 상태 변경 |
| `DELETE` | `/settings/{userName}` | 사용자 비활성화 |
| `POST` | `/settings/{userName}/{action}` | 사용자 활성/비활성 action adapter |
| `GET` | `/audit-logs` | 감사 로그 조회 |

시스템 설정 제한:

- 설정 변경은 `system:manage` 권한이 필요하며 `AuditLog`의 `system_setting` 스냅샷으로 append-only 저장
- `GET /settings/config` 응답은 `approvalPolicy`, `notifications`, `integrations` 값과 `__meta.{key}.auditLogId` 최신 스냅샷 ID를 포함한다.
- `PATCH /settings/config/{settingKey}`는 기존 raw JSON도 허용하지만 운영 화면은 `{ value, expectedAuditLogId, idempotencyKey, reason }` wrapper를 전송한다.
- 시스템 설정 스냅샷 저장은 같은 `idempotencyKey` 재요청을 감사 로그 기준으로 replay하고, `expectedAuditLogId`가 최신 `AuditLog.id`와 다르면 `CONFLICT`로 차단한다.
- `approvalPolicy.approvalLimits`의 활성 구간과 `requiredApprovers`는 신규 결제 요청 제출 시 backend 결재 단계 수 산정에 즉시 적용
- 권한 그룹 생성/수정은 프론트 사용자 권한 탭의 큰 분류 토글과 세부 권한 코드 토글이 모두 `Role.permissions` JSON 배열로 저장되며 backend permission check는 DB 세션 사용자 역할 기준으로 판정
- 권한 그룹 응답은 `rowVersion`을 포함하며 생성/수정/삭제 요청은 `idempotencyKey`, 수정/삭제 요청은 `rowVersion`을 함께 보내야 한다.
- 권한 그룹 수정/삭제는 backend가 `Role.rowVersion` 조건부 update/delete로 처리하며 stale row는 `CONFLICT`, 다른 업무에서 사용된 idempotency key는 `IDEMPOTENCY_CONFLICT`로 차단한다.
- 사용자 권한 배정 row는 `사용자RowVersion`을 포함하며 사용자 권한 그룹/부서/활성 상태 변경은 `rowVersion` 또는 `사용자RowVersion`과 `idempotencyKey`를 함께 보내야 한다.
- 사용자 권한 수정/비활성화는 backend가 `User.rowVersion` 조건부 update로 처리하고, 동일 idempotency key 재요청은 감사 로그 기준으로 replay 응답한다.
- 사용자가 배정된 권한 그룹 삭제는 `ROLE_IN_USE`로 차단하고, 사용자 미배정 그룹만 삭제 및 감사 로그 기록
- 외부 연동은 원문 credential을 저장하지 않고 `credentialRef`만 설정 스냅샷에 저장하며, 테스트 route가 서버 환경변수 secret과 HTTPS `testEndpoint`를 사용해 호출 결과, 실패 사유, 마지막 동기화 시각을 갱신
- 외부 연동 테스트 요청은 `{ "idempotencyKey": "..." }`를 필수로 받으며, 같은 key 재요청은 `settings_integration_test` 감사 로그 기준으로 replay하고 다른 업무에 사용된 key는 `IDEMPOTENCY_CONFLICT`로 차단한다.

## 즐겨찾기

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/favorites` | 현재 사용자 즐겨찾기 목록 조회 |
| `GET` | `/favorites/{label}` | 즐겨찾기 상세 조회 |
| `POST` | `/favorites` | 즐겨찾기 생성. 대상 화면, 구조화 필터, 정렬, 공유 범위를 `FavoriteItem`에 저장 |
| `PATCH` | `/favorites/{label}` | 즐겨찾기 이름, 대상 화면, 필터, 정렬, 순서, 활성 상태 수정 |
| `DELETE` | `/favorites/{label}` | 즐겨찾기 비활성화 삭제 |
| `POST` | `/favorites/{label}/{action}` | 화면 action adapter. `delete`, `open`, `activate` 등을 PATCH/DELETE route로 위임 |

즐겨찾기 제한:

- 사용자별 `FavoriteItem`만 조회/수정할 수 있다.
- `filters` JSON은 화면 필터 태그, 구조화 필터, 정렬 정보를 함께 보관한다.
- 열기 사용 기록은 `lastUsedAt` 갱신과 감사 로그를 남긴다.
- 즐겨찾기 row는 `rowVersion`과 `즐겨찾기RowVersion`을 포함한다.
- 즐겨찾기 생성, 수정, 삭제는 `idempotencyKey`를 감사 로그에 저장하고 같은 키 재요청은 기존 `FavoriteItem` 결과를 replay한다.
- 즐겨찾기 수정/삭제는 `rowVersion` 또는 `즐겨찾기RowVersion`이 전달되면 stale 값을 `CONFLICT`로 차단하고, DB update도 현재 `FavoriteItem.rowVersion` 조건으로 수행한다.

## 감사 로그

감사 로그 대상:

- 결제 요청 생성, 수정, 제출, 삭제
- 승인, 반려, 보류
- 지급 실행, 보류, 재처리
- 거래처 계좌 검증, 비활성화
- 예산 조정
- 보고서 생성, 수정, 삭제
- 즐겨찾기 생성, 수정, 삭제
- 설정과 권한 변경

감사 로그는 append-only 원칙을 따른다. 삭제 API를 제공하지 않고, release gate와 DB trigger로 수정/삭제를 차단한다. 기본 필드는 `actorId`, `requestId`, `ipAddress`, `userAgent`, `entityType`, `entityId`, `action`, `beforeValue`, `afterValue`, `reason`, `idempotencyKey`, `createdAt`이다.

## 보안 이벤트

보안 이벤트 대상:

- 로그인 validation 실패, 비밀번호 불일치, 비활성 사용자, 세션 조회/갱신 실패
- 인증 필요 또는 공통 permission guard의 권한 부족
- CSRF token 누락, 불일치, 서명 검증 실패
- API rate limit 초과
- 파일 업로드 validation 실패
- 파일 소유 업무 대상 없음 또는 업로드 권한 부족
- signed upload/download URL 만료, 변조, 목적 불일치
- 파일 조회, 다운로드, 삭제 권한 부족
- malware scan 차단 또는 scan engine 장애

`security_events`는 `actorId`가 없는 비인증 signed URL 실패도 저장할 수 있다. 기본 필드는 `eventType`, `severity`, `actorId`, `targetType`, `targetId`, `requestId`, `ipAddress`, `userAgent`, `method`, `path`, `statusCode`, `errorCode`, `message`, `metadata`, `createdAt`이다.

서버는 표준 오류 응답(`{ status: "error", error: { code, message } }`)을 `onSend` hook에서 포착해 아직 보안 이벤트가 기록되지 않은 요청을 자동 기록한다. 따라서 업무 route의 권한 실패, validation 실패, idempotency conflict, workflow lock 같은 `fail(...)` 응답은 별도 route별 코드가 없어도 `security_events`에 남는다.

운영 로그와 보안 이벤트에는 query string token, credential, checksum, secret, cookie, authorization 값이 저장되지 않도록 마스킹한다. Backend Fastify logger는 `createSafeLoggerOptions`를 기본으로 사용해 signed file URL query, session/CSRF cookie, authorization header, credential/secret/checksum/token 계열 필드, 계좌번호 패턴을 `[redacted]`로 치환한다.
