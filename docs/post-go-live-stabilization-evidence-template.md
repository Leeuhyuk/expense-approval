# Post Go-Live Stabilization Evidence Template

작성일: 2026-07-06

이 템플릿은 go-live 이후 실제 production 데이터와 사용자 문의를 기준으로 첫 주 안정화 상태를 판정하기 위한 문서다. 실제 안정화 판정 전에는 이 파일을 복사해 확정 값을 채우고 `POST_GO_LIVE_STABILIZATION_EVIDENCE_PATH`로 지정한다. `RELEASE_TARGET=production npm run release:check`는 strict mode로 이 문서를 검증하므로 `TBD`, `pending`, `<...>` 값이 남아 있으면 실패한다.

## Stabilization Identity

| 항목 | 값 |
| --- | --- |
| Release version | TBD |
| Release source ref | TBD |
| Go-live date/time | TBD |
| First week stabilization window | TBD |
| Stabilization owner | TBD |
| Hypercare channel | TBD |
| Production go-live evidence | `PRODUCTION_GO_LIVE_EVIDENCE_PATH` target, TBD |
| Go-live handoff document | `GO_LIVE_HANDOFF_PATH` target, TBD |
| Stable-operation readiness target | `READINESS_TARGET=stable-operation npm run release:go-live-readiness` |

## Daily Operations Checks

| Date | Daily check owner | 로그인 실패 | API 5xx | 승인 실패 | 지급 실패 | 파일 업로드 실패 | 보고서 실패 | requestId evidence | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Day 1 | TBD | pending | pending | pending | pending | pending | pending | TBD | pending |
| Day 2 | TBD | pending | pending | pending | pending | pending | pending | TBD | pending |
| Day 3 | TBD | pending | pending | pending | pending | pending | pending | TBD | pending |
| Day 4 | TBD | pending | pending | pending | pending | pending | pending | TBD | pending |
| Day 5 | TBD | pending | pending | pending | pending | pending | pending | TBD | pending |

Daily check source: `/api/operations/alerts`, `/api/operations/business-failure-alerts`, `/api/operations/data-quality`, monitoring dashboard, structured logs, support tickets.

## First Disbursement Reconciliation

| 항목 | 값 |
| --- | --- |
| First disbursement ID | TBD |
| first disbursement observer | TBD |
| 은행 결과 | TBD |
| ERP 상태 | TBD |
| AuditLog evidence | TBD |
| 거래처 지급 이력 evidence | TBD |
| report totals evidence | TBD |
| Reconciliation discrepancy | TBD |
| Finance owner sign-off | pending |

## Backup And PITR After Production Data

| 항목 | 값 |
| --- | --- |
| Full backup after production data | TBD |
| backup verification result | pending |
| PITR target timestamp | TBD |
| PITR restore rehearsal result | pending |
| production data row/sample verification | TBD |
| Object storage versioning/restore result | pending |
| Report artifact backup/restore result | pending |
| Backup owner | TBD |
| Restore evidence link | TBD |

## Incident And Support Triage

| 항목 | 값 |
| --- | --- |
| Severity 기준 | P0/P1/P2/P3 |
| P0 same-day response owner | TBD |
| P1 same-day response owner | TBD |
| requestId 수집 절차 | TBD |
| User inquiry intake channel | TBD |
| Inquiry owner rotation | TBD |
| Escalation SLA | TBD |
| Incident register link | TBD |
| Known issue remediation owner | TBD |

## Hypercare Report

| 항목 | 값 |
| --- | --- |
| Hypercare report period | TBD |
| processing count | TBD |
| failure count | TBD |
| average processing time | TBD |
| Major inquiry summary | TBD |
| remediation plan | TBD |
| Remediation owner/deadline | TBD |
| User communication summary | TBD |

## Go-Live Plus 2 Week Review

| 항목 | 값 |
| --- | --- |
| Review date | TBD |
| Remaining P1/P2 backlog | TBD |
| Backlog priority decision | TBD |
| Hotfix or next release plan | TBD |
| Operations handoff decision | pending |
| Review sign-off | pending |

## Evidence Links

| 항목 | 값 |
| --- | --- |
| Daily monitoring dashboard export | TBD |
| Daily alert result archive | TBD |
| First disbursement reconciliation file | TBD |
| Backup/PITR evidence | TBD |
| Support ticket export | TBD |
| Hypercare report | TBD |
| Go-live +2 week review | TBD |
| Stable-operation readiness command result | TBD |
| Final acceptance evidence path | `FINAL_ACCEPTANCE_EVIDENCE_PATH` |

## Stabilization Sign-Off

| 책임 영역 | 승인자 | 승인 시각 | 증적 링크 또는 ID |
| --- | --- | --- | --- |
| 기능 책임자 | TBD | TBD | TBD |
| 보안 책임자 | TBD | TBD | TBD |
| 재무 책임자 | TBD | TBD | TBD |
| 운영 책임자 | TBD | TBD | TBD |
