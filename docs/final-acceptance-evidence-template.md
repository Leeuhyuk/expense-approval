# Final Acceptance Evidence Template

작성일: 2026-07-06

이 템플릿은 시스템을 실사용 가능으로 최종 판정하기 전에 실제 production 업무, 데이터 보존, 권한 통제, 장애 대응, 운영 인수, KPI 결과를 한곳에 고정하기 위한 문서다. 실제 최종 판정 전에는 이 파일을 복사해 확정 값을 채우고 `FINAL_ACCEPTANCE_EVIDENCE_PATH`로 지정한다. `RELEASE_TARGET=production npm run release:check`는 strict mode로 이 문서를 검증하므로 `TBD`, `pending`, `<...>` 값이 남아 있으면 실패한다.

## Final Acceptance Identity

| 항목 | 값 |
| --- | --- |
| Release version | TBD |
| Release source ref | TBD |
| Release manifest hash | TBD |
| Production go-live evidence | `PRODUCTION_GO_LIVE_EVIDENCE_PATH` target, TBD |
| Post go-live stabilization evidence | `POST_GO_LIVE_STABILIZATION_EVIDENCE_PATH` target, TBD |
| Final acceptance owner | TBD |
| Final decision date/time | TBD |
| `READINESS_TARGET=stable-operation npm run release:go-live-readiness` | TBD |

## Production Business Operation Proof

| 업무 | 실제 production 사용자 | 역할 | 증적 | 결과 |
| --- | --- | --- | --- | --- |
| 결제 요청 생성 | TBD | 요청자 | TBD | pending |
| 증빙 첨부 | TBD | 요청자 | TBD | pending |
| 승인자 처리 | TBD | 승인자 | TBD | pending |
| 재무팀 지급 전 단계 처리 | TBD | 재무팀 | TBD | pending |
| 알림 확인 | TBD | 요청자/승인자/재무팀 | TBD | pending |
| 보고서 생성/다운로드 | TBD | 재무팀/외부 감사 | TBD | pending |

## Persistence And Multi-Session Proof

| 항목 | 증적 |
| --- | --- |
| PaymentRequest DB row | TBD |
| ApprovalStep DB row | TBD |
| Attachment metadata DB row | TBD |
| object storage object evidence | TBD |
| Disbursement DB row | TBD |
| ReportRun 또는 report artifact evidence | TBD |
| 새로고침 후 데이터 유지 | pending |
| 재로그인 후 데이터 유지 | pending |
| 다른 기기 또는 다른 브라우저 접속 후 데이터 유지 | pending |

## Authorization And Audit Proof

| 항목 | 증적 |
| --- | --- |
| 권한 없는 사용자 UI 차단 | TBD |
| 권한 없는 사용자 API 차단 | TBD |
| AuditLog evidence | TBD |
| security_events evidence | TBD |
| requestId correlation | TBD |
| 파일 직접 접근 차단 | TBD |
| 원문 계좌번호 비노출 확인 | TBD |

## Backend Control Proof

| 차단 항목 | backend 증적 | 결과 |
| --- | --- | --- |
| 중복 승인 | TBD | pending |
| 중복 지급 | TBD | pending |
| 승인 전 지급 | TBD | pending |
| 마감 후 변경 | TBD | pending |
| 계좌 불일치 지급 | TBD | pending |
| stale rowVersion 저장 | TBD | pending |
| 중복 idempotencyKey replay | TBD | pending |

## Incident Recovery Handoff

| 항목 | 값 |
| --- | --- |
| Rollback rehearsal evidence | TBD |
| 복구 절차 수행 가능 담당자 | TBD |
| 읽기 전용 전환 판단 절차 | TBD |
| 사용자 공지 절차/문구 | TBD |
| P0/P1 incident response owner | TBD |
| requestId 기반 장애 재현/추적 절차 | TBD |
| Backup/PITR restore owner | TBD |

## Operations Ownership Sign-Off

| 운영 영역 | 운영 책임자 | 인수 증적 | 결과 |
| --- | --- | --- | --- |
| 배포 | TBD | TBD | pending |
| 모니터링 | TBD | TBD | pending |
| 백업 | TBD | TBD | pending |
| 장애 대응 | TBD | TBD | pending |
| 사용자 지원 | TBD | TBD | pending |
| 권한/보안 운영 | TBD | TBD | pending |

## KPI And Error Rate Review

| 항목 | 값 |
| --- | --- |
| KPI measurement window | TBD |
| go-live 승인 기준 | TBD |
| Actual processing KPI | TBD |
| Actual error rate | TBD |
| API 5xx rate | TBD |
| Approval failure rate | TBD |
| Disbursement failure rate | TBD |
| File upload failure rate | TBD |
| Report failure rate | TBD |
| KPI/오류율 decision | pending |

## Backlog And Release Plan

| 항목 | 값 |
| --- | --- |
| Remaining P1/P2 backlog | TBD |
| 운영 릴리즈 계획 | TBD |
| Hotfix procedure owner | TBD |
| Improvement intake process | TBD |
| Next review date | TBD |

## Evidence Links

| 항목 | 값 |
| --- | --- |
| Production transaction evidence | TBD |
| DB persistence evidence | TBD |
| object storage evidence | TBD |
| Authorization/audit/security evidence | TBD |
| Backend control evidence | TBD |
| Incident recovery evidence | TBD |
| Operations handoff evidence | TBD |
| KPI dashboard/export | TBD |
| Backlog/release plan link | TBD |

## Final Real-Use Sign-Off

| 책임 영역 | 승인자 | 승인 시각 | 증적 링크 또는 ID |
| --- | --- | --- | --- |
| 기능 책임자 | TBD | TBD | TBD |
| 보안 책임자 | TBD | TBD | TBD |
| 재무 책임자 | TBD | TBD | TBD |
| 운영 책임자 | TBD | TBD | TBD |
