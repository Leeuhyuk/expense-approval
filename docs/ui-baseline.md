# ERP UI Baseline

작성일: 2026-07-04

이 문서는 기능화 작업 중 기존 ERP 화면 디자인을 보호하기 위한 기준이다. 기능 연결 단계에서는 레이아웃, 폰트 비율, 색상, 간격, 테이블 구성, 카드 배치, 사이드바 구조를 변경하지 않는다.

## 기준 스크린샷

기준 이미지는 `generated-images/erp-sidebar-pages-20260703-2229`에 보관한다.

| 화면 | 라우트 | 기준 파일 |
| --- | --- | --- |
| 대시보드 | `#dashboard` | `01-dashboard.png` |
| 결제 요청 | `#payment-request` | `02-payment-request.png` |
| 승인 관리 | `#approval` | `03-approval-management.png` |
| 지급 관리 | `#disbursement` | `04-disbursement-management.png` |
| 예산 관리 | `#budget` | `05-budget-management.png` |
| 거래처 관리 | `#vendors` | `06-vendor-management.png` |
| 보고서 | `#reports` | `07-reports.png` |
| 시스템 설정 | `#settings` | `08-system-settings.png` |
| 즐겨찾기 | `#favorites` | `09-favorites.png` |

랜딩 화면은 `#` 또는 hash 없는 기본 경로를 사용한다. 별도 기준 이미지는 `generated-images/ig_05890e725d4ba480016a47b5e6f56481918a64c7359d6a2057.png`를 참조한다.

## 라우트 목록

앱은 hash 기반 라우팅을 사용한다.

| 키 | 역할 |
| --- | --- |
| `landing` | 랜딩 페이지 |
| `dashboard` | 전체 현황 |
| `payment-request` | 결제 요청 작성 및 목록 |
| `approval` | 승인 대기 및 결재 처리 |
| `disbursement` | 지급 예정 및 지급 실행 |
| `budget` | 예산 사용률 및 조정 |
| `vendors` | 거래처와 계좌 검증 |
| `reports` | 지급/승인/예산 보고서 |
| `settings` | 정책, 권한, 변경 이력 |
| `favorites` | 자주 쓰는 메뉴와 저장 필터 |

## 주요 컴포넌트

| 영역 | 주요 컴포넌트 |
| --- | --- |
| 공통 | `App`, `LandingPage`, `TopNavigation`, `ErpApplication`, `PageBody`, `PageHeader`, `KpiCard`, `StatusPill` |
| 대시보드 | `DashboardBody`, `DashboardKpiRow`, `ApprovalQueue`, `DashboardCharts`, `RecentPaymentsTable`, `UrgentPaymentPanel`, `RecentActivityPanel` |
| 결제 요청 | `PaymentRequestBody`, `PaymentRequestToolbar`, `PaymentRequestTable`, `PaymentRequestInfoPanel` |
| 승인 관리 | `ApprovalBody`, `ApprovalToolbar`, `ApprovalRequestTable`, `ApprovalDetailPanel` |
| 지급 관리 | `DisbursementBody`, `DisbursementToolbar`, `DisbursementTable`, `DisbursementDetailPanel` |
| 예산 관리 | `BudgetBody`, `BudgetToolbar`, `BudgetUsageTable`, `BudgetDetailPanel` |
| 거래처 관리 | `VendorBody`, `VendorToolbar`, `VendorTable`, `VendorDetailPanel` |
| 보고서 | `ReportsBody`, `ReportsToolbar`, `ReportsTable` |
| 시스템 설정 | `SettingsBody`, `ApprovalLimitCard`, `ApprovalRuleCard`, `RolePermissionCard`, `UserAddCard`, `SettingsHistoryPanel` |
| 즐겨찾기 | `FavoritesBody`, `FavoritesToolbar`, `FavoriteMenuCards`, `SavedFilterCards`, `FavoriteRecentTable`, `FavoriteDetailPanel` |

## UI 변경 금지 기준

- 기능 연결 작업은 데이터, 상태, 이벤트 핸들러, API 계층 변경을 우선한다.
- `src/styles.css`는 기능 구현 중 원칙적으로 변경하지 않는다.
- 테이블 컬럼 순서, 카드 수, 우측 상세 패널 폭, 사이드바 항목 순서는 기준 스크린샷과 동일하게 유지한다.
- 기능 구현 때문에 문구가 바뀌어야 할 경우, 같은 길이대의 업무 문구로 교체하고 레이아웃 변화를 확인한다.

## 시각 검증 방식

1. `npm run build`로 타입과 번들 검증을 통과시킨다.
2. dev server를 실행한 뒤 1920 x 1080에서 9개 hash 라우트를 순회한다.
3. 기준 스크린샷과 사이드바, 상단 헤더, KPI 카드, 테이블, 우측 패널의 위치와 밀도를 비교한다.
4. 긴 데이터, 큰 금액, 상태 배지, 빈/오류/로딩 상태를 추가할 때는 1440, 1280, 모바일 폭도 함께 확인한다.

## 인코딩 기준

- 한글 문서와 소스 파일은 UTF-8로 저장한다.
- 새 파일은 UTF-8 without BOM을 기본값으로 한다.
- 한글 깨짐이 보이면 기능 구현보다 먼저 인코딩 문제를 수정한다.
