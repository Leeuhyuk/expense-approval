# 로컬 호스팅 운영

## 시작

프로젝트 루트에서 다음 명령 하나를 실행한다.

```powershell
npm run local
```

첫 실행은 프로젝트 내장 PostgreSQL 초기화, Prisma 마이그레이션, 기본 데이터 생성 때문에 시간이 더 걸린다. 준비가 끝나면 브라우저에서 `http://127.0.0.1:3000`을 연다.

- 관리자 이메일: `kim.minsu@example.local`
- 최초 비밀번호: `password`
- 사용자 화면 포트: `3000` 고정
- 내부 백엔드 포트: `4310`
- 내부 PostgreSQL 포트: `55432`

## 데이터 보관

- PostgreSQL 데이터: Windows `%LOCALAPPDATA%\expense-approval-erp\postgres`, 그 외 OS `.local-data/postgres`
- 업로드 파일: `.local-data/files`
- 실행 상태: `.local-data/runtime.json`

`npm run local`을 종료하거나 PC를 재시작해도 DB와 업로드 파일은 유지된다. Git에는 `.local-data`가 포함되지 않는다.

## 상태와 종료

```powershell
npm run local:status
npm run local:stop
```

포트가 이미 사용 중이면 실행기는 기존 서비스를 임의로 종료하지 않고 충돌 포트를 안내한다. 기존 로컬 ERP가 실행 중이면 `npm run local:status`로 확인한 뒤 `npm run local:stop`으로 종료한다.

## Windows 자동 시작과 장애 복구

현재 사용자 로그인 시 로컬 ERP를 숨김 프로세스로 자동 시작하려면 한 번만 등록한다.

```powershell
npm run local:autostart:install
npm run local:autostart:status
```

등록은 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`의 `ExpenseApprovalERP` 값에 저장되며 관리자 권한이 필요하지 않다. 로그인 직후 supervisor가 내장 PostgreSQL, backend, frontend를 순서대로 시작하고 화면 포트는 항상 `3000`을 사용한다. 지금 즉시 같은 백그라운드 경로로 시작할 때는 다음 명령을 사용한다.

```powershell
npm run local:autostart:start
```

예기치 않은 종료는 2초부터 최대 30초의 backoff로 복구한다. 5분 안에 5회 실패하면 포트 충돌이나 데이터 손상을 반복하지 않도록 중단한다. `npm run local:stop`으로 정상 종료하면 supervisor도 종료하고 임의로 다시 시작하지 않는다.

- supervisor lock: `127.0.0.1:4308`
- supervisor 상태: `.local-data/supervisor.json`
- supervisor 이벤트: `.local-data/local-supervisor.log`
- 백그라운드 서비스 로그: `.local-data/local-server-supervised.log`

자동 시작을 해제할 때만 다음 명령을 사용한다. 실행 중인 ERP 데이터와 백업은 삭제하지 않는다.

```powershell
npm run local:autostart:remove
```

## 최초 실행 처리 순서

1. 내장 PostgreSQL 클러스터를 초기화하고 시작한다.
2. 업무 데이터베이스를 생성한다.
3. Prisma 클라이언트를 생성하고 모든 마이그레이션을 적용한다.
4. 새 DB에만 기본 사용자와 업무 데이터를 생성한다.
5. 백엔드 DB 상태를 확인한 뒤 프런트엔드를 `3000`번으로 시작한다.

기본 데이터를 다시 적용해야 할 때만 현재 셸에 `ERP_LOCAL_RESEED=true`를 설정하고 `npm run local`을 실행한다. 기존 사용자가 등록한 데이터는 삭제하지 않는다.

## 격리된 로컬 staging

live를 중단하지 않고 production build artifact와 migration을 별도 데이터에서 점검할 수 있다.

| 구분 | live | staging-local |
| --- | --- | --- |
| 화면 | `http://127.0.0.1:3000` | `http://127.0.0.1:3100` |
| backend | `4310` | `4410` |
| PostgreSQL | `55432`, `%LOCALAPPDATA%\expense-approval-erp\postgres` | `55442`, `%LOCALAPPDATA%\expense-approval-erp-staging\postgres` |
| 파일 | `.local-data/files` | `%LOCALAPPDATA%\expense-approval-erp-staging\files` |
| runtime/evidence | `.local-data/runtime.json` | `.local-data/staging/runtime.json`, `.local-data/staging/smoke-evidence.json` |
| frontend/backend | source 개발 서버 | 검증된 `dist`, `backend/dist` build artifact |

