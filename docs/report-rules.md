# Report Rules

작성일: 2026-07-05

이 문서는 보고서 기능 1차 구현 기준이다.

## 보고서 유형

- 종합: 결제 요청, 승인, 지급, 예산 지표를 함께 집계한다.
- 지급: 지급 예정, 오늘 지급, 지급 완료, 오류 건을 기준으로 집계한다.
- 승인: 승인 대기, 승인 진행 중, 승인 완료, 반려 상태를 기준으로 집계한다.
- 예산: 부서별 예산 사용률과 초과 위험을 기준으로 집계한다.

## 생성 기준일

- 기본 기간은 화면의 기간 필터 값을 따른다.
- 생성 버튼은 `POST /reports`를 호출해 `ReportRun`을 만들고, 생성일시는 서버 또는 API 응답 기준으로 목록에 반영한다.
- 기간 문자열은 가능한 경우 `ReportRun.periodStart`, `ReportRun.periodEnd`로 저장한다.

## 다운로드

- CSV/PDF 다운로드 버튼은 현재 화면 row를 브라우저에서 직접 파일로 조립하지 않고 `GET /reports/{name}/download?format=csv|pdf`를 호출한다.
- backend는 `ReportRun.artifactKey`가 가리키는 object storage artifact를 우선 읽어 파일명, content type, base64 content, 생성 시각, artifact metadata를 응답한다.
- 다운로드 요청은 `report_run` 감사 로그에 `download_csv` 또는 `download_pdf` action으로 기록한다.
- 보고서 생성과 예약 job 성공 run은 CSV/PDF payload를 하나의 JSON artifact로 object storage에 저장하고 `ReportRun.artifactKey`에 보관한다. 기존 run 중 artifactKey가 없는 보고서는 최초 다운로드 시 자동 보관한다.

## 권한별 조회 범위

- 관리자와 재무팀은 모든 부서와 거래처 보고서를 조회할 수 있다.
- 승인자는 자신이 결재선에 포함된 요청과 소속 부서 보고서를 조회할 수 있다.
- 요청자는 본인 요청과 소속 부서 요약 보고서만 조회한다.
- 감사자는 수정 권한 없이 전체 보고서를 조회할 수 있다.

## 예약 발송

- 예약 발송 목록은 `GET /reports/schedules`로 조회한다.
- 예약 추가는 현재 선택 보고서를 기준으로 `ReportDefinition`을 보장하고 `ReportSchedule`을 생성한다.
- 예약 수정은 수신자, 주기, 시간, 형식, 활성 상태를 `PATCH /reports/schedules/{id}`로 저장한다.
- 예약 중지는 `ReportSchedule.isActive=false`, `nextRunAt=null`로 저장하며 감사 로그에 남긴다.
- 예약 등록/수정/중지는 내부 알림을 생성해 운영자가 변경 사실을 확인할 수 있게 한다.
- 예약 job worker는 `GET /operations/report-jobs` dry-run과 `POST /operations/report-jobs/run` 실행으로 연결하며, 성공 `ReportRun`, retry backoff, dead-letter 비활성화, circuit breaker, 감사 로그, 내부 알림을 남긴다.
- 외부 이메일/메신저 실발송은 `REPORT_DELIVERY_MODE=webhook`과 운영 webhook adapter로 연결하며, production go-live 전 staging/prod 발송 리허설 증빙이 필요하다.
