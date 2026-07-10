# Disaster Recovery Failover Runbook

작성일: 2026-07-10

이 문서는 primary 환경의 장기 장애 시 DR 환경 전환, DNS failover, 사용자 커뮤니케이션, 원복(failback)을 같은 승인·증적 기준으로 수행하기 위한 실행 템플릿이다. 실제 운영 전 환경별 값을 채운 사본을 보관하고 docs/backup-restore-rehearsal-template.md, docs/incident-response.md, docs/rollback-break-glass-runbook.md와 함께 리허설한다.

## DR 환경 인벤토리

| 항목 | Primary | DR | 확인 증적 |
| --- | --- | --- | --- |
| Frontend origin | <primary-frontend-origin> | <dr-frontend-origin> | 배포 ID와 release manifest hash |
| API origin | <primary-api-origin> | <dr-api-origin> | /api/health/version 결과 |
| PostgreSQL | <primary-db-reference> | <dr-db-reference> | replication/PITR 상태 |
| Object storage | <primary-bucket> | <dr-bucket> | versioning과 object 대사 |
| Secret manager | <primary-secret-scope> | <dr-secret-scope> | 접근 역할과 rotation 기록 |
| Monitoring/logs | <primary-monitor> | <dr-monitor> | alert 전달과 requestId 검색 |
| DNS provider | <dns-provider> | <same-provider-or-secondary> | zone 변경 감사 로그 |

DR 환경은 production과 동일 release artifact 및 migration version을 사용하되 DB, object storage, secret, runtime credential은 별도 범위로 분리한다. DR endpoint는 평시 public traffic을 받지 않아도 /api/health, /api/health/db, /api/health/storage, /api/health/jobs, /api/health/version 점검이 가능해야 한다.

## 전환 승인 기준

| 조건 | 판단 기준 | 승인자 |
| --- | --- | --- |
| Primary API/DB 장기 중단 | P0 선언 후 RTO 내 복구 불가 예상 | Incident commander, 운영 책임자 |
| 데이터 손상 의심 | 마지막 정상 WAL/PITR 시점과 RPO 영향 확정 | DBA, 재무 책임자 |
| Object storage 장애 | 첨부 조회/업로드 중단이 업무 허용 시간을 초과 | 운영 책임자, 보안 책임자 |
| 권한 또는 보안 사고 | 오염된 credential/session을 DR로 복제하지 않음 | 보안 책임자 |
| DNS failover 실행 | DR smoke, 데이터 대사, 사용자 공지 준비 완료 | 기능·보안·재무·운영 책임자 |

승인 기록에는 incident ID, 결정 시각, 허용 가능한 데이터 손실 범위, 선택한 restore point, 읽기 전용 여부, 다음 업데이트 시각을 남긴다.

## DNS Failover 절차

1. 평시 TTL은 <approved-ttl-seconds>로 관리하고 변경 전후 DNS record snapshot과 provider audit log를 보관한다.
2. Primary mutation을 중지하고 ERP_OPERATION_MODE=read_only 또는 maintenance 적용 여부를 확인한다.
3. DR DB restore/replication 상태, object storage 복구 상태, secret scope, CORS/cookie domain, API base URL을 확인한다.
4. DR에서 release:core-smoke, 로그인, 결제 요청 목록, 승인 dry-run, 첨부 다운로드, 보고서 다운로드, operations/data-quality를 실행한다.
5. DNS record를 DR frontend/API origin으로 변경하고 authoritative DNS와 외부 resolver에서 새 target, TTL, HTTPS 인증서를 확인한다.
6. synthetic monitor와 API 5xx/latency alert를 확인하고, 최소 <observation-window-minutes>분 동안 오류율 기준을 통과한 뒤 mutation 재개를 승인한다.
7. 변경자, 승인자, 이전/이후 record, propagation 확인 시각, smoke 결과, release manifest hash를 incident 기록에 첨부한다.

DNS provider 장애에 대비해 승인된 수동 변경 계정 또는 secondary DNS 절차를 별도로 보관하고, break-glass credential은 time-boxed 발급 후 즉시 revoke한다.

## 데이터 정합성 점검

전환 직전과 직후에 같은 기준 시각으로 다음 결과를 대사한다.

