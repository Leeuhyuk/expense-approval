# Button And Action Backend Map

작성일: 2026-07-05

기준: 화면 버튼은 클릭 메시지나 React state 변경만으로 완료 처리하지 않는다. 실제 완료 기준은 `erpApi` remote adapter, backend route, DB/file storage, 감사 로그 또는 보안 이벤트까지 연결되는 것이다.

## Server-backed Actions

| 화면 | 버튼/액션 | Frontend 연결 | Backend route | 저장/검증 기준 |
| --- | --- | --- | --- | --- |
| 결제 요청 | 임시 저장, 제출, 재상신 | `createPageRow`, `updatePageRow`, `executePageAction` | `POST/PATCH /payment-requests`, `POST /payment-requests/{code}/{action}` | `PaymentRequest`, `ApprovalStep`, 알림, 감사 로그 |
| 결제 요청 | 거래처 추가 | `createPageRow("vendors")`, master data 재조회 | `POST /vendors` | `Vendor`, 계좌/세금계산서 validation, 감사 로그 |
| 파일 | 업로드, 완료, 다운로드, 삭제 | `presignFileUpload`, `uploadFileContent`, `completeFileUpload`, `getFileDownload`, `deleteFile` | `/files/*` | `Attachment`, object storage adapter, scan status, 감사/보안 이벤트 |
| 승인 관리 | 승인, 반려, 보류 | `executePageAction("approval")` | `PATCH /approvals/{code}`, delegated action route | `ApprovalStep`, `PaymentRequest`, 감사 로그 |
| 지급 관리 | 지급 실행, 보류, 재처리, 계좌 재확인, 예정일 변경 | `updatePageRow`, `executePageAction` | `PATCH /disbursements/{code}` | `Disbursement`, `Vendor` 계좌 상태, 알림, 감사 로그 |
| 지급 관리 | 은행 이체 파일 생성 | `exportDisbursementBankTransfer` | `GET /disbursements/bank-transfer-export` | DB 지급 대상, 승인/계좌 검증, 감사 로그 |
| 지급 관리 | 은행 결과 대사 | `reconcileDisbursementBankResults` | `POST /disbursements/bank-result-reconcile` | 지급번호/승인번호/금액 대사, 오류 상태 보정, 감사 로그 |
| 예산 관리 | 예산 등록, 수정, 재오픈/마감 액션 | `createPageRow`, `updatePageRow`, `executePageAction` | `POST/PATCH /budgets`, delegated action route | `Budget`, 마감 통제, 감사 로그 |
| 거래처 관리 | 신규 등록, 수정, 비활성화, 계좌 재확인 | `createPageRow`, `updatePageRow`, `deletePageRow`, `executePageAction` | `POST/PATCH/DELETE /vendors`, delegated action route | `Vendor`, 계좌 암호화/마스킹, 감사 로그 |
| 거래처 관리 | 지급 이력 탭, 최근 지급/요청 더보기 | `listPageRows("disbursement")`, `listPageRows("payment-request")` | `GET /disbursements`, `GET /payment-requests` | `Disbursement`, `PaymentRequest`, 요청 부서/상태/금액 row |
| 보고서 | 생성, 수정, 삭제, 공유 권한 변경 | `createPageRow`, `updatePageRow`, `deletePageRow` | `POST/PATCH/DELETE /reports` | `ReportRun`, `summary` 공유권한 metadata, 감사 로그 |
| 보고서 | 저장된 보고서 별표 즐겨찾기 | `listPageRows/createPageRow/updatePageRow/deletePageRow("favorites")` | `/favorites/*` | `FavoriteItem` 보고서 유형, `filters`, `isActive`, rowVersion, 감사 로그 |
| 보고서 | CSV/PDF 다운로드 | `downloadReport` | `GET /reports/{name}/download?format=csv|pdf` | `ReportRun` 기준 서버 생성 파일, 감사 로그 |
| 보고서 | 예약 발송 추가/수정/중지 | `listReportSchedules`, `createReportSchedule`, `updateReportSchedule`, `deleteReportSchedule` | `GET/POST/PATCH/DELETE /reports/schedules` | `ReportDefinition`, `ReportSchedule`, 내부 알림, 감사 로그 |
| 보고서 | 차트 원천 데이터 드릴다운 | 화면 `ReportDrilldownPanel` | 현재는 프론트 보유 업무 row 기준 | 월별 지급, 부서 지출, 승인 상태 원천 행 표시. 같은 `ReportRun` snapshot query 전환 필요 |
| 시스템 설정 | 결재 정책, 알림, 외부 연동 설정 저장 | `saveSystemSetting` | `PATCH /settings/config/{key}` | append-only `AuditLog` system setting snapshot |
| 시스템 설정 | 외부 연동 테스트 | `testIntegrationSetting` | `POST /settings/integrations/{id}/test` | `idempotencyKey`, HTTPS endpoint 호출, 실패 사유/시각 저장, 감사 로그 replay/conflict |
| 시스템 설정 | 권한 그룹 생성/수정/삭제 | role settings API | `/settings/roles/*` | `Role.permissions`, 사용 중 삭제 차단, 감사 로그 |
| 시스템 설정 | 사용자 권한 생성/수정/비활성화 | `createPageRow`, `updatePageRow`, delegated action route | `/settings/*` | `User`, `UserRole`, 다음 API 호출부터 권한 반영, 감사 로그 |
| 시스템 설정 | 부서 추가/기본 권한/승인 라우팅 저장 | `saveSystemSetting("approvalPolicy")` | `PATCH /settings/config/approvalPolicy` | `approvalPolicy.departmentSettings` snapshot, 결재 정책과 함께 저장 |
| 시스템 설정 | 취소, 되돌리기 | 서버 원본 snapshot restore | `GET /settings/config`, `/settings/roles`, `/settings` | 마지막 backend 원본 또는 저장 성공 snapshot으로 편집값 복원 |
| 시스템 설정 | 변경 이력 필터, 더보기 | `listSystemSettingHistory` | `GET /settings/history` | `AuditLog` system_setting/role/user settings actions, actor/department, 감사 로그 시각 |
| 즐겨찾기 | 바로가기 추가, 삭제, 순서 편집, 사용자 저장, 열기 사용 기록 | `listPageRows/createPageRow/updatePageRow/deletePageRow("favorites")` | `/favorites/*` | `FavoriteItem`, `sortOrder`, `filters`, `lastUsedAt`, 감사 로그 |

