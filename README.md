# 경비 보고서 결재 시스템 (Expense Approval)

사내 경비 보고서 결재 승인 시스템. 결재자(팀장 등)가 직원이 상신한 출장 경비 정산을 검토하고 **승인 / 반려 / 보류**합니다.

- **스택**: Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Firebase(Firestore + Auth)
- **호스팅**: GitHub → Firebase App Hosting 자동 배포
- **Firebase 프로젝트**: `company-payment-system` (기존 서비스와 완전 분리된 전용 프로젝트)

4개 레이아웃을 같은 Firestore 데이터로 구현: **A 정통 결재함 · B 워크플로우 · C 원장형 · 모바일**.

## 실행

```bash
npm install
npm run dev          # http://localhost:3000
```

| 경로 | 설명 |
|---|---|
| `/login` | 로그인 (이메일/비밀번호) |
| `/` | 레이아웃 선택 (로그인 필요) |
| `/a` `/b` `/c` `/m` | A / B / C / 모바일 화면 |

### 테스트 계정 (`npm run setup-users`로 생성)

| 이름 | 이메일 | 비밀번호 | 역할 |
|---|---|---|---|
| 이서연 (현재 결재자) | `lee.seoyeon@company.test` | `Approval123!` | approver |
| 김민준 (작성자) | `kim.minjun@company.test` | `Approval123!` | employee |

## 스크립트

```bash
npm run seed         # README 샘플 보고서를 Firestore에 입력
npm run setup-users  # 테스트 계정 생성 + 역할(Custom Claims) + 결재자 연결
npm run build        # 프로덕션 빌드 + 타입체크
```

## 환경 변수

`.env.example`를 `.env.local`로 복사해 채웁니다.
- `NEXT_PUBLIC_FB_*` — 클라이언트 config (공개값)
- `FB_ADMIN_*` — 서버 Admin SDK (콘솔 > 프로젝트 설정 > 서비스 계정 > 새 비공개 키)

## 인증/권한 구조

- 클라이언트가 Firebase Auth로 로그인 → ID 토큰을 `/api/session`에서 **세션 쿠키**(`__session`, httpOnly)로 교환
- 서버(`lib/auth.ts`)가 쿠키를 검증해 사용자/역할 확인, 미인증 시 `/login`으로 리다이렉트
- 결재 처리(`app/actions.ts`)는 **현재 단계 지정 결재자 본인**만 가능, Firestore **트랜잭션**으로 결재선 전진
- **모든 쓰기는 서버(Admin SDK)만** — `firestore.rules`가 클라이언트 직접 쓰기를 차단, 읽기는 로그인 필수

## 구조

```
src/
  app/
    page.tsx                레이아웃 선택 홈 (인증 필요)
    a|b|c|m/page.tsx        각 화면 라우트
    login/page.tsx          로그인
    api/session/route.ts    세션 쿠키 발급/삭제
    actions.ts              결재 처리 Server Action (Firestore 트랜잭션)
  components/
    screens/                ClassicView·PipelineView·LedgerView·MobileView
    primitives.tsx          공용 UI 조각
    ApprovalActions.tsx     승인/반려 + 결과 배너 (client)
    ScreenFrame.tsx         상단 셸(브레드크럼/사용자/로그아웃)
    LogoutButton.tsx
  lib/
    types.ts                도메인 모델
    data.ts                 getReport() — Firestore 조회
    auth.ts                 세션 검증
    firebase.ts             클라이언트 SDK
    firebaseAdmin.ts        서버 Admin SDK
    sample-data.ts          시드 데이터 / format.ts
scripts/                    seed.ts · setup-users.ts
firestore.rules             보안 규칙
firebase.json / .firebaserc / apphosting.yaml   배포 설정
```

## 배포 (Vercel)

호스팅은 **Vercel**, 데이터/인증은 Firebase(company-payment-system, 무료 Spark 플랜)를 그대로 사용합니다.

1. **GitHub 저장소** — 이미 푸시됨: `Leeuhyuk/expense-approval` (`main`)
2. **Firestore 보안 규칙** — 이미 배포됨. 변경 시:
   ```bash
   firebase deploy --only firestore:rules
   ```
3. **Vercel 프로젝트 생성** — [vercel.com](https://vercel.com) → Add New → Project → GitHub 저장소 `Leeuhyuk/expense-approval` import (Next.js 자동 감지).
4. **환경 변수 등록** (Vercel → Settings → Environment Variables) — `.env.local`의 모든 값:
   - `NEXT_PUBLIC_FB_*` 7개 (공개값)
   - `FB_ADMIN_PROJECT_ID` / `FB_ADMIN_CLIENT_EMAIL` / `FB_ADMIN_PRIVATE_KEY`
     (PRIVATE_KEY는 `.env.local`의 `\n` 포함 한 줄 값 그대로 — 코드가 `\n`을 복원함)
5. **Deploy** → 배포 URL(`*.vercel.app`) 생성. 이후 push마다 자동 배포.
6. **인증 도메인 추가** — Firebase 콘솔 → Authentication → Settings → 승인된 도메인에 Vercel 배포 URL 추가 (안 하면 배포본 로그인 차단).

> Firebase App Hosting을 쓰려면 Blaze(종량제) 플랜이 필요합니다. `apphosting.yaml`은 그 경우를 위한 참고 설정으로 남겨두었습니다.
