# Button And Action Backend Map

작성일: 2026-07-05

기준: 화면 버튼은 클릭 메시지나 React state 변경만으로 완료 처리하지 않는다. 실제 완료 기준은 `erpApi` remote adapter, backend route, DB/file storage, 감사 로그 또는 보안 이벤트까지 연결되는 것이다.

## Server-backed Actions

| 화면 | 버튼/액션 | Frontend 연결 | Backend route | 저장/검증 기준 |
| --- | --- | --- | --- | --- |
| 결제 요청 | 작성 autosave, 임시 저장, 제출, 재상신 | `createPageRow`, `updatePageRow`, `executePageAction`, debounced `updatePageRow("payment-request")`, field validation mapping | `POST/PATCH /payment-requests`, `POST /payment-requests/{code}/{action}` | `PaymentRequest` DRAFT row, `ApprovalStep`, 필드별 validation 오류, 알림, 감사 로그 |
| 대시보드 | KPI 카드 클릭, 최근 활동 표시, 승인 추이/부서별 지출 차트 | route state 저장 후 대상 화면 `listPageRows`, `/dashboard` row 기반 KPI/긴급 결재/최근활동/차트 계산 | `GET /dashboard`, `GET /approvals`, `GET /budgets` 등 대상 화면 API | KPI 산식과 동일한 `filter.*`, 비교 필터(`__in`, `__lte`)와 정렬 조건, `AuditLog`/`Notification` 통합 활동과 권한별 마스킹, 결제 요청 row 기반 승인/부서 집계 |
| 결제 요청 | 거래처 추가 | `createPageRow("vendors")`, master data 재조회 | `POST /vendors` | `Vendor`, 계좌/세금계산서 validation, 감사 로그 |
| 파일 | 업로드, 진행률 표시, 실패 재시도, 이탈 복구 metadata, 완료, PDF/이미지 미리보기, 다운로드, 삭제 | `presignFileUpload`, `uploadFileContent(progress)`, `completeFileUpload`, `getFileDownload(reason, disposition)`, `deleteFile` | `/files/*` | `Attachment`, object storage adapter, scan status, 다운로드/미리보기 사유 `AuditLog(download_request)`, signed URL 만료, 업로드 recovery metadata, 감사/보안 이벤트 |
| 대시보드 | 운영 지표 새로고침 | `getOperationalAlerts`, `getBusinessFailureAlerts`, `DashboardOperationalMetrics` | `GET /operations/alerts`, `GET /operations/business-failure-alerts` | 처리량, alert rule 오류율, p95 latency, 지급/보고서/업로드 실패 count를 `security_events`와 business failure rule 기준으로 표시 |
| 공통 API | 조회 timeout, 네트워크 실패, 서버 5xx, rate limit | `requestRemoteEnvelope` 15초 timeout, GET 계열 1회 retry, `ApiRequestError` 표준화 | 모든 remote GET/HEAD/OPTIONS route | 408/429/502/503/504와 네트워크/timeout 오류는 읽기 요청만 재시도, mutation은 idempotencyKey가 있어도 자동 재시도 금지 |
| 로그인 | 비밀번호 만료 변경 | `changeExpiredPassword`, LoginScreen 만료 모드 | `POST /auth/password/change-expired` | 현재 비밀번호 검증, 새 비밀번호 정책 검증, `User.passwordHash` 갱신, 전체 세션 revoke, `password_change` 감사 로그 |
| 공통 표 | 생성/수정/상태 변경 실패 복구 | mutation 직전 rows/선택/total 스냅샷 보관 후 실패 시 원복, `listPageRows` 재조회 | 각 화면 `POST/PATCH/action` route와 후속 `GET` 목록 route | 서버 실패, 권한 실패, rowVersion 충돌, 네트워크 실패가 임시 화면 상태로 남지 않고 서버 원본 목록으로 수렴 |
| 승인 관리 | 승인, 반려, 보류, 일괄 승인, 단계별 이력 조회 | `executePageAction("approval")`, `updateSelectedRows` 건별 `allSettled`, `결재단계JSON` 상세 패널 파싱 | `GET/PATCH /approvals/{code}`, delegated action route | `ApprovalStep` 상태/사유/처리자/처리시간, 일괄 성공/실패 건별 결과와 실패 건 선택 유지, `PaymentRequest`, 최종 승인 예산 사용액/상태, 예산 주의/초과 알림, 감사 로그 |
| 지급 관리 | 지급 실행, 보류, 재처리, 계좌 재확인, 예정일 변경 | `updatePageRow`, `executePageAction`, 계좌 검증/재처리 정책 row 표시, 지급 일정 정책 표시 | `PATCH /disbursements/{code}` | `Disbursement`, `Vendor` 계좌 상태, 계좌검증 adapter/code/retry policy, backend 영업일/휴일/KST 마감 정책, 알림, 감사 로그 |
| 지급 관리 | 은행 이체 파일 생성 | `exportDisbursementBankTransfer` | `GET /disbursements/bank-transfer-export` | DB 지급 대상, 승인/계좌 검증, 감사 로그 |
| 지급 관리 | 은행 결과 대사 | `reconcileDisbursementBankResults` | `POST /disbursements/bank-result-reconcile` | 지급번호/승인번호/금액 대사, 오류 상태 보정, 감사 로그 |
| 예산 관리 | 예산 등록, 수정, 재오픈/마감 액션, 조정 취소/반려 | `createPageRow`, `updatePageRow`, `executePageAction`, 예산 조정 이력 카드 액션 | `POST/PATCH /budgets`, `/budgets/{department}/adjustments/{id}/cancel|reject`, delegated action route | `Budget`, `BudgetAdjustment`, pending 조정 원장 미반영 종료, applied 조정 보정 전표 기준, 마감 통제, 감사 로그 |
| 거래처 관리 | 신규 등록, 수정, 비활성화, 계좌 재확인 | `createPageRow`, `updatePageRow`, `deletePageRow`, `executePageAction` | `POST/PATCH/DELETE /vendors`, delegated action route | `Vendor`, 계좌 암호화/마스킹, 감사 로그 |
| 거래처 관리 | 목록 검색, 상태/계좌/구분 필터, 페이지네이션 | `listPageRows("vendors", query)` | `GET /vendors?search=&filter.*=&page=&pageSize=&sort=` | backend `filterAndSortRows` 결과와 화면 total/page 동기화 |
| 거래처 관리 | 지급 이력 탭, 최근 지급/요청 더보기 | `listPageRows("disbursement")`, `listPageRows("payment-request")` | `GET /disbursements`, `GET /payment-requests` | `Disbursement`, `PaymentRequest`, 요청 부서/상태/금액 row |
| 보고서 | 목록 검색/필터/정렬/페이지 이동, 생성, 수정, 삭제, 공유 권한 변경 | `listPageRows`, `createPageRow`, `updatePageRow`, `deletePageRow` | `GET /reports?search&filter.*&sort&page&pageSize`, `POST/PATCH/DELETE /reports` | `ReportRun`, `summary` 공유권한/부서/거래처 metadata, 서버 total/page, 감사 로그 |
| 보고서 | 저장된 보고서 별표 즐겨찾기 | `listPageRows/createPageRow/updatePageRow/deletePageRow("favorites")` | `/favorites/*` | `FavoriteItem` 보고서 유형, `filters`, `isActive`, rowVersion, 감사 로그 |
| 보고서 | CSV/PDF 다운로드 | `downloadReport` | `GET /reports/{name}/download?format=csv|pdf` | `ReportRun.artifactKey` object storage artifact 기준 파일, 기존 run 최초 다운로드 시 자동 보관, 감사 로그 |
| 보고서 | 예약 발송 추가/수정/중지 | `listReportSchedules`, `createReportSchedule`, `updateReportSchedule`, `deleteReportSchedule` | `GET/POST/PATCH/DELETE /reports/schedules` | `ReportDefinition`, `ReportSchedule`, internal/webhook delivery, retry/dead-letter, 내부 알림, 감사 로그 |
| 보고서 | 차트 원천 데이터 드릴다운 | 선택 보고서 `드릴다운JSON`을 `ReportDrilldownPanel`에서 파싱 | `POST/GET /reports`의 `ReportRun` summary snapshot metadata | 월별 지급, 부서 지출, 승인 상태 원천 행이 같은 `ReportRun` 생성 시점 snapshot 기준 |
| 보고서 | 감사 로그 조회 | `listAuditLogs`와 `AuditLogSearchCard` | `GET /operations/audit-logs` | `audit:read` 또는 `system:manage` 읽기 전용, raw before/after JSON 제외, 보관/아카이브 정책과 requestId 검색 |
| 시스템 설정 | 결재 정책, 알림, 외부 연동 설정 저장 | `saveSystemSetting` | `PATCH /settings/config/{key}` | append-only `AuditLog` system setting snapshot |
| 시스템 설정 | 외부 연동 테스트 | `testIntegrationSetting` | `POST /settings/integrations/{id}/test` | `idempotencyKey`, HTTPS endpoint 호출, 실패 사유/시각 저장, 감사 로그 replay/conflict |
| 시스템 설정 | 비밀번호 정책 조회/본인 비밀번호 변경 | `getPasswordPolicy`, `changePassword`, `PasswordSecurityCard` | `GET /auth/password-policy`, `POST /auth/password/change` | 현재 비밀번호 검증, 새 비밀번호 정책 검증, `User.passwordHash` 갱신, 다른 활성 세션 revoke, `password_change` 감사 로그 |
| 시스템 설정 | 권한 그룹 생성/수정/삭제, 세부 권한 코드 토글 | role settings API, `permissionCodes` 보존, 세션 무효화 meta 표시 | `/settings/roles/*` | `Role.permissions` 개별 코드(`payment_request:*`, `approval:*`, `disbursement:*`, `vendor:read`, `audit:read`, `system:manage`), 사용 중 삭제 차단, permission/status 변경 대상 사용자 `AuthSession` revoke, 감사 로그 |
| 시스템 설정 | 사용자 권한 생성/수정/비활성화 | `createPageRow`, `updatePageRow`, delegated action route, 세션 무효화 meta 표시 | `/settings/*` | `User`, `UserRole`, 권한/상태/부서 변경 대상 사용자 `AuthSession` revoke, 다음 요청부터 재로그인 요구, 감사 로그 |
| 시스템 설정 | 부서 추가/기본 권한/승인 라우팅 저장 | `saveSystemSetting("approvalPolicy")` | `PATCH /settings/config/approvalPolicy` | `approvalPolicy.departmentSettings` snapshot, 결재 정책과 함께 저장 |
| 시스템 설정 | 보관 정책 조회/새로고침 | `getRetentionPolicySummary`, `RetentionPolicyCard` | `GET /operations/retention-policy` | 감사 로그/알림/첨부 metadata/보고서 산출물 retention policy, 불변성, 정리 대상 count, system:manage 권한 |
| 시스템 설정 | 장애 기능 제한 모드 조회/새로고침 | `getOperationMode`, `OperationModeCard` | `GET /operations/mode`, 전역 operation mode preHandler | `ERP_OPERATION_MODE`/`ERP_DISABLED_CAPABILITIES` 기준 읽기 전용, 지급 일시 중지, 파일 업로드 중지 차단 상태를 표시하고 대상 mutation은 `OPERATION_MODE_RESTRICTED`로 서버 차단 |
| 시스템 설정 | 보고서 예약 job 대기 확인/실행 | `getReportJobStatus`, `runReportJobs`, `ReportJobWorkerCard` | `GET /operations/report-jobs`, `POST /operations/report-jobs/run` | `ReportSchedule.nextRunAt` due schedule batch 처리, 성공 `ReportRun`, retry backoff, dead-letter 비활성화, circuit breaker, 감사 로그, 내부 알림 |
| 시스템 설정 | 데이터 품질 배치 조회/실행/리포트 다운로드 | listDataQualityRuns, runDataQualityJob, downloadDataQualityRun, DataQualityRunCard | GET /operations/data-quality/runs, POST /operations/data-quality/run, GET /operations/data-quality/runs/{id}/download | DataQualityRun 실행 이력, scheduleKey 중복 방지, critical 관리자 알림, JSON report artifact, system:manage 권한 |
| 시스템 설정 | 성능/용량 기준 조회 | `getPerformancePolicy`, `PerformancePolicyCard` | `GET /operations/performance-policy` | p95/p99 latency 목표, report job 최대 처리 시간, 보고서 직접 다운로드 row/byte 제한, `/reports/{name}/download` HTTP 413 차단 기준 |
| 시스템 설정 | 계정 수명주기 조회/휴면·퇴사자 비활성화 | `getAccountLifecycleSummary`, `deactivateAccountLifecycle`, `AccountLifecycleCard` | `GET /operations/account-lifecycle`, `POST /operations/account-lifecycle/deactivate` | 휴면 계정, `OFFBOARDING_USER_EMAILS`/`TERMINATED_USER_EMAILS` 대상 계정 비활성화, 세션 revoke, 감사 로그 |
| 시스템 설정 | 재무 대사 조회/불일치 알림 발송 | `getFinancialReconciliationSummary`, `notifyFinancialReconciliation`, `FinancialReconciliationCard` | `GET /operations/financial-reconciliation`, `POST /operations/financial-reconciliation/notify` | 예산 사용액, 예산 항목 사용액, 승인 완료 요청, 지급 완료, 보고서 드릴다운 스냅샷 금액/상태 대사, 담당자 운영 알림 |
| 시스템 설정 | 수동 복구 요청/2차 승인/반려 | `listManualRecoveries`, `requestManualRecovery`, `approveManualRecovery`, `rejectManualRecovery`, `ManualRecoveryCard` | `GET/POST /operations/manual-recoveries`, `POST /operations/manual-recoveries/{id}/approve|reject` | 지급 건 복구 요청, 요청자/승인자 분리, 전/후 상태, 사유, idempotencyKey, `manual_recovery` 감사 로그 |
| 시스템 설정 | 재무 통제 리포트/월말 결산 점검표 조회 | `getFinancialControlReport`, `FinancialControlReportCard` | `GET /operations/financial-control-report` | 재무 대사 예외, 수동 복구 대기, 은행 결과 대사 감사 로그, 지급 변경 감사 로그, 보고서 스냅샷 검토 여부를 월 단위 점검표로 반환 |
| 시스템 설정 | 취소, 되돌리기 | 서버 원본 snapshot restore | `GET /settings/config`, `/settings/roles`, `/settings` | 마지막 backend 원본 또는 저장 성공 snapshot으로 편집값 복원 |
| 시스템 설정 | 변경 이력 필터, 더보기 | `listSystemSettingHistory` | `GET /settings/history` | `AuditLog` system_setting/role/user settings actions, actor/department, 감사 로그 시각 |
| 즐겨찾기 | 바로가기 추가, 삭제, 순서 편집, 사용자 저장, 열기 사용 기록, 최근 사용 목록, 수동 동기화, 포커스 복귀 재조회 | `listPageRows/createPageRow/updatePageRow/deletePageRow("favorites")` | `/favorites/*` | `FavoriteItem`, `sortOrder`, `filters`, `lastUsedAt`, 저장 필터 재조회, 최근 사용순 정렬, 감사 로그 |

