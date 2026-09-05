/// <reference types="vite/client" />

// Typed environment variables for this app.
//
// Vite exposes any `VITE_*` variable in frontend/.env as import.meta.env.VITE_*.
// Without this declaration, TypeScript treats those as `any` (vite/client's
// loose index signature). Declaring them here makes typos type errors.
// Add a new entry whenever you introduce a new VITE_* variable.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}