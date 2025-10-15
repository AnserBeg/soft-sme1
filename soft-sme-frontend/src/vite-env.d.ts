/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_CLOUDFLARE_URL: string
  readonly NODE_ENV: string
  readonly MODE: string
  readonly VITE_AI_ENABLE_AGGREGATOR_STREAMING?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}