변경을 모두 커밋해 Git 작업 트리가 clean인 상태에서 현재 commit으로 artifact와 release manifest를 고정한 뒤 staging을 시작한다.

```powershell
npm run local:staging:prepare
npm run local:staging
```

다른 터미널에서 상태와 smoke를 확인하고 필요할 때 staging만 종료한다.

```powershell
npm run local:staging:status
npm run local:staging:smoke
npm run local:staging:stop
```

`prepare`는 frontend/backend production build, release manifest 생성과 checksum 검증을 수행한다. `start`와 `smoke`는 build identity와 현재 manifest가 다르면 실행을 거부한다. Smoke는 profile, artifact mode, DB/파일/포트 격리, frontend, API/DB/storage/file-security health, release identity, 로그인과 인증 조회를 검사하고 JSON 증적을 저장한다.

staging 전용 cold backup도 live와 분리된다.

```powershell
npm run local:staging:backup
npm run local:staging:backups
npm run local:staging:restore -- <백업-ID>
```

이 프로필은 동일 PC에서 환경 혼입과 artifact/migration 회귀를 막기 위한 production-like 로컬 리허설이다. HTTPS 도메인, 외부 object storage, 별도 auth/secret manager, 중앙 로그가 있는 실제 외부 staging 증적을 대신하지 않는다.

## 백업과 복구

DB와 업로드 파일은 반드시 같은 시점의 묶음으로 보관한다. 물리 백업의 일관성을 위해 먼저 로컬 시스템을 종료한 뒤 백업한다.

```powershell
npm run local:stop
npm run local:backup
npm run local:backups
```

백업은 Windows `%LOCALAPPDATA%\expense-approval-erp\backups`, 그 외 OS `.local-data/backups`에 생성된다. 각 백업에는 PostgreSQL 클러스터, 업로드/보고서 파일, 앱 버전과 Git commit, 파일별 SHA-256 manifest가 포함된다. 목록 명령은 매번 manifest와 실제 파일을 대사해 `OK` 또는 `INVALID`로 표시한다.

복구할 백업 ID를 목록에서 확인한 뒤 다음 순서로 실행한다.

```powershell
npm run local:stop
npm run local:restore -- <백업-ID>
npm run local
```

복구는 백업 전체와 복구용 임시 복사본의 checksum을 먼저 검증한다. 이후 DB와 파일 저장소를 함께 교체하며, 교체 중 오류가 나면 기존 디렉터리를 원래 위치로 되돌린다. 실행 중인 로컬 시스템이나 `postmaster.pid`가 포함된 백업은 생성·복구를 거부한다.

이 기능은 단일 PC 로컬 호스팅용 cold physical backup이다. 운영 배포의 WAL/PITR, 별도 장비 보관, 암호화 키와 접근 권한, 보존 주기, 장애 알림을 대신하지 않는다.

## 로컬 검증

2026-07-11 기준으로 다음 검증을 완료했다.

- `npm run build`: TypeScript 검사와 Vite production build 통과
- `npm run test:unit`: 436건 통과, 실패/skip 없음
- 별도 `payment_approval_erp_test` DB에 마이그레이션 11개 적용
- DB integration 6건 통과: CRUD/새로고침/재로그인, 권한·설정, 파일, 결재, 지급, 목록 query/DB 일치
- remote browser E2E 4건 통과: 로그인/로그아웃, 거래처·증빙, 즐겨찾기·보고서·설정, 결재 인계·지급 보류
- `npm run release:db-test-evidence`: 하네스 8개 checksum과 실행 결과 strict 검증 통과

원격 모드의 파일 PUT/PATCH/DELETE CORS, 본문 없는 로그아웃, 내부 action adapter의 `Content-Length`, 동명이인 사용자 권한 ID 식별도 회귀 테스트에 포함한다.
