# Backend Connection Plan

작성일: 2026-07-04

이 문서는 현재 React/Vite 프론트엔드를 실제 백엔드와 DB에 연결하기 위한 1차 결정 사항이다.

## 스택 결정

| 영역 | 결정 | 이유 |
| --- | --- | --- |
| Backend runtime | Node.js + TypeScript | 현재 프론트가 TypeScript라 계약 타입 공유가 쉽다. |
| HTTP framework | Fastify | API 서버를 가볍게 시작하고 schema validation을 붙이기 좋다. |
| ORM | Prisma | PostgreSQL schema, migration, seed 관리에 적합하다. |
| Database | PostgreSQL | ERP성 트랜잭션, rowVersion, 감사 로그, 집계 쿼리에 안정적이다. |
| File storage | S3-compatible object storage | 증빙 파일 본문은 DB가 아닌 object storage에 저장한다. |
| Auth | HttpOnly Secure session cookie + RBAC | 브라우저 기반 ERP에서 토큰 노출을 줄이고 역할 권한을 서버에서 검증한다. |
| Audit log | PostgreSQL append-only table | 업무 변경 이력 조회와 정합성 검증을 DB 트랜잭션 안에서 처리한다. |

## 인증 방식

- 로그인 성공 시 서버가 HttpOnly, Secure, SameSite=Lax 세션 쿠키를 발급한다.
- 세션에는 사용자 id, 부서 id, 역할 id만 저장한다.
- 권한 목록은 서버에서 조회하고, API 액션마다 권한을 재검증한다.
- 세션 만료 기본값은 8시간, 활동 중 refresh 허용 시간은 24시간으로 둔다.
- 관리자 권한 변경 시 기존 세션은 다음 요청에서 새 권한을 다시 읽는다.

## 파일 업로드 저장 방식

1. 프론트가 `/api/files/presign-upload`을 호출한다.
2. 서버가 파일 확장자, 용량, 소유 업무 권한을 검증한다.
3. 서버가 object storage signed upload URL과 `fileId`를 발급한다.
4. 프론트가 직접 object storage에 업로드한다.
5. 업로드 완료 후 `/api/files/complete`로 checksum, size, contentType을 확정한다.
6. 승인 완료 이후 첨부파일 변경은 차단한다.

기준:

- 허용 확장자: PDF, JPG, JPEG, PNG, XLSX
- 기본 최대 용량: 10MB
- 파일명 중복은 `fileId` 기반 storage key로 해결한다.
- 다운로드는 권한 검증 후 signed URL로 제공한다.
- 허용 확장자 파일은 바이러스 검사 대상으로 보고, 검사 완료 전에는 다운로드와 승인 제출 확정을 차단한다.
- PDF는 권한 검증 후 signed URL 기반 미리보기를 제공한다.
- 세금계산서 파일은 거래처, 요청번호, 발행일, 공급가액, 부가세, 파일 ID를 함께 관리한다.

세부 기준은 `docs/file-handling-rules.md`를 따른다.

## 감사 로그 저장 방식

- 상태 변경과 설정 변경은 같은 DB 트랜잭션에서 업무 테이블과 `audit_logs`에 함께 기록한다.
- `audit_logs`는 append-only이며 삭제 API를 만들지 않는다.
- `before_value`, `after_value`는 JSONB로 저장한다.
- `request_id`, `idempotency_key`, `actor_id`, `entity_type`, `entity_id`를 함께 저장한다.
- 승인/반려/보류/지급 실행 실패도 실패 사유를 감사 로그 대상으로 본다.

## 승인 워크플로우 엔진 설계

- 1차 구현은 상태 전이표 기반 service layer로 시작한다.
- 결재선 자동 생성 규칙은 금액, 부서, 예산 초과 여부, 거래처 예외를 입력으로 받는다.
- 각 approval step은 `step_order`, `approver_id`, `status`, `acted_at`을 가진다.
- 현재 단계가 완료되면 다음 step을 `approval_pending`으로 전환한다.
- 모든 step이 승인되면 payment request를 `approved`로 전환하고 지급 예정 건을 생성한다.

## 환경 분리

| 환경 | 용도 | 데이터 |
| --- | --- | --- |
| local | 개발자 로컬 실행 | seed fixture |
| test | 자동화 테스트 | 테스트 전용 DB |
| staging | 운영 전 검증 | 마스킹된 샘플 데이터 |
| production | 운영 | 실데이터 |

## DB 마이그레이션 전략

- Prisma migration 파일을 schema 변경의 단일 출처로 둔다.
- 모든 migration은 pull request에서 SQL diff와 rollback 영향을 검토한다.
- 운영 DB에는 `prisma migrate deploy`만 사용하고, 임의 schema push는 금지한다.
- 컬럼 삭제와 타입 변경은 2단계 배포를 원칙으로 한다.
- seed 데이터는 local/test 전용으로 분리하고 production에는 자동 seed를 실행하지 않는다.
- 이관 전후에는 `GET /api/operations/data-quality`로 사용자/권한/거래처/예산/결제 요청/지급/첨부파일 정합성과 production test marker를 확인한다.

## 백업 및 복원 정책

- PostgreSQL은 일 1회 full backup, 15분 단위 WAL 보관을 기준으로 한다.
- Object storage는 버전 관리와 삭제 보호를 켠다.
- RPO 목표는 15분, RTO 목표는 4시간으로 둔다.
- 복원 절차는 staging에서 월 1회 리허설한다.

## 프론트 연결 순서

1. `src/api/contracts.ts` 기준으로 백엔드 DTO와 응답 포맷을 맞춘다.
2. 현재 `src/api/mockApi.ts`와 같은 함수 이름을 유지한 service adapter를 만든다.
3. 환경 변수로 `mock`과 `remote` API mode를 전환한다.
4. 목록 조회부터 실제 API로 교체한다.
5. 승인/반려/보류/지급 실행 액션을 실제 API로 교체한다.
6. 파일 업로드와 감사 로그 조회를 연결한다.

## 프론트 API 전환 방식

현재 프론트는 `src/api/service.ts`를 단일 진입점으로 사용한다.

| 환경 변수 | 값 | 의미 |
| --- | --- | --- |
| `VITE_ERP_API_MODE` | `mock` | 로컬 mock API 사용 |
| `VITE_ERP_API_MODE` | `remote` | 실제 백엔드 API 사용 |
| `VITE_ERP_API_BASE_URL` | `/api` 또는 URL | 실제 API base URL |

백엔드가 준비되면 `.env`에 아래처럼 지정한다.

```env
VITE_ERP_API_MODE=remote
VITE_ERP_API_BASE_URL=http://127.0.0.1:4000/api
```

UI 컴포넌트는 `mockApi`를 직접 import하지 않고 `erpApi`만 사용한다. 따라서 실제 서버 연결 시 화면 컴포넌트 변경을 최소화한다.

## DB 연결 1차 산출물

- Prisma schema 위치: `prisma/schema.prisma`
- 초기 seed 위치: `prisma/seed.ts`
- 백엔드 API 위치: `backend/src`
- 실행 절차: `docs/backend-runbook.md`
