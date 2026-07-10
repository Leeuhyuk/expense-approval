# Mutation Safety Matrix

작성일: 2026-07-06

기준: 업무 데이터를 생성, 수정, 삭제하거나 상태를 바꾸는 API는 중복 요청, stale write, 권한 우회, 감사 추적 중 하나라도 비어 있으면 실사용 완료로 보지 않는다.

## 표준 적용

| 영역 | route | 기준 |
| --- | --- | --- |
| 결제 요청 | `POST/PATCH /payment-requests`, action adapter | `idempotencyKey`, `rowVersion`/`요청RowVersion`, 조건부 update, 감사 로그 replay |
| 승인 | `PATCH /approvals/{id}`, action adapter | `idempotencyKey`, 요청/결재 step rowVersion, pending step lock, 조건부 update |
| 지급 | `PATCH /disbursements/{id}`, execute, execution approval, bank reconcile | `idempotencyKey`, `rowVersion`, 지급 원장 대사, 2인 확인, 조건부 update |
| 예산 | `POST/PATCH /budgets`, adjustment | `idempotencyKey`, `rowVersion`/`예산RowVersion`, 조건부 update |
| 거래처 | `POST/PATCH/DELETE /vendors`, action adapter | `idempotencyKey`, `rowVersion`/`거래처RowVersion`, 조건부 update, 비활성화 영향 계산 |
| 보고서 | `POST/PATCH/DELETE /reports`, schedules, action adapter | `idempotencyKey`, `rowVersion`/`보고서RowVersion`/`예약RowVersion`, 조건부 update |
| 설정 권한 | roles, users, settings action adapter | `idempotencyKey`, `Role.rowVersion`, `User.rowVersion`, 조건부 update/delete |
| 시스템 설정 스냅샷 | `PATCH /settings/config/{key}` | `idempotencyKey`, 최신 `AuditLog.id` 기대값, append-only replay/conflict |
| 외부 연동 테스트 | `POST /settings/integrations/{integrationId}/test` | `idempotencyKey`, credential reference/HTTPS endpoint 검증, 감사 로그 replay/conflict |
| 즐겨찾기 | `POST/PATCH/DELETE /favorites`, action adapter | `idempotencyKey`, `rowVersion`/`즐겨찾기RowVersion`, 조건부 update |
| 파일 metadata | `POST /files/presign-upload`, `POST /files/complete`, `DELETE /files/{id}` | `idempotencyKey`, 감사 로그 replay/conflict, storage object lifecycle audit |

## 예외 및 대체 기준

| 영역 | route | 예외 기준 |
| --- | --- | --- |
| signed file content | `PUT /files/{id}/content` | 인증 쿠키 대신 만료 signed token을 검증한다. 같은 object key에 대한 재전송은 storage checksum과 `/files/complete` 감사 로그로 확정한다. |
| 알림 읽음 | `PATCH /notifications/{id}/read`, `POST /notifications/read-all` | `readAt`이 없을 때만 갱신하는 멱등성 작업이다. 같은 요청 반복은 같은 읽음 상태로 수렴한다. |
| 인증 세션 | `POST /auth/login`, `/auth/logout`, `/auth/refresh` | 업무 rowVersion 대상이 아니다. 세션 DB, HttpOnly cookie, CSRF cookie rotation, 보안 이벤트로 통제한다. |
| 운영 알림 발송 | `POST /operations/business-failure-alerts/notify` | 업무 실패 window 안에서 사용자/도메인별 중복 알림 생성을 피하는 운영성 멱등 기준을 사용한다. |
| 비밀번호 변경 | POST /auth/password/change, POST /auth/password/change-expired | password hash 변경, 전체 세션 revoke, password_change 감사 로그를 한 transaction에 기록한다. |
| 예산 조정 종료 | POST /budgets/{departmentName}/adjustments/{adjustmentId}/{action} | idempotencyKey replay, pending 상태 updateMany lock, 감사 로그로 취소/반려 중복 처리를 차단한다. |
| 계정 수명주기 | POST /operations/account-lifecycle/deactivate | idempotencyKey, candidate snapshot, 활성 사용자 조건부 updateMany, 세션 revoke, 감사 로그 transaction을 사용한다. |
| 보고서 예약 worker | POST /operations/report-jobs/run | due schedule rowVersion, retry/dead-letter/circuit breaker, requestedBy 감사 기준으로 중복 발송과 실패를 통제한다. |
| 데이터 품질 배치 | POST /operations/data-quality/run | DataQualityRun 실행 이력과 requestId를 저장하고 scheduled 실행은 unique scheduleKey로 중복을 차단한다. 수동 실행은 독립 리포트 생성으로 기록한다. |
| 재무 대사 알림 | POST /operations/financial-reconciliation/notify | 실행 시점 summary와 운영 담당자별 기존 알림을 대사해 중복 알림 생성을 피한다. |
| 수동 복구 | POST /operations/manual-recoveries, POST /operations/manual-recoveries/{recoveryId}/approve, POST /operations/manual-recoveries/{recoveryId}/reject | request/review idempotencyKey, 요청자/승인자 분리, pending 상태 lock, 감사 로그 transaction을 helper에서 강제한다. |

## Frontend Recovery

- 공통 테이블 mutation(`createPageRow`, `updatePageRow`, `updateSelectedRows`, `executePageAction`)은 요청 직전 화면 rows/선택/total 스냅샷을 보관한다.
- 서버 실패, 권한 실패, rowVersion 충돌, 네트워크 실패가 발생하면 스냅샷으로 원복하고 `listPageRows`를 다시 호출해 서버 원본을 표시한다.
- 서버가 성공 응답을 보냈지만 갱신 행을 반환하지 않는 경우에는 임시 병합 상태를 오래 유지하지 않고 원본 목록 재조회로 수렴시킨다.

## 남은 P0

- staging DB에서 같은 idempotency key 재요청과 stale rowVersion 충돌을 실제 API로 smoke test한다.
- 알림/운영성 예외 route는 DB-backed integration harness로 readAt 수렴과 notification 중복 방지를 검증하도록 준비했으며, staging 운영 로그 증적은 실제 환경에서 확인한다.

## 자동 검증

- `npm run release:mutation-safety`는 backend `POST/PATCH/PUT/DELETE` route 전체를 스캔해 표준 mutation, 위임 route, 읽기 전용 reject, 승인된 예외로 분류되지 않은 route를 실패 처리한다.
- 표준 mutation은 `idempotencyKey`, 감사 로그, rowVersion/조건부 update/최신 audit id 중 해당 통제 증거가 route block 안에 있어야 한다.
- signed file content, 알림 읽음, 인증 세션, 운영 알림처럼 표준 rowVersion 대상이 아닌 route도 이 문서의 예외 기준과 source evidence가 함께 유지되어야 한다.
