# Data Retention And Immutability Policy

작성일: 2026-07-07

## 기준

업무 증빙성 데이터는 화면 삭제와 물리 삭제를 구분한다. 감사 로그, 첨부 metadata, 보고서 실행 기록은 운영 화면에서 숨기거나 `EXPIRED` 상태로 전환할 수 있어도 DB row를 직접 삭제하지 않는다. 만료 알림처럼 업무 원장이 아닌 사용자 알림만 정기 정리 대상이다.

## 정책 표

| 대상 | 기준 필드 | 보관 기간 | 불변성 | 삭제 정책 | 운영 조치 |
| --- | --- | ---: | --- | --- | --- |
| 감사 로그 | `createdAt` | 2555일 | append-only | 물리 삭제 금지 | 보관 만료 대상은 외부 WORM 또는 감사 저장소 이관 후 승인 증적을 보관한다. |
| 알림 | `expiresAt` | 90일 | 읽음 상태 변경 가능 | 만료 후 정리 가능 | 만료 알림은 목록에서 제외하고 정기 cleanup으로 삭제한다. |
| 첨부 파일 metadata | `createdAt` | 2555일 | 핵심 필드 불변 | 제출 이후 물리 삭제 금지 | 초안 삭제 또는 관리자 복구 예외는 감사 로그 사유를 남긴다. |
| 보고서 산출물 | `createdAt` | 1095일 | 실행 snapshot 불변 | `EXPIRED` 상태 전환 | 사용자 삭제는 물리 삭제가 아니라 상태 전환으로 처리한다. |

## 구현 위치

- 정책 정의: `backend/src/domain/retentionPolicy.ts`
- 운영 조회 API: `GET /api/operations/retention-policy`
- 화면 연결: 시스템 설정 > 보관 정책 탭
- 첨부 삭제 예외 감사: `DELETE /api/files/{id}`의 `attachment` 감사 로그

## Go-live 확인

Production 전에는 오래된 알림 cleanup, 감사 로그 archive, 첨부 metadata 보관 대사, 보고서 `EXPIRED` 전환을 staging 데이터로 리허설하고 결과를 release evidence에 보관한다. 실제 cleanup/archive 실행은 backup/PITR와 승인 번호가 준비된 뒤 진행한다.
