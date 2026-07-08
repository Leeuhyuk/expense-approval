# Release Note Template

작성일: 2026-07-08

이 템플릿은 release마다 복사해서 확정 값으로 채운 뒤 `RELEASE_NOTE_PATH`에 지정한다. Production release gate는 기능 변경, DB 변경, 권한 변경, 운영 영향, known issue, rollback 조건이 빠진 release note를 통과시키지 않는다.

## Release Identity

| 항목 | 값 |
| --- | --- |
| Release version | TBD |
| Source ref | TBD |
| Git commit | TBD |
| Release manifest hash | TBD |
| Migration review hash | TBD |
| 작성자 | TBD |
| 승인자 | TBD |

## 기능 변경

| 화면/영역 | 변경 내용 | 사용자 영향 | 증빙 |
| --- | --- | --- | --- |
| TBD | TBD | TBD | TBD |

## DB 변경

| Migration | 변경 요약 | 하위 호환성 | rollback 영향 |
| --- | --- | --- | --- |
| TBD | TBD | TBD | TBD |

## 권한 변경

| 역할/권한 | 변경 내용 | 승인 증빙 | 사용자 안내 |
| --- | --- | --- | --- |
| TBD | TBD | TBD | TBD |

## 운영 영향

| 항목 | 영향 | 운영 조치 | 모니터링 |
| --- | --- | --- | --- |
| 배포 | TBD | TBD | TBD |
| 성능/용량 | TBD | TBD | TBD |
| 파일/object storage | TBD | TBD | TBD |
| 외부 연동 | TBD | TBD | TBD |

## Known Issue

| 이슈 | 심각도 | 우회 절차 | 담당자 | 목표 기한 |
| --- | --- | --- | --- | --- |
| 없음 또는 TBD | TBD | TBD | TBD | TBD |

## Rollback 조건

| Trigger | 판단 기준 | 담당자 | 실행 절차 | 예상 소요 시간 |
| --- | --- | --- | --- | --- |
| TBD | TBD | TBD | 직전 release manifest artifact로 rollback | TBD |

## 승인

| 역할 | 승인자 | 승인 시각 | 증빙 링크 |
| --- | --- | --- | --- |
| 기능 책임자 | TBD | TBD | TBD |
| 보안 책임자 | TBD | TBD | TBD |
| 재무 책임자 | TBD | TBD | TBD |
| 운영 책임자 | TBD | TBD | TBD |