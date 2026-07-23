# Go-Live Handoff Template

작성일: 2026-07-06

이 문서는 운영 시작 전 known issue, 우회 절차, rollback 기준, 지원 연락망, 승인 증적을 한곳에 모으기 위한 템플릿이다. `TBD` 또는 `<...>` 값이 남아 있으면 production go-live 승인 완료로 보지 않는다.

## Release Identity

| 항목 | 값 |
| --- | --- |
| Release version | TBD |
| Release source ref | TBD |
| Release manifest hash | TBD |
| Migration review hash | TBD |
| Staging validation evidence | TBD |
| Production deployment window | TBD |

## Required Owner Contacts

| 역할 | 담당자 | 연락 채널 | 백업 담당자 | 승인 상태 |
| --- | --- | --- | --- | --- |
| 기능 책임자 | TBD | TBD | TBD | pending |
| 보안 책임자 | TBD | TBD | TBD | pending |
| 재무 책임자 | TBD | TBD | TBD | pending |
| 운영 책임자 | TBD | TBD | TBD | pending |
| 인프라/배포 담당자 | TBD | TBD | TBD | pending |
| 사용자 지원 담당자 | TBD | TBD | TBD | pending |

## Role UAT Evidence

| 역할 | 계정 또는 증적 ID | 수행 시나리오 | 결과 | 승인자 |
| --- | --- | --- | --- | --- |
| 요청자 | TBD | 결제 요청 생성, 첨부 업로드, 제출 | pending | TBD |
| 승인자 | TBD | 승인, 반려, 보류 처리 | pending | TBD |
| 재무팀 | TBD | 지급 보류, 지급 실행 전 dry-run, 은행 이체 파일 생성 | pending | TBD |
| 관리자 | TBD | 권한 그룹, 사용자 권한, 설정 변경 | pending | TBD |
| 외부 감사 | TBD | 감사/보고서 read-only 확인 | pending | TBD |

## Known Issues

| ID | Severity | 영향 범위 | 우회 절차 | 소유자 | 해결 기한 | Go-live 판단 |
| --- | --- | --- | --- | --- | --- | --- |
| KI-TBD-001 | TBD | TBD | TBD | TBD | TBD | pending |

## Workarounds

| 업무 | 조건 | 임시 우회 절차 | 사용자 공지 문구 | 종료 기준 |
| --- | --- | --- | --- | --- |
| 결제 요청 | TBD | TBD | TBD | TBD |
| 승인 관리 | TBD | TBD | TBD | TBD |
| 지급 관리 | TBD | TBD | TBD | TBD |
| 파일 업로드/다운로드 | TBD | TBD | TBD | TBD |
| 보고서 | TBD | TBD | TBD | TBD |

## Rollback Criteria

| Trigger | 판단 기준 | 담당자 | 실행 절차 | 예상 소요 시간 | 사용자 공지 |
| --- | --- | --- | --- | --- | --- |
| P0 업무 중단 | 결제 요청/승인/지급 핵심 흐름 중단 | TBD | 직전 manifest artifact로 rollback | TBD | TBD |
| 데이터 정합성 실패 | `/api/operations/data-quality` critical 실패 | TBD | cutover 중단, staging 복원 대사 | TBD | TBD |
| 보안 실패 | 권한 우회, 원문 계좌 노출, 파일 직접 URL 노출 | TBD | 세션 무효화, 권한 회수, hotfix 또는 rollback | TBD | TBD |
| storage/scanner 실패 | 신규 업로드 또는 다운로드 불가 | TBD | 신규 업로드 중지, signed path health 확인 | TBD | TBD |

## Support Window

| 항목 | 값 |
| --- | --- |
| Hypercare 시작 | TBD |
| Hypercare 종료 | TBD |
| 운영 채널 | TBD |
| 장애 접수 양식 | TBD |
| requestId 수집 방법 | 사용자 오류 메시지의 `requestId`를 그대로 접수 |
| 일일 상태 보고 담당자 | TBD |
| 첫 주 점검 항목 | 로그인 실패, API 5xx, 승인 실패, 지급 실패, 파일 업로드 실패, 보고서 실패 |

## Final Go-Live Sign-Off

| 책임 영역 | 승인자 | 승인 시각 | 증적 링크 또는 ID |
| --- | --- | --- | --- |
| 기능 | TBD | TBD | TBD |
| 보안 | TBD | TBD | TBD |
| 재무 | TBD | TBD | TBD |
| 운영 | TBD | TBD | TBD |

## Attachments And Evidence

- Release manifest: TBD
- Migration review: TBD
- Staging smoke test: TBD
- Role UAT evidence: TBD
- Role UAT evidence path: `ROLE_UAT_EVIDENCE_PATH`
- Production go-live evidence: `PRODUCTION_GO_LIVE_EVIDENCE_PATH`
- Post go-live stabilization evidence: `POST_GO_LIVE_STABILIZATION_EVIDENCE_PATH`
- Final acceptance evidence: `FINAL_ACCEPTANCE_EVIDENCE_PATH`
- Backup/PITR rehearsal: TBD
- Data migration reconciliation: TBD
- Known issue approval: TBD
