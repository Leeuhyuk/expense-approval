# ERP Database ERD

작성일: 2026-07-04

권장 DB: PostgreSQL

## 핵심 ERD

```mermaid
erDiagram
  DEPARTMENTS ||--o{ USERS : has
  DEPARTMENTS ||--o{ PAYMENT_REQUESTS : owns
  USERS ||--o{ PAYMENT_REQUESTS : requests
  USERS ||--o{ APPROVAL_STEPS : acts_on
  USERS ||--o{ AUDIT_LOGS : writes
  USERS ||--o{ NOTIFICATIONS : receives
  USERS ||--o{ AUTH_SESSIONS : authenticates
  USERS ||--o{ REPORT_DEFINITIONS : owns
  USERS ||--o{ REPORT_RUNS : creates
  USERS ||--o{ REPORT_SCHEDULES : schedules
  USERS ||--o{ FAVORITE_ITEMS : saves
  VENDORS ||--o{ PAYMENT_REQUESTS : receives
  VENDORS ||--o{ DISBURSEMENTS : paid_to
  BUDGETS ||--o{ BUDGET_ITEMS : contains
  BUDGET_ITEMS ||--o{ PAYMENT_REQUESTS : funds
  PAYMENT_REQUESTS ||--o{ APPROVAL_STEPS : has
  PAYMENT_REQUESTS ||--o{ DISBURSEMENTS : creates
  PAYMENT_REQUESTS ||--o{ ATTACHMENTS : includes
  PAYMENT_REQUESTS ||--o{ AUDIT_LOGS : tracked_by
  DISBURSEMENTS ||--o{ AUDIT_LOGS : tracked_by
  VENDORS ||--o{ ATTACHMENTS : registers
  ROLES ||--o{ USER_ROLES : assigned
  USERS ||--o{ USER_ROLES : has
  REPORT_DEFINITIONS ||--o{ REPORT_RUNS : produces
  REPORT_DEFINITIONS ||--o{ REPORT_SCHEDULES : schedules

  DEPARTMENTS {
    uuid id PK
    string name
    uuid parent_id FK
    boolean is_active
    timestamptz created_at
    timestamptz updated_at
  }

  USERS {
    uuid id PK
    uuid department_id FK
    string name
    string email
    string password_hash
    boolean is_active
    timestamptz last_login_at
    timestamptz created_at
    timestamptz updated_at
  }

  ROLES {
    uuid id PK
    string code
    string name
    jsonb permissions
    boolean is_active
  }

  USER_ROLES {
    uuid user_id FK
    uuid role_id FK
    timestamptz assigned_at
  }

  AUTH_SESSIONS {
    uuid id PK
    uuid user_id FK
    string user_agent
    string ip_address
    timestamptz created_at
    timestamptz last_seen_at
    timestamptz idle_expires_at
    timestamptz absolute_expires_at
    timestamptz rotated_at
    timestamptz revoked_at
  }

  VENDORS {
    uuid id PK
    string name
    string business_number
    string bank_name
    string bank_account_encrypted
    string bank_account_masked
    string account_verification_status
    string status
    boolean is_active
    int row_version
    timestamptz created_at
    timestamptz updated_at
  }

  BUDGETS {
    uuid id PK
    uuid department_id FK
    string fiscal_year
    numeric allocated_amount
    numeric used_amount
    string status
    int row_version
  }

  BUDGET_ITEMS {
    uuid id PK
    uuid budget_id FK
    string name
    numeric allocated_amount
    numeric used_amount
    string status
  }

  PAYMENT_REQUESTS {
    uuid id PK
    string request_code
    uuid requester_id FK
    uuid department_id FK
    uuid vendor_id FK
    uuid budget_item_id FK
    numeric amount
    string currency
    string status
    text reason
    int row_version
    timestamptz requested_at
    timestamptz created_at
    timestamptz updated_at
  }

  APPROVAL_STEPS {
    uuid id PK
    uuid payment_request_id FK
    int step_order
    uuid approver_id FK
    string status
    text reason
    timestamptz acted_at
    int row_version
  }

  DISBURSEMENTS {
    uuid id PK
    string disbursement_code
    uuid payment_request_id FK
    uuid vendor_id FK
    numeric amount
    string status
    string account_verification_status
    date scheduled_date
    timestamptz executed_at
    int row_version
  }

  ATTACHMENTS {
    uuid id PK
    string owner_type
    uuid owner_id
    string file_name
    string content_type
    bigint byte_size
    string storage_key
    string checksum
    uuid uploaded_by FK
    timestamptz created_at
  }

  AUDIT_LOGS {
    uuid id PK
    string entity_type
    uuid entity_id
    uuid actor_id FK
    string action
    jsonb before_value
    jsonb after_value
    text reason
    string idempotency_key
    string request_id
    timestamptz created_at
  }

  NOTIFICATIONS {
    uuid id PK
    uuid user_id FK
    string type
    string title
    text message
    string entity_type
    string entity_id
    string link_path
    timestamptz read_at
    timestamptz expires_at
    timestamptz created_at
  }

  REPORT_DEFINITIONS {
    uuid id PK
    uuid owner_id FK
    string name
    string type
    text description
    jsonb filters
    boolean is_active
    timestamptz created_at
    timestamptz updated_at
  }

  REPORT_RUNS {
    uuid id PK
    uuid definition_id FK
    uuid created_by FK
    string name
    string type
    date period_start
    date period_end
    string status
    text summary
    string artifact_key
    int row_count
    timestamptz created_at
  }

  REPORT_SCHEDULES {
    uuid id PK
    uuid definition_id FK
    uuid user_id FK
    string frequency
    jsonb recipients
    boolean is_active
    timestamptz next_run_at
    timestamptz created_at
    timestamptz updated_at
  }

  FAVORITE_ITEMS {
    uuid id PK
    uuid user_id FK
    string kind
    string page_key
    string label
    string target_path
    jsonb filters
    int sort_order
    boolean is_active
    timestamptz last_used_at
    timestamptz created_at
    timestamptz updated_at
  }
```

