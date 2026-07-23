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

## 남은 P0

- staging DB에서 같은 idempotency key 재요청과 stale rowVersion 충돌을 실제 API로 smoke test한다.
- 알림/운영성 예외 route는 DB-backed integration harness로 readAt 수렴과 notification 중복 방지를 검증하도록 준비했으며, staging 운영 로그 증적은 실제 환경에서 확인한다.

## 자동 검증

- `npm run release:mutation-safety`는 backend `POST/PATCH/PUT/DELETE` route 전체를 스캔해 표준 mutation, 위임 route, 읽기 전용 reject, 승인된 예외로 분류되지 않은 route를 실패 처리한다.
- 표준 mutation은 `idempotencyKey`, 감사 로그, rowVersion/조건부 update/최신 audit id 중 해당 통제 증거가 route block 안에 있어야 한다.
- signed file content, 알림 읽음, 인증 세션, 운영 알림처럼 표준 rowVersion 대상이 아닌 route도 이 문서의 예외 기준과 source evidence가 함께 유지되어야 한다.
