# Frontend Hosting Policy

작성일: 2026-07-08

이 문서는 Vite 정적 산출물(`dist`)을 staging/production에 배포할 때 필요한 HTTPS, cache-control, versioned artifact, rollback 기준이다. 실제 hosting platform 값은 `PRODUCTION_ENVIRONMENT_INVENTORY_PATH`에 확정하고, 산출물 자체에는 `public/_headers`가 복사되어 기본 보안 헤더와 cache policy가 포함되어야 한다.

## Required Hosting Controls

| 항목 | 기준 |
| --- | --- |
| HTTPS | production frontend domain은 HTTPS만 허용하고 HTTP는 HTTPS로 redirect한다. |
| HSTS | `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`를 적용한다. |
| HTML cache | `/index.html`은 `Cache-Control: no-store, max-age=0`으로 즉시 갱신 가능해야 한다. |
| Hashed assets | `/assets/*`, `/*.js`, `/*.css`는 `Cache-Control: public, max-age=31536000, immutable`로 고정한다. |
| Source map | production source map을 배포하는 경우 공개 접근을 제한하거나 `no-store`로 둔다. |
| Security headers | `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`를 적용한다. |
| Release identity | frontend build env의 `VITE_RELEASE_VERSION`, `VITE_RELEASE_SOURCE_REF`, `VITE_RELEASE_GIT_COMMIT`을 backend `/api/health/version`과 대사한다. |
| Versioned artifact | `release/release-manifest.json`의 `manifestSha256`과 frontend artifact section checksum을 release evidence로 보관한다. |
| Rollback | 직전 release manifest와 정적 산출물을 보관하고, rollback 시 해당 artifact를 재승격한다. |

## Artifact Gate

`npm run build` 이후 `npm run release:frontend-artifact`는 `dist` 안에 mock fixture, local endpoint, dev secret이 없는지 검사하고, `_headers`가 cache-control/보안 헤더 기준을 포함하는지 확인한다.

## Production Evidence

Production 후보 전에는 다음 증빙이 필요하다.

| 증빙 | 위치 |
| --- | --- |
| Hosting platform, CDN, HTTPS redirect | `docs/production-environment-inventory-template.md` 복사본 |
| Cache headers 적용 결과 | `PRODUCTION_ENVIRONMENT_INVENTORY_PATH`의 Frontend hosting evidence |
| 동일 artifact staging smoke | `STAGING_SMOKE_EVIDENCE_PATH` |
| Production frontend smoke | `PRODUCTION_GO_LIVE_EVIDENCE_PATH` |
| Rollback artifact와 담당자 | `GO_LIVE_HANDOFF_PATH`와 `PRODUCTION_GO_LIVE_EVIDENCE_PATH` |