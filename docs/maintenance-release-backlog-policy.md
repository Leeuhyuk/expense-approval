# Maintenance, Release, And Operations Backlog Policy

## Owners

| Area | Primary owner | Required reviewer |
| --- | --- | --- |
| Application and release | 기능 책임자 | 운영 책임자 |
| Security and permissions | 보안 책임자 | 운영 책임자 |
| Payment and reconciliation | 재무 책임자 | 기능 책임자 |
| Database, backup, monitoring | 운영 책임자 | 보안 책임자 |

실제 담당자 이름과 연락 채널은 go-live handoff에 기록한다. 동일 사용자가 변경 요청, production 승인, 사후 검토를 모두 수행하지 않는다.

## Recurring Maintenance Calendar

| Cadence | Work | Evidence |
| --- | --- | --- |
| Daily | API 5xx, 로그인/권한 실패, 승인·지급·파일·보고서 실패, backup 결과 확인 | monitoring 링크, requestId, incident ID |
| Weekly | 미결 승인, 지급 보류/오류, 데이터 품질 batch, report job dead-letter, 계정 수명주기 확인 | 운영 점검 기록, 담당자, 조치 기한 |
| Monthly | capacity forecast, 재무 대사, 권한 검토, 개인정보 접근, 감사 hash chain, retention 대상 확인 | 월간 리포트, 첫 경고/위험 월, 예외 승인 |
| Quarterly | staging backup/PITR/object restore, DR failover, rollback, break-glass 계정 검토 | rehearsal evidence, RPO/RTO, 복구 대사 |
| Annually | 권한 정책, 보관 기간, 개인정보 처리, vendor/은행 연동 계약 검토 | 정책 버전, 책임자 승인 |

점검이 실패하거나 기한을 넘기면 GitHub operations improvement issue를 생성한다. P0/P1은 release calendar와 무관하게 즉시 triage한다.

## Standard Release Calendar

- 정기 릴리즈: 매월 둘째 화요일 20:00 KST.
- 개선 요청 마감: 릴리즈 10영업일 전.
- scope freeze: 릴리즈 5영업일 전.
- release candidate 생성과 migration review: 릴리즈 3영업일 전.
- staging remote-mode smoke와 책임자 go/no-go: 릴리즈 2영업일 전까지.
- production change freeze: 릴리즈 당일 12:00 KST부터 배포 완료와 smoke 종료까지.
- 다음 영업일: monitoring, 재무 대사, 데이터 품질, 문의/장애 확인.

같은 artifact, migration, manifest hash가 staging을 통과하지 않으면 다음 정기 릴리즈로 이월한다. P0/P1 예외 승인은 owner, due date, 영향, 완화책, 승인 증적이 없으면 허용하지 않는다.

## Emergency Hotfix

1. P0 또는 보안/지급 정합성 위험을 incident로 등록하고 기능·보안·재무·운영 영향 owner를 지정한다.
2. `codex/hotfix-*` 또는 승인된 hotfix branch에서 최소 변경만 적용한다.
3. 단위 테스트, 관련 E2E, backend/frontend build, mutation/sensitive-data/migration gate를 실행한다.
4. staging 또는 production-like 환경에서 영향 경로 smoke와 rollback 시간을 확인한다.
5. 요청자와 다른 승인자가 production 배포와 rollback 기준을 승인한다.
6. 배포 후 30분 집중 관찰, 재무/데이터 대사, 사용자 공지를 수행한다.
7. 2영업일 안에 원인, 탐지 누락, 재발 방지, 정기 branch 반영 여부를 검토한다.

테스트나 staging을 생략해야 하는 즉시 완화는 읽기 전용 전환, 지급 일시 중지, 업로드 일시 중지 같은 operation mode를 우선 사용하고 break-glass evidence를 남긴다.

## Improvement Intake

모든 운영 개선 요청은 `.github/ISSUE_TEMPLATE/operations-improvement.yml`로 접수한다. 최소 입력은 다음과 같다.

- 요청 유형, 환경, 사용자 영향, 현재 동작, 기대 동작
- 관련 화면/API, requestId 또는 증적 링크
- 보안·재무·데이터·운영 영향
- severity, 임시 우회 절차, 요청 기한
- 제안 owner와 완료 기준

문의나 장애에서 파생된 개선은 원 incident ID를 연결한다. 개인정보, 계좌 원문, session cookie, signed URL token은 issue에 기록하지 않는다.

## Backlog Workflow

| State | Exit criteria |
| --- | --- |
| Intake | 중복 확인, 증적, 영향, severity가 기록됨 |
| Triaged | owner, priority, target release, acceptance criteria가 확정됨 |
| Ready | 설계/권한/데이터/migration/rollback 영향 검토 완료 |
| In progress | branch 또는 PR, 테스트 계획, 담당자가 연결됨 |
| Release candidate | CI와 관련 release gate 통과, staging 증적 연결 |
| Released | production release ID, smoke, monitoring 결과 기록 |
| Verified | 요청자 확인, KPI/오류율 확인, 후속 조치 없음 |

우선순위는 severity를 먼저 적용하고, 같은 severity에서는 사용자 수, 지급/데이터 위험, 반복 빈도, 우회 비용, 구현 위험으로 정렬한다. P0는 즉시, P1은 현재 또는 다음 릴리즈, P2는 분기 계획, P3는 후보 backlog로 관리한다.

## Release Plan Integration

- 월간 점검에서 `Triaged`와 `Ready` P1/P2를 검토하고 target release와 owner를 지정한다.
- go-live 2주 후 안정화 회고에서 남은 P1/P2를 다시 정렬한다.
- 각 정기 릴리즈는 포함 issue, 제외 issue와 사유, known issue, rollback 조건을 release note에 기록한다.
- 2회 연속 이월된 P1/P2는 운영 책임자가 scope 축소, 추가 인력, 폐기 중 하나를 결정한다.
- 향후 개선 backlog는 target release가 없는 상태로 30일을 넘기지 않는다.

## Initial Operating Backlog

| ID | Work | Priority | Target milestone | Owner role | Acceptance evidence |
| --- | --- | --- | --- | --- | --- |
| OPS-001 | 실제 test DB에서 remote auth/UI persistence E2E 실행 | P0 | Production candidate | 기능 책임자 | skip 없는 DB test evidence |
| OPS-002 | production과 분리된 staging DB, storage, auth, secret, domain 구성 | P0 | Staging readiness | 운영 책임자 | environment inventory와 health smoke |
| OPS-003 | PostgreSQL backup/PITR와 object storage restore rehearsal | P0 | Go-live approval | 운영 책임자 | RPO/RTO와 restore reconciliation |
| OPS-004 | 요청자, 승인자, 재무팀, 관리자, 외부 감사 역할별 UAT | P0 | Go-live approval | 기능 책임자 | role UAT sign-off |
| OPS-005 | 첫 업무/지급 대사와 2주 KPI·오류율 안정화 검토 | P1 | Stable operation | 재무 책임자 | hypercare와 final acceptance evidence |
## Minimum Evidence

- GitHub issue/PR/release 링크
- release manifest와 migration review hash
- staging smoke 결과와 production smoke 결과
- 관련 requestId, monitoring, 재무/데이터 품질 대사
- owner, reviewer, 완료 시각, 다음 검토일
