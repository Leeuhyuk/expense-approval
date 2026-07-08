# File Handling Rules

작성일: 2026-07-05

이 문서는 첨부파일과 문서 처리의 1차 기준이다.

## 바이러스 검사

- 모든 허용 확장자 업로드 파일은 바이러스 검사 대상으로 본다.
- 허용 확장자는 PDF, JPG/JPEG, PNG, XLSX이며 backend는 확장자와 `Content-Type`이 일치하지 않는 업로드를 거부한다.
- 파일 크기는 10MB를 초과할 수 없고, presign 단계와 실제 signed upload 단계에서 모두 검증한다.
- 백엔드는 signed upload 본문 저장 전에 malware scan을 수행한다.
- 검사 결과가 blocked이면 object storage에 파일 본문을 쓰지 않고 `Attachment.checksum`을 `blocked:*` 값으로 남겨 quarantine 상태로 분류한다.
- 검사 상태는 `pending`, `clean`, `blocked`로 관리한다.
- 검사 완료 전 파일은 다운로드와 승인 제출 증빙 확정 대상에서 제외한다.
- blocked 파일은 완료 처리, 다운로드, 승인 제출 증빙 확정 대상에서 제외하고 `security_events`와 감사 로그에 남긴다.

## PDF 미리보기

- PDF, JPG, JPEG, PNG 파일은 미리보기 대상이다.
- XLSX는 1차 범위에서 미리보기 대상이 아니며 다운로드로 처리한다.
- PDF/이미지 미리보기 URL은 파일 다운로드와 동일하게 권한 검증 후 inline signed URL로 제공하며, `download_request` 접근 로그에 `disposition=inline`과 만료 시각을 기록한다.
- 승인 완료 이후에도 권한이 있는 사용자는 미리보기만 가능하고 파일 교체는 차단한다.

## Storage 접근 제어

- Object storage bucket은 public access block 또는 private bucket 정책이 적용된 상태여야 한다.
- Object storage bucket은 server-side encryption 또는 동등한 at-rest encryption이 켜져 있어야 한다.
- Object storage endpoint와 malware scanner endpoint는 staging/production에서 HTTPS만 허용한다.
- Backend는 object storage 직접 URL이나 provider presigned URL을 브라우저에 반환하지 않고 `/api/files/{id}/content?token=...` 형식의 API signed path만 반환한다.
- Signed path는 파일 ID, 목적(`upload`/`download`), 만료 시각을 HMAC으로 묶고 10분 후 만료된다.
- Upload signed path와 download signed path는 서로 호환되지 않는다.
- Upload URL 발급은 소유 업무 대상 확인과 파일별 write 권한 검증을 통과해야 한다.
- Download URL 발급은 로그인 사용자와 파일 owner/requester/approver/vendor 권한을 다시 검증해야 한다.
- Download URL 발급은 업무 사유를 필수로 받고, `AuditLog`에 `download_request` 접근 로그로 남겨야 한다.
- 접근 로그에는 파일명, owner, 크기, signed URL 만료 시각, 첨부 metadata 보관 정책, 감사 로그 보관 기준을 저장하고 signed URL token 원문은 저장하지 않는다.
- Token이 없거나 만료되었거나 목적이 다른 `/api/files/{id}/content` 직접 접근은 `file_signed_url_rejected` 보안 이벤트로 남긴다.
- Production release 환경에는 `S3_PUBLIC_BASE_URL`, `S3_PUBLIC_URL`, `FILE_STORAGE_PUBLIC_BASE_URL`, `FILE_STORAGE_PUBLIC_URL` 같은 공개 object URL 설정을 두지 않는다.
- Production release 환경에는 `S3_SERVER_SIDE_ENCRYPTION_ENABLED=true` 또는 `FILE_STORAGE_ENCRYPTION_AT_REST=true` 증적을 둔다.

## 업로드 UX와 복구

- 결제 요청 증빙과 거래처 증빙 업로드는 진행률을 표시해야 한다.
- 업로드 실패 row는 삭제하거나 같은 브라우저 세션의 원본 파일로 재시도할 수 있어야 한다.
- 화면 이탈 또는 새로고침으로 업로드가 중단된 경우에는 recovery metadata를 보여주고, 원본 파일 재선택 또는 삭제로 정리한다.
- 같은 선택 묶음에 중복 파일명이 있으면 저장소 ID로 구분되며 화면에는 중복 파일명 안내를 표시한다.
- 대용량 파일은 10MB 정책으로 제한하고, presign 단계와 실제 upload 단계 양쪽에서 차단한다.

## 세금계산서 파일

- 파일명이 `세금계산서`, `tax-invoice`, `invoice`를 포함하면 세금계산서 파일로 분류한다.
- 세금계산서 파일은 거래처, 요청번호, 발행일, 공급가액, 부가세, 파일 ID를 함께 저장해야 한다.
- 세금계산서 보관 기준은 5년이다.
- 지급 완료 후 세금계산서 파일 삭제는 관리자 수동 복구 절차를 통해서만 허용한다.
