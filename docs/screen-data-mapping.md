# Screen Data Mapping

작성일: 2026-07-04

이 문서는 화면별 목록 필드, 상세 패널 필드, 주요 데이터 소스의 1차 기준이다.

## 화면별 필드 매핑

| 화면 | 목록 필드 | 상세/패널 필드 | 주요 데이터 소스 |
| --- | --- | --- | --- |
| 대시보드 | 최근 결제 요청, 긴급 결재, 최근 활동 | KPI, 승인 추이, 부서별 지출 | `payment_requests`, `approval_steps`, `disbursements`, `budgets`, `audit_logs` |
| 결제 요청 | 요청번호, 요청일, 거래처, 요청자, 부서, 금액, 상태 | 거래처, 요청일, 요청자, 부서, 금액, 첨부파일, 요청 사유, 예산 확인, 결재선 | `payment_requests`, `vendors`, `departments`, `budget_items`, `attachments`, `approval_steps` |
| 승인 관리 | 요청번호, 요청일, 부서, 요청자, 거래처, 금액, 결재상태, 예산확인, 결재선, 처리기한 | 요청 상세, 첨부파일, 결재선 현황, 승인/반려/보류 액션 | `approval_steps`, `payment_requests`, `attachments`, `audit_logs` |
| 지급 관리 | 지급번호, 지급예정일, 거래처, 은행, 계좌확인, 금액, 지급상태, 승인번호, 담당자 | 기본 정보, 계좌 정보, 지급 일정, 지급 실행/보류 액션 | `disbursements`, `payment_requests`, `vendors`, `audit_logs` |
| 예산 관리 | 부서, 예산항목, 배정예산, 사용액, 잔액, 사용률, 상태 | 예산 상세, 연결 요청, 조정 이력, 초과 위험 | `budgets`, `budget_items`, `budget_adjustments`, `payment_requests`, `audit_logs` |
| 거래처 관리 | 거래처명, 사업자번호, 담당자, 은행, 계좌확인, 최근지급일, 누적지급액, 상태 | 기본 정보, 계좌 정보, 세금계산서 정보, 최근 지급 요청 | `vendors`, `disbursements`, `attachments`, `audit_logs` |
| 보고서 | 보고서명, 유형, 기간, 생성일시, 생성자, 요약 | 예약 발송, 내보내기, 저장된 보고서 | `report_definitions`, `report_runs`, `report_schedules` |
| 시스템 설정 | 사용자, 부서, 역할, 권한그룹, 상태 | 결재 정책, 결재선 규칙, 권한 그룹, 변경 이력 | `users`, `roles`, `user_roles`, `audit_logs` |
| 즐겨찾기 | 이름, 유형, 연결 화면, 최근 사용, 상태 | 저장된 메뉴, 필터, 보고서, 바로가기 순서 | `favorite_items` |

## 목록과 상세 패널 관계

| 화면 | 목록 row key | 상세 조회 기준 | 상세 갱신 트리거 |
| --- | --- | --- | --- |
| 결제 요청 | `requestCode` | `payment_requests.request_code` | 임시 저장, 제출, 첨부파일 추가/삭제 |
| 승인 관리 | `requestCode` + 현재 승인 단계 | `approval_steps.payment_request_id`, `step_order` | 승인, 반려, 보류 |
| 지급 관리 | `disbursementCode` | `disbursements.disbursement_code` | 지급 실행, 지급 보류, 오류 재처리 |
| 예산 관리 | `budgetItem.id` | `budget_items.id` | 예산 조정, 지급 완료 반영 |
| 거래처 관리 | `vendor.id` 또는 `businessNumber` | `vendors.id` | 거래처 수정, 비활성화, 계좌 재확인 |
| 보고서 | `reportRun.id` | `report_runs.id` | 보고서 생성, 다운로드, 예약 발송 변경 |
| 시스템 설정 | 설정 유형 + id | 해당 설정 테이블 또는 `roles.id` | 저장, 권한 변경, 정책 변경 |
| 즐겨찾기 | `favoriteItem.id` | `favorite_items.id` | 추가, 순서 편집, 삭제 |

## 공통 규칙

- 목록 API는 `page`, `pageSize`, `search`, `sort`, `filters`를 공통 파라미터로 사용한다.
- 상세 패널은 목록 row의 표시값만 믿지 않고 row key로 상세 데이터를 재조회할 수 있어야 한다.
- 상태 변경 액션은 `rowVersion` 또는 `updatedAt` 기반 최신성 검증을 포함한다.
- 상세 패널에서 변경이 성공하면 목록 row와 상세 데이터를 함께 갱신한다.
- 삭제 또는 비활성화 후에는 목록 선택 상태를 다음 row 또는 빈 상태로 이동한다.
- 모든 상태 변경, 권한 오류, 실패한 액션은 감사 로그 대상으로 본다.
