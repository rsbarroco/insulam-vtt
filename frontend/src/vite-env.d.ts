/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SOURCE_CODE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
