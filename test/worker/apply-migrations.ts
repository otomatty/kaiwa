import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Setup files run outside isolated storage and may run multiple times;
// applyD1Migrations only applies migrations that have not been applied yet.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
