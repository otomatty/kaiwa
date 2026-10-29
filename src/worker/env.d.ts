// Bindings that are not declared in wrangler.jsonc, so `wrangler types` does not generate them.
interface Env {
  /** E2E builds only: base URL of a local stand-in for Google's OAuth endpoints (see vite.config.ts). */
  GOOGLE_OAUTH_URL?: string;
}
