# Verification Matrix

작성일: 2026-07-05

## 자동화 검증

| 항목 | 검증 방식 | 산출물 |
| --- | --- | --- |
| 화면별 기능 테스트 | E2E 스모크가 주요 화면의 생성, 수정, 저장, 다운로드, 설정, 즐겨찾기 흐름을 클릭한다. | `tests/e2e/ui-smoke.test.mjs` |
| 1920 x 1080 시각 회귀 | 9개 ERP 라우트를 1920 x 1080에서 로드하고 스크린샷을 저장한다. | `ui-viewport-1920.png` |
| 1280 해상도 | 대시보드, 결제 요청, 보고서를 1280 x 800에서 로드한다. | `ui-viewport-1280.png` |
| 모바일 최소 대응 | 대시보드와 즐겨찾기를 390 x 844에서 로드한다. | `ui-viewport-mobile.png` |
| 긴 데이터 입력 | 결제 요청 사유에 긴 문자열을 입력하고 값 보존과 포커스 이동을 확인한다. | `ui-smoke-long-input.png` |
| 대량 테이블 데이터 | 1,000건과 10,000건 fixture를 생성해 금액 정렬을 수행한다. | `tests/unit/verificationCriteria.test.ts` |
| 키보드 이동 및 포커스 | 긴 입력 E2E에서 `Tab` 이동 후 포커스 가능한 요소를 확인한다. | E2E assertion |
| 색 대비 기본 검증 | 주요 텍스트와 액션 색상 대비를 계산한다. | unit assertion |

## 실행 명령

```powershell
npm test
npm run build
npm --prefix backend run build
```

## 수동 보완 기준

- 실제 운영 배포 전에는 staging에서 remote API mode로 동일 E2E를 한 번 더 수행한다.
- 모바일은 1차 대응 범위이며, 반복 업무는 데스크톱 기준으로 최적화한다.
- 성능 테스트는 정렬/필터 기준의 프론트 fixture 검증이며, DB 쿼리 성능은 백엔드 통합 테스트에서 별도 측정한다.
