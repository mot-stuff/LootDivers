import { ApiClient, type ApiSession } from "./api-client";

/**
 * Boot-time session probe (TASK-707).
 *
 * Authenticated play is supported on the custom-domain origin only (Phase 8
 * kickoff §1.3): `<domain>` and `api.<domain>` are same-site there, so the
 * HttpOnly session cookie flows with SameSite=Lax. On localhost, LAN IPs,
 * and `*.pages.dev` the probe is skipped entirely — those origins stay
 * local-save-only, which also keeps every e2e/automation path off the
 * network.
 */

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * True for loopback/LAN development hostnames that no real player can
 * reach. TASK-714 (DEC-040) keeps the local main menu only on these
 * origins as the dev door; every player-reachable origin (custom domain,
 * `*.pages.dev`, any public host) requires a signed-in account at /play/.
 */
export function isLocalDevHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOCAL_HOSTNAMES.has(host) || IPV4_PATTERN.test(host);
}

/**
 * Maps a page hostname to its API origin, or null when the origin has no
 * API (local development, IP addresses, Cloudflare Pages preview domain).
 * `www.` is stripped so both site hosts reach the same `api.` sibling.
 */
export function deriveApiOrigin(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (LOCAL_HOSTNAMES.has(host) || IPV4_PATTERN.test(host)) {
    return null;
  }
  if (host.endsWith(".pages.dev")) {
    return null;
  }
  if (!host.includes(".")) {
    return null;
  }
  const apex = host.startsWith("www.") ? host.slice(4) : host;
  if (apex.startsWith("api.")) {
    // Already on the API host (manual navigation); no page runs there.
    return null;
  }
  return `https://api.${apex}`;
}

export interface AuthSessionState {
  /** False until the probe settles (or is skipped). */
  readonly settled: boolean;
  /** Null when signed out, probe skipped, or the API is unreachable. */
  readonly session: ApiSession | null;
  /** Null on local-only origins where no probe runs. */
  readonly apiOrigin: string | null;
}

let state: AuthSessionState = {
  settled: false,
  session: null,
  apiOrigin: null,
};

/** Read model for the shell/menu (TASK-709 consumes this). */
export function authSessionState(): AuthSessionState {
  return state;
}

/**
 * Fires the boot probe. Non-blocking and failure-silent by design: a down
 * or unimplemented API must never break boot (local play works regardless).
 * Returns the settled state for callers that want to await it.
 */
export async function probeAuthSession(
  hostname: string = window.location.hostname,
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<AuthSessionState> {
  const apiOrigin = deriveApiOrigin(hostname);
  if (apiOrigin === null) {
    state = { settled: true, session: null, apiOrigin: null };
    return state;
  }
  try {
    const client = new ApiClient(apiOrigin, fetchImpl);
    const session = await client.session();
    state = { settled: true, session, apiOrigin };
  } catch {
    // Unreachable API (or 5xx): treat as signed out.
    state = { settled: true, session: null, apiOrigin };
  }
  return state;
}