- 사용자·부서·권한 그룹 건수와 활성 사용자 수
- 결제 요청 총건수, 상태별 건수, 금액 합계
- 승인 대기 단계와 처리 완료 단계 건수
- 예산 총액, 사용액, 잔액
- 거래처 수, 지급 이력 건수와 지급 금액 합계
- 첨부 metadata와 object storage object 수, orphan 수
- 보고서 run/artifact 수와 다운로드 가능 여부
- /api/operations/data-quality critical count

RPO 범위 안에서 누락이 발생한 경우 재입력·보정·지급 보류 대상을 재무 책임자가 승인하기 전 mutation을 재개하지 않는다.

## 장기 장애 커뮤니케이션 템플릿

### 최초 공지

[장애 <incident-id>] <detected-at>부터 <affected-functions> 사용에 장애가 발생했습니다. 현재 <read-only/maintenance/payment-pause> 조치를 적용했으며 데이터 및 지급 영향은 <confirmed/under-investigation>입니다. 다음 업데이트는 <next-update-at>에 공유합니다.

### 정기 업데이트

[장애 <incident-id> 업데이트 <sequence>] 현재 영향 범위는 <scope>이며, DR 전환 단계는 <restore/smoke/dns/observation>입니다. 확인된 데이터 손실 범위는 <none/rpo-window>이고 사용자 우회 절차는 <workaround>입니다. 다음 업데이트는 <next-update-at>입니다.

### RTO 초과 공지

[장애 <incident-id> 장기화] 예상 복구 시간이 기존 RTO <target>을 초과해 <new-eta>로 변경되었습니다. <request/approval/payment/upload/report> 업무는 <available/restricted/unavailable> 상태이며 긴급 업무 접수 채널은 <channel>입니다. 지급과 데이터 보정은 재무·운영 승인 후 진행합니다.

### 복구 완료 공지

[장애 <incident-id> 복구] <recovered-at> DR 전환 및 검증을 완료했습니다. 현재 <enabled-functions> 사용이 가능하며 <remaining-restrictions>는 계속 적용됩니다. 데이터 대사 결과는 <result>이고, 잔여 영향과 사후 분석 일정은 <follow-up>에서 공유합니다.

공지에는 stack trace, secret, 계좌번호, signed file URL을 포함하지 않는다. P0는 30분마다 또는 상태 변경 즉시 갱신하고, 대상은 사용자·승인자·재무팀·운영팀·보안팀으로 구분한다.

## Failback 절차

1. Primary 원인 제거와 보안 검토를 완료하고 새 restore/replication 기준 시각을 확정한다.
2. DR에서 발생한 mutation을 primary로 동기화하고 양쪽 데이터 정합성 결과를 승인받는다.
3. Primary에 동일 release artifact와 migration version을 배포하고 core smoke를 통과시킨다.
4. 변경 freeze 후 DNS를 primary로 되돌리고 propagation과 synthetic monitor를 확인한다.
5. 관찰 시간 동안 오류율·latency·업무 실패·데이터 품질 기준을 통과한 뒤 DR을 standby로 전환한다.
6. break-glass credential과 임시 access를 revoke하고 incident 사후 분석 및 개선 backlog를 등록한다.

## 리허설 및 증적

DR 리허설은 최소 반기마다, DNS provider·DB topology·object storage·인증 구조가 바뀔 때 추가로 수행한다. 실제 production 데이터 대신 승인된 staging/sanitized snapshot을 사용한다.

| 증적 | 기록 값 |
| --- | --- |
| Rehearsal ID/date | <rehearsal-id-and-date> |
| 참가자와 승인자 | <owners-and-approvers> |
| 사용 release manifest | <sha256> |
| Restore point와 실제 RPO | <timestamp-and-duration> |
| DNS 변경과 propagation 시간 | <record-and-duration> |
| Core smoke/data-quality 결과 | <evidence-link> |
| 실제 RTO | <duration> |
| 장기 장애 공지 발송 테스트 | <channel-and-message-link> |
| Failback 결과 | <evidence-link> |
| 미해결 항목 owner/due date | <backlog-reference> |

리허설 결과는 backup/restore evidence와 incident drill 기록에 연결하고, P0/P1 실패가 있으면 보완 또는 책임자 예외 승인 전 production go-live를 승인하지 않는다.