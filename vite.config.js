import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ERP_PREVIEW_API_ORIGIN이 설정되면 `vite preview`가 /api를 해당 백엔드로 프록시한다.
// production 형상(자기 origin /api) 아티팩트를 로컬 staging에서 그대로 서빙하기 위한 용도.
const previewApiOrigin = process.env.ERP_PREVIEW_API_ORIGIN;

export default defineConfig({
    plugins: [react()],
    server: {
        watch: {
            ignored: ["**/generated-images/**", "**/dist/**"],
        },
    },
    preview: previewApiOrigin
        ? {
            proxy: {
                "/api": {
                    target: previewApiOrigin,
                    changeOrigin: false,
                },
            },
        }
        : undefined,
});
