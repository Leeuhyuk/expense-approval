import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const apiProxy = {
    "/api": {
        target: process.env.VITE_DEV_API_PROXY_TARGET || "http://127.0.0.1:4000",
        changeOrigin: true,
    },
};
export default defineConfig({
    plugins: [react()],
    preview: {
        host: "127.0.0.1",
        port: 4173,
        strictPort: true,
        proxy: apiProxy,
    },
    server: {
        host: "127.0.0.1",
        port: 3000,
        strictPort: true,
        proxy: apiProxy,

        watch: {
            ignored: ["**/generated-images/**", "**/dist/**"],
        },
    },
});
