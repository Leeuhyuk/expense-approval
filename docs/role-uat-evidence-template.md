# Role UAT Evidence Template

작성일: 2026-07-06

이 템플릿은 production go-live 전에 요청자, 승인자, 재무팀, 관리자, 외부 감사 역할별 실제 권한 계정으로 UAT와 파일럿 업무 흐름을 수행했다는 증적을 남기기 위한 문서다. 실제 production 후보 전에는 이 파일을 복사해 확정 값을 채우고 `ROLE_UAT_EVIDENCE_PATH`로 지정한다. `RELEASE_TARGET=production npm run release:check`는 strict mode로 이 문서를 검증하므로 `TBD`, `pending`, `<...>` 값이 남아 있으면 실패한다.

## UAT Identity

| 항목 | 값 |
| --- | --- |
| UAT owner | TBD |
| UAT approval ID | TBD |
| Release manifest hash | TBD |
| Staging smoke evidence | TBD |
| Data migration evidence | TBD |
| Pilot department | TBD |
| Pilot period | TBD |

## Role Accounts

| 역할 | 실제 계정 또는 증적 ID | 권한 검증 | 승인자 |
| --- | --- | --- | --- |
| 요청자 | TBD | 본인 결제 요청 생성/조회/수정/제출 | TBD |
| 승인자 | TBD | 배정된 승인 조회/승인/반려/보류 | TBD |
| 재무팀 | TBD | 지급 조회/보류/실행 전 dry-run, 은행 이체 파일 생성 | TBD |
| 관리자 | TBD | 권한 그룹, 사용자 권한, 시스템 설정 변경 | TBD |
| 외부 감사 | TBD | 감사 로그와 보고서 read-only 조회 | TBD |

## Permission Boundaries

| 항목 | 값 |
| --- | --- |
| 요청자 타인 요청 접근 차단 | TBD |
| 승인자 미배정 승인 접근 차단 | TBD |
| 재무팀 지급 권한과 요청자/승인자 직무 분리 | TBD |
| 관리자 전용 설정 접근 | TBD |
| 외부 감사 read-only 확인 | TBD |
| API 직접 호출 권한 우회 차단 | TBD |

## Pilot Scope

| 항목 | 값 |
| --- | --- |
| Pilot 대상 부서 | TBD |
| Pilot 사용자 수 | TBD |
| Pilot 기간 | TBD |
| 실제 금액 지급 전 통제 기준 | TBD |
| 제한 금액 또는 테스트 계좌 정책 | TBD |
| 은행 송금 dry-run 정책 | TBD |
| Pilot exit criteria | TBD |

## Requester Scenarios

| 항목 | 값 |
| --- | --- |
| 결제 요청 생성 | pending |
| 증빙 첨부 업로드 | pending |
| 예산 확인 | pending |
| 임시 저장 후 재조회 | pending |
| 제출 후 수정 제한 확인 | pending |
| 반려 건 보완/재상신 | pending |

## Approver Scenarios

| 항목 | 값 |
| --- | --- |
| 승인 대기 목록 조회 | pending |
| 승인 처리 | pending |
| 반려 처리 | pending |
| 보류 처리 | pending |
| 순차 승인 handoff | pending |
| 중복 승인/권한 없는 승인 차단 | pending |

## Finance Scenarios

| 항목 | 값 |
| --- | --- |
| 지급 대상 조회 | pending |
| 지급 보류 | pending |
| 지급 실행 전 dry-run | pending |
| 은행 이체 파일 생성 | pending |
| 2인 확인 또는 직무 분리 확인 | pending |
| 은행 결과 대사 시나리오 | pending |

## Admin Scenarios

| 항목 | 값 |
| --- | --- |
| 거래처 등록 | pending |
| 거래처 첨부 업로드 | pending |
| 권한 그룹 생성/수정 | pending |
| 사용자 권한 변경 | pending |
| 시스템 설정 변경 | pending |
| 외부 연동 테스트 | pending |

## Auditor Scenarios

| 항목 | 값 |
| --- | --- |
| 감사 로그 조회 | pending |
| 보고서 조회 | pending |
| 보고서 다운로드 | pending |
| 업무 mutation 버튼 부재 또는 차단 확인 | pending |
| 민감정보 마스킹 확인 | pending |

## Reports And Evidence

| 항목 | 값 |
| --- | --- |
| 보고서 생성 | pending |
| 보고서 다운로드 | pending |
| 즐겨찾기 저장/열기 | pending |
| requestId 수집 방법 확인 | pending |
| AuditLog evidence | TBD |
| Screenshot/recording folder | TBD |

## Issue Disposition

| 항목 | 값 |
| --- | --- |
| P0 issue count | TBD |
| P0 issue resolution evidence | TBD |
| P1 issue count | TBD |
| P1 exception approval evidence | TBD |
| Known issue handoff link | TBD |
| Go-live exception approver | TBD |

## Training And Support

| 항목 | 값 |
| --- | --- |
| 사용자 교육 완료 증적 | TBD |
| 운영 FAQ 배포 증적 | TBD |
| 오류 신고 양식 | TBD |
| requestId 전달 안내 | TBD |
| Hypercare 연락 채널 | TBD |

## Pilot Feedback Metrics

| 항목 | 값 |
| --- | --- |
| 파일럿 만족도 점수 | TBD |
| 업무 처리 시간 기준/실측 | TBD |
| 오류 빈도 | TBD |
| 문의 유형 분류 | TBD |
| go-live 전 반영 결정 | TBD |
| Backlog 또는 변경 증빙 | TBD |

## Final Role Sign-Off

| 책임 영역 | 승인자 | 승인 시각 | 증적 링크 또는 ID |
| --- | --- | --- | --- |
| 기능 책임자 | TBD | TBD | TBD |
| 보안 책임자 | TBD | TBD | TBD |
| 재무 책임자 | TBD | TBD | TBD |
| 운영 책임자 | TBD | TBD | TBD |
