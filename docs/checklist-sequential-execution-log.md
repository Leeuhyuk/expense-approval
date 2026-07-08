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