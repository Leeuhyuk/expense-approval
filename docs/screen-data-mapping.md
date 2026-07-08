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
| 보고서 | 보고서명, 유형, 기간, 생성일시, 생성자, 요약, 부서, 거래처 | 예약 발송, 내보내기, 저장된 보고서, artifact metadata | `report_definitions`, `report_runs`, `report_schedules`, object storage `reports/{reportRunId}.artifact.json` |
| 시스템 설정 | 사용자, 부서, 역할, 권한그룹, 상태 | 결재 정책, 결재선 규칙, 권한 그룹, 변경 이력 | `users`, `roles`, `user_roles`, `audit_logs` |
| 즐겨찾기 | 이름, 유형, 연결 화면, 최근 사용, 상태 | 저장된 메뉴, 필터, 보고서, 바로가기 순서 | `favorite_items` |

## 목록과 상세 패널 관계

| 화면 | 화면 row key / route key | 숨김 ID 및 version 필드 | 상세 조회 기준 | 상세 갱신 트리거 |
| --- | --- | --- | --- | --- |
| 결제 요청 | `요청번호` = `payment_requests.request_code` | `예산항목ID`, `rowVersion`, `요청RowVersion` | `GET /payment-requests/{요청번호}` | 임시 저장, 제출, 첨부파일 추가/삭제 |
| 승인 관리 | `요청번호` + 현재 `결재StepID` | `요청RowVersion`, `결재StepID`, `결재RowVersion`, `결재단계JSON` | `GET /approvals/{요청번호}` | 승인, 반려, 보류 |
| 지급 관리 | `지급번호` = `disbursements.disbursement_code` | `rowVersion`, `지급RowVersion` | `GET /disbursements/{지급번호}` | 지급 실행, 지급 보류, 오류 재처리, 일정 변경 |
| 예산 관리 | `부서` = 최신 `budgets.department.name` route key | `예산ID`, `rowVersion`, `예산RowVersion` | `GET /budgets/{부서}`와 `GET /budgets/{부서}/adjustments` | 예산 조정, 지급 완료 반영 |
| 거래처 관리 | `거래처명` route key, `사업자번호` 표시/중복 검증 | `rowVersion`, `거래처RowVersion` | `GET /vendors/{거래처명}`와 `GET /files?ownerType=VENDOR&ownerId={거래처명}` | 거래처 수정, 비활성화, 계좌 재확인, 증빙 업로드 |
| 보고서 | `보고서명` route key | `rowVersion`, `보고서RowVersion`, `드릴다운JSON`, `부서`, `거래처`, `artifactKey` 응답 meta | `GET /reports/{보고서명}`와 `GET /reports/{보고서명}/download` | 보고서 생성, 수정, 다운로드, 예약 발송 변경 |
| 시스템 설정 | 사용자 row는 `사용자`, 권한 그룹은 `Role.id` | 사용자: `rowVersion`, `사용자RowVersion`; 권한 그룹: `id`, `code`, `rowVersion`, `permissions` | `/settings`, `/settings/roles`, `/settings/config/*` | 저장, 권한 변경, 정책 변경, 대상 세션 revoke |
| 즐겨찾기 | `항목명` route key, `ID` DB id | `ID`, `rowVersion`, `즐겨찾기RowVersion`, `필터JSON`, `정렬` | `GET/PATCH/DELETE /favorites/{항목명}` | 추가, 순서 편집, 열기, 삭제/복구 |

## 공통 규칙

- 목록 API는 `page`, `pageSize`, `search`, `sort`, `filters`를 공통 파라미터로 사용한다.
- 화면 row는 표시용 자연키를 route key로 쓰는 경우가 많으므로 DB UUID와 혼동하지 않는다. DB id가 필요한 경우 `예산ID`, `ID`, `결재StepID`, role `id`처럼 별도 숨김 필드로 내려준다.
- 모든 mutation 대상 row는 공통 `rowVersion`과 화면별 alias(`요청RowVersion`, `결재RowVersion`, `지급RowVersion`, `예산RowVersion`, `거래처RowVersion`, `보고서RowVersion`, `사용자RowVersion`, `즐겨찾기RowVersion`) 중 하나 이상을 포함한다.
- 상세 패널은 목록 row의 표시값만 믿지 않고 row key로 상세 데이터를 재조회할 수 있어야 한다.
- 상태 변경 액션은 `rowVersion` 또는 `updatedAt` 기반 최신성 검증을 포함한다.
- 상세 패널에서 변경이 성공하면 목록 row와 상세 데이터를 함께 갱신한다.
- 삭제 또는 비활성화 후에는 목록 선택 상태를 다음 row 또는 빈 상태로 이동한다.
- 모든 상태 변경, 권한 오류, 실패한 액션은 감사 로그 대상으로 본다.
