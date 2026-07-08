# Release Readiness Decision Template

작성일: 2026-07-08

이 문서는 release마다 배포 가능성 판정표를 갱신하고 미충족 사유를 backlog와 연결하기 위한 go/no-go 템플릿이다. `npm run release:go-live-readiness-report` 결과와 함께 release evidence로 보관한다.

## Release Identity

| 항목 | 값 |
| --- | --- |
| Release version | TBD |
| Source ref/tag | TBD |
| Git commit | TBD |
| Release manifest hash | TBD |
| Migration review hash | TBD |
| Readiness target | production-candidate / go-live / stable-operation |
| Readiness report path | `release/go-live-readiness-report.md` |
| Approval exceptions path | `docs/release-approval-exceptions.json` 또는 `READINESS_APPROVAL_EXCEPTIONS_PATH` |
| Decision owner | TBD |
| Decision timestamp | TBD |

## 판정표

| 영역 | 기준 | 결과 | 미충족 사유 | Backlog/예외 ID | Owner | Due date |
| --- | --- | --- | --- | --- | --- | --- |
| 기능 | 23장 P0 완료 또는 예외 승인 | pending | TBD | TBD | TBD | TBD |
| 운영/보안/재무 통제 | 24장 P0 완료 또는 예외 승인 | pending | TBD | TBD | TBD | TBD |
| 배포/실사용 전환 | 25장 목표별 P0 완료 또는 예외 승인 | pending | TBD | TBD | TBD | TBD |
| 테스트/증빙 | DB E2E, staging smoke, UAT, backup/restore evidence | pending | TBD | TBD | TBD | TBD |
| 사용자/지원 | FAQ, support channel, known issue, rollback notice | pending | TBD | TBD | TBD | TBD |

## 판정 기준

- `production-candidate`: 23장 P0와 25.1/25.2 P0가 완료되거나 책임자 예외 승인과 보완 기한이 있어야 한다.
- `go-live`: 운영 시작 전 범위 P0가 완료되거나 기능/보안/재무/운영 책임자 예외 승인과 사용자 공지가 있어야 한다.
- `stable-operation`: go-live 이후 첫 주와 안정화 P0가 완료되어야 한다.
- Open P0가 있는데 예외 승인, owner, due date, 사용자 영향 설명이 없으면 배포 불가로 판정한다.
- `docs/release-approval-exceptions.json`은 사용자 또는 책임자가 위임한 조건부 예외 승인을 구조화한다. 이 파일은 미완료 증빙을 완료로 바꾸지 않으며, `release:go-live-readiness`와 `release:go-live-readiness-report`가 완료/조건부 승인/미승인 차단 항목을 분리해 표시하는 기준이다.

## 최종 결정

| 항목 | 값 |
| --- | --- |
| Decision | go / no-go / conditional-go |
| Approved exception list | `docs/release-approval-exceptions.json`의 approvalId/exception id 목록 |
| User notice required | TBD |
| Rollback readiness confirmed | pending |
| Next review date | TBD |
| Final approver | TBD |