## Local-only Or Not Go-live Complete

| 화면 | 항목 | 현재 상태 | Go-live 전 필요 작업 |
| --- | --- | --- | --- |
| 공통 표 | 검색/필터/정렬/페이지 크기 복원 | `erp-table-state:{pageKey}` localStorage | 업무 데이터 변경은 아니므로 허용 가능하나, 서버 저장 사용자 설정으로 전환할지 결정 필요 |
| 결제 요청 | 작성 중 autosave 복구 | `erp-payment-draft:{requestId}` localStorage | 사용자별 서버 임시 저장 데이터 또는 명시적 임시 저장 원장 연결 |
| 보고서 | 외부 이메일/메신저 발송 adapter | 예약은 `ReportSchedule`/내부 알림까지 연결 | 실제 SMTP/메신저/queue worker와 실패 재시도 정책 연결 필요 |
| 대시보드 | KPI, 긴급 결재, 최근 활동 집계 | 일부 정적 fixture와 화면 계산 의존 | backend aggregation API와 권한별 마스킹 필요 |
| 운영 배포 | remote mode E2E | test DB가 있으면 로그인 유지, 거래처 등록/증빙 업로드, 결제 요청 생성/첨부/제출, 승인자 순차 승인, 지급 보류, 새로고침/두 번째 브라우저 로그인 후 유지 UI flow를 backend+Vite remote mode로 검증 | staging DB/object storage/scanner에서 동일 artifact로 전체 업무 smoke 검증 필요 |

## Regression Guards

- `backendRoutePermissionGuards.test.ts`: route별 인증/권한 가드 유지
- `backendAuditTransactionCoverage.test.ts`: 주요 mutation과 감사 로그의 동일 transaction 기록 유지
- `frontendFavoritesRemote.test.ts`: 즐겨찾기 화면이 `erp-favorites` localStorage가 아니라 `FavoriteItem` API를 사용하도록 고정
- `frontendReportDownloads.test.ts`: 보고서 생성/다운로드가 `ReportRun` API와 서버 생성 파일 payload를 사용하도록 고정
- `frontendReportSchedules.test.ts`: 보고서 예약 발송 추가/수정/중지가 `ReportSchedule` API와 내부 알림을 사용하도록 고정
- `frontendArtifactScanner.test.ts`: production artifact에 mock fixture/local endpoint/test secret 문자열 유입 차단
- `remote-ui-persistence.test.mjs`: 브라우저 거래처 등록, 증빙 업로드, 결제 요청 제출, 승인자 순차 승인, 지급 보류, 새로고침과 두 번째 브라우저 로그인 후 유지, DB/file/audit 대사 검증
