# Data Migration Readiness

작성일: 2026-07-06

이 문서는 staging 또는 production 이관 전후에 확인할 데이터 품질 기준이다. 실제 원천 시스템, 컬럼 매핑, 담당자 승인은 release마다 별도 증적으로 확정한다. Production 후보 전에는 `docs/data-migration-evidence-template.md`를 복사해 확정 값을 채우고 `DATA_MIGRATION_EVIDENCE_PATH`로 지정한다. `RELEASE_TARGET=production npm run release:check`는 strict mode로 이 증빙에 미확정 값이 남아 있으면 실패한다.

## 필수 승인 정보

| 항목 | 기준 |
| --- | --- |
| 원천 시스템 | 부서, 사용자, 권한, 거래처, 예산, 미결 결제 요청, 지급 이력별 source owner를 기록 |
| freeze window | 원천 시스템 변경 금지 시작/종료 시각과 예외 승인자를 기록 |
| 컬럼 매핑 | 원천 컬럼, ERP 컬럼, 변환 규칙, 누락 허용 여부, 검증 쿼리를 표로 관리 |
| 승인 흐름 | 업무 책임자, 보안 책임자, 재무 책임자, 운영 책임자의 승인 기록 필요 |
| rollback 조건 | critical 정합성 실패, 총액 불일치, 권한 누락, test marker 발견 시 cutover 중단 |

검증 명령:

```powershell
npm run release:data-migration-evidence
```

## 자동 점검 API

`GET /api/operations/data-quality`는 `system:manage` 권한으로 실행한다.

점검 범위:

- 활성 사용자 권한 누락, 비활성 부서 소속, 권한 없는 활성 role
- 활성 거래처의 암호화 계좌, 마스킹 계좌, 은행명, 예금주, 세금계산서 이메일 누락
- 중복 활성 거래처명, 미검증 거래처
- 예산/세부 예산 over allocation, 미결 요청의 비활성 참조
- 제출/승인/지급 상태와 결재 단계 불일치
- 결제 요청/거래처 첨부파일 orphan, 제출 요청의 정상 첨부 누락
- test email, local seed marker, sample/mock/demo 문자열 존재 여부

critical 실패가 있으면 HTTP 409와 `data.ok=false`를 반환한다. warning 실패는 go-live 승인자가 risk acceptance를 남기기 전까지 해소하는 것을 원칙으로 한다.

## 대사 기준

이관 직후 아래 집계를 원천 시스템과 비교한다.

- 부서, 활성 사용자, 활성 권한 그룹, 활성 거래처 건수
- 결제 요청 상태별 건수와 금액 합계
- 지급 상태별 건수와 금액 합계
- 예산 배정액, 사용액, 잔액 합계
- 결재 단계 건수와 pending step 소유자
- 첨부파일 총건수, orphan 건수, blocked/pending 건수

계좌번호 원문은 API 응답과 승인 증적에 남기지 않는다. 계좌 검증은 암호화 prefix와 마스킹 값 존재 여부로 확인하고, 필요한 경우 제한된 운영자만 별도 보안 절차로 원천 대사를 수행한다.