## 주요 인덱스

| 테이블 | 인덱스 |
| --- | --- |
| `payment_requests` | unique `(request_code)`, `(status, requested_at desc)`, `(department_id, requested_at desc)`, `(vendor_id)` |
| `approval_steps` | `(approver_id, status)`, `(payment_request_id, step_order)` |
| `disbursements` | unique `(disbursement_code)`, `(status, scheduled_date)`, `(vendor_id, scheduled_date desc)` |
| `vendors` | unique `(business_number)`, `(account_verification_status, is_active)` |
| `audit_logs` | `(entity_type, entity_id, created_at desc)`, `(actor_id, created_at desc)`, unique nullable `(idempotency_key)` |
| `notifications` | `(user_id, read_at, created_at desc)`, `(type, created_at desc)` |
| `report_definitions` | `(owner_id, type)` |
| `report_runs` | `(created_by, created_at desc)`, `(type, created_at desc)` |
| `report_schedules` | `(user_id, is_active)`, `(definition_id, is_active)` |
| `favorite_items` | unique `(user_id, kind, label)`, `(user_id, kind, sort_order)` |

## 정합성 규칙

- `row_version`은 상태 변경 시 1씩 증가한다.
- 금액은 `numeric(18, 2)`로 저장하고 표시 포맷은 프론트에서 처리한다.
- 파일 본문은 DB에 저장하지 않고 object storage에 저장한다.
- `audit_logs`는 삭제하지 않는다. 보존 기간 정책은 별도 아카이브로 처리한다.
- 계좌번호는 암호화 저장하고 목록에는 마스킹 값만 반환한다.
- 알림은 사용자별로 저장하고 기본 보관 기간이 지난 건은 목록 조회에서 제외한다.
- 보고서 파일 본문은 object storage에 두고 `artifact_key`만 DB에 저장한다.
- 즐겨찾기는 사용자별로 저장하며 비활성 메뉴는 `is_active=false`로 숨긴다.
