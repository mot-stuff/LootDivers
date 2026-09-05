/**
 * Environment-derived server configuration (TASK-707).
 *
 * Everything domain-shaped is parameterized on APP_DOMAIN because the real
 * domain string is still unknown (Phase 8 kickoff §7.1): CORS allow-list and
 * cookie security derive from it. Development (no NODE_ENV=production) runs
 * with localhost CORS and non-Secure cookies so the Vite dev server can talk
 * to a local API over plain HTTP.
 */
export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly databaseUrl: string;
  /** Apex domain, e.g. "example.com" — null in development when unset. */
  readonly appDomain: string | null;
  readonly production: boolean;
  readonly cookieSecure: boolean;
  readonly corsOrigins: readonly string[];
  readonly sessionTtlMs: number;
}

const DEVELOPMENT_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
] as const;

export const SESSION_TTL_DAYS = 30;

export function loadConfig(
  env: Record<string, string | undefined>,
): ServerConfig {
  const production = env.NODE_ENV === "production";
  const appDomain = env.APP_DOMAIN?.trim() || null;

  if (production && appDomain === null) {
    throw new Error(
      "APP_DOMAIN is required in production (CORS allow-list and cookie scope derive from it).",
    );
  }

  const databaseUrl = env.DATABASE_URL?.trim() || null;
  if (databaseUrl === null) {
    throw new Error("DATABASE_URL is required.");
  }

  const port = Number.parseInt(env.PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a valid TCP port, got "${env.PORT ?? ""}".`);
  }

  const corsOrigins: string[] = [];
  if (appDomain !== null) {
    corsOrigins.push(`https://${appDomain}`, `https://www.${appDomain}`);
  }
  if (!production) {
    corsOrigins.push(...DEVELOPMENT_ORIGINS);
  }

  return {
    port,
    host: env.HOST ?? "0.0.0.0",
    databaseUrl,
    appDomain,
    production,
    cookieSecure: production,
    corsOrigins,
    sessionTtlMs: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}
