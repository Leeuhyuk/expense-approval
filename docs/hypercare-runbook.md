# Hypercare Runbook

작성일: 2026-07-08

이 문서는 go-live 첫 주 daily check, 일일 상태 보고, hypercare 리포트, 2주차 안정화 회고 기준을 정의한다. 실제 안정화 판정 전에는 `POST_GO_LIVE_STABILIZATION_EVIDENCE_PATH`에 완료 증빙을 채운다.

## 첫 주 Daily Check

| 항목 | 확인 방법 | 기준 |
| --- | --- | --- |
| 로그인 실패 | `/api/operations/alerts`, auth logs | 급증 없음 또는 원인/조치 기록 |
| API 5xx | monitoring dashboard, structured logs | P0/P1 기준 초과 없음 |
| 승인 실패 | `/api/operations/business-failure-alerts` | 실패 건 owner 지정 |
| 지급 실패 | financial reconciliation, business alerts | 재무 책임자 확인 |
| 파일 업로드 실패 | file security health, business alerts | scanner/storage 원인 분리 |
| 보고서 실패 | `/api/operations/report-jobs`, report failure alerts | retry/dead-letter 확인 |
| 데이터 정합성 | `/api/operations/data-quality` | critical 0 또는 승인된 예외 |
| 사용자 문의 | support ticket export | requestId 포함률 확인 |

## 일일 상태 보고 템플릿

| 항목 | 값 |
| --- | --- |
| 보고일 | TBD |
| 운영 담당자 | TBD |
| 처리 건수 | TBD |
| 실패 건수 | TBD |
| 평균 처리 시간 | TBD |
| P0/P1 incident | TBD |
| 주요 문의 | TBD |
| requestId 누락 문의 | TBD |
| 우회 절차 공지 | TBD |
| 다음 조치 owner/deadline | TBD |
| 상태 | Green/Yellow/Red |

## Hypercare 리포트 포함 항목

- Hypercare period
- 처리 건수, 실패 건수, 평균 처리 시간
- 승인/지급/파일/보고서/알림 실패 요약
- 주요 문의 유형과 requestId 수집률
- known issue, 우회 절차, 사용자 공지 이력
- remediation plan, owner, deadline
- 다음 릴리즈 또는 hotfix backlog
- 기능/보안/재무/운영 책임자 sign-off

## 2주차 안정화 회고

- 남은 P1/P2 backlog를 업무 영향, 보안/재무 위험, 사용자 빈도 기준으로 재우선순위화한다.
- 반복 문의는 FAQ 또는 화면 문구 개선으로 전환한다.
- 운영자 수동 개입이 반복된 작업은 자동화 backlog로 전환한다.
- 안정화 승인 전 `READINESS_TARGET=stable-operation npm run release:go-live-readiness` 결과와 post go-live evidence를 확인한다.