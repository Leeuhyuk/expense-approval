/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ERP_API_MODE?: "mock" | "remote";
  readonly VITE_ERP_API_BASE_URL?: string;
  readonly VITE_RELEASE_VERSION?: string;
  readonly VITE_RELEASE_SOURCE_REF?: string;
  readonly VITE_RELEASE_GIT_COMMIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
