# Capacity Planning And Monthly Growth Forecast

## Purpose

운영자는 시스템 설정의 `보관 정책 > 12개월 용량 계획`에서 현재 DB 행 수와 첨부 저장량을 기준으로 월별 증가량 예측을 확인한다. 리포트는 원시 결제 사유, 계좌번호, 개인정보를 읽지 않고 Prisma count와 `Attachment.byteSize` 합계만 사용한다.

## Baseline

- 업무 데이터: 결제 요청, 승인 단계, 지급, 거래처, 알림, 보고서 실행, 데이터 품질 실행 건수
- 운영 로그: 감사 로그 건수
- object storage: 첨부 metadata 건수와 byte 합계
- DB 추정량: 업무 행, 감사 로그, 첨부 metadata에 환경별 평균 row byte를 적용한 합계

실제 DB 파일 크기와 object storage provider의 billable byte는 운영 대시보드에서 월 1회 대사한다. 본 리포트는 추세와 증설 시점을 판단하는 계획 값이며 백업, versioning, WAL 보관량은 별도 인프라 지표로 관리한다.

## Forecast Policy

| Environment | Default | Purpose |
| --- | ---: | --- |
| `CAPACITY_FORECAST_MONTHS` | 12 | 현재 월 이후 예측 개월 수, 최대 36 |
| `CAPACITY_TRANSACTION_GROWTH_PERCENT` | 8 | 업무 데이터 월 성장률 |
| `CAPACITY_AUDIT_GROWTH_PERCENT` | 12 | 감사 로그 월 성장률 |
| `CAPACITY_ATTACHMENT_GROWTH_PERCENT` | 10 | 첨부 건수와 저장 byte 월 성장률 |
| `CAPACITY_DATABASE_LIMIT_BYTES` | 20 GiB | 애플리케이션 DB 계획 한도 |
| `CAPACITY_OBJECT_STORAGE_LIMIT_BYTES` | 200 GiB | 첨부 object storage 계획 한도 |
| `CAPACITY_AVG_BUSINESS_ROW_BYTES` | 2048 | 업무 행 평균 추정 byte |
| `CAPACITY_AVG_AUDIT_ROW_BYTES` | 1536 | 감사 로그 평균 추정 byte |
| `CAPACITY_AVG_METADATA_ROW_BYTES` | 1024 | 첨부 metadata 평균 추정 byte |
| `CAPACITY_WARNING_PERCENT` | 70 | 증설 검토 시작 임계치 |
| `CAPACITY_CRITICAL_PERCENT` | 85 | 증설 또는 보관 정책 변경 승인 임계치 |

staging과 production은 최근 3개월 실측 증가량을 기준으로 growth percent를 갱신한다. 신규 도입 시 기본값을 사용할 수 있지만 첫 월말 검토에서 실제 증가율로 교체한다.

## Monthly Review

1. 시스템 설정에서 용량 계획을 새로고침하고 baseline month, 첫 경고 월, 첫 위험 월을 기록한다.
2. DB provider와 object storage provider의 실제 사용량을 리포트 추정값과 대사한다.
3. 오차가 15%를 넘으면 평균 row byte 또는 월 성장률을 조정한다.
4. 경고 월이 3개월 이내이면 DB 증설, `AuditLog` partition/archive, 첨부 lifecycle/cold tier 작업을 backlog가 아닌 운영 변경으로 승인한다.
5. 위험 월이 예측 범위에 들어오면 go-live 또는 대량 데이터 이관 전에 증설 완료 증적을 남긴다.

## API And Access

- `GET /operations/capacity-planning`
- 필요 권한: `system:manage`
- 응답: baseline, assumptions, 현재+월별 forecast, 첫 경고/위험 월, capacity headroom, 권장 조치
- 개인정보/계좌정보/파일 본문은 응답하지 않는다.

## Evidence

- `npm run release:performance-capacity`
- `npx tsx --test tests/unit/capacityPlanningReport.test.ts`
- 시스템 설정 화면의 월별 forecast 표와 첫 경고/위험 월 캡처
- staging/production provider 사용량 대사 기록
