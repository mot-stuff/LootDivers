/**
 * Account API base resolution shared by the homepage and the admin panel
 * (TASK-708/716/721). The v1 contract puts the API at `api.<domain>` of the
 * custom-domain origin; on localhost and *.pages.dev there is no account
 * API — the same-origin "/api" base fails soft and gives Playwright a
 * stable path to mock.
 */
export function apiBaseForHost(hostname: string): string {
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".pages.dev")
  ) {
    return "/api";
  }
  return `https://api.${hostname.replace(/^www\./, "")}`;
}