## Local-only Or Not Go-live Complete

| 화면 | 항목 | 현재 상태 | Go-live 전 필요 작업 |
| --- | --- | --- | --- |
| 공통 표 | 검색/필터/정렬/페이지 크기 복원 | `erp-table-state:{pageKey}` localStorage | 업무 데이터 변경은 아니므로 허용한다. 업무 row cache, stale data, 수동 새로고침, 재로그인 기준은 `docs/frontend-cache-revalidation-policy.md`를 따른다. |
| 결제 요청 | 작성 중 autosave 복구 | 정상 경로는 `PaymentRequest` DRAFT row debounced PATCH, 실패 시 `erp-payment-draft:{requestId}` fallback | 다른 브라우저/재로그인 복구 증빙과 fallback 정리 정책 확인 |
| 보고서 | 외부 발송 webhook 운영 검증 | 예약 job worker는 internal/webhook delivery, retry, dead-letter, circuit breaker까지 연결 | SMTP/메신저는 webhook 수신 서비스에서 처리하며, staging/prod webhook endpoint 배포와 발송 리허설 증적 필요 |
| 대시보드 | staging/prod 집계 검증 | `/dashboard` row로 KPI, 긴급 결재, 최근 활동, 승인 추이, 부서별 지출을 계산하고 감사 로그 상세는 권한별 마스킹 | 실제 staging/prod 데이터 규모에서 집계 정확도와 권한별 표시 smoke 필요 |
| 운영 배포 | remote mode E2E | test DB가 있으면 로그인 유지, 거래처 등록/증빙 업로드, 결제 요청 생성/첨부/제출, 승인자 순차 승인, 지급 보류, 새로고침/두 번째 브라우저 로그인 후 유지 UI flow를 backend+Vite remote mode로 검증 | staging DB/object storage/scanner에서 동일 artifact로 전체 업무 smoke 검증 필요 |

## Regression Guards

- `backendRoutePermissionGuards.test.ts`: route별 인증/권한 가드 유지
- `backendAuditTransactionCoverage.test.ts`: 주요 mutation과 감사 로그의 동일 transaction 기록 유지
- `frontendFavoritesRemote.test.ts`: 즐겨찾기 화면이 `erp-favorites` localStorage가 아니라 `FavoriteItem` API를 사용하도록 고정
- `frontendReportDownloads.test.ts`: 보고서 생성/다운로드가 `ReportRun` API와 서버 생성 파일 payload를 사용하도록 고정
- `frontendReportSchedules.test.ts`: 보고서 예약 발송 추가/수정/중지가 `ReportSchedule` API와 내부 알림을 사용하도록 고정
- `frontendArtifactScanner.test.ts`: production artifact에 mock fixture/local endpoint/test secret 문자열 유입 차단
- `remote-ui-persistence.test.mjs`: 브라우저 거래처 등록, 증빙 업로드, 결제 요청 제출, 승인자 순차 승인, 지급 보류, 새로고침과 두 번째 브라우저 로그인 후 유지, DB/file/audit 대사 검증
