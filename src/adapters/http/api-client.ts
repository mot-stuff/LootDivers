/**
 * Typed client for the TASK-707 accounts API (Phase 8 kickoff §2 contract).
 *
 * Thin by design: fetch with credentials, JSON in/out, and contract error
 * mapping. The character-select and login UI that consumes it is TASK-709;
 * the save-path consumer is `HttpSaveRepository`.
 */

export interface ApiSession {
  readonly userId: string;
  readonly email: string;
}

export interface ApiCharacterSummary {
  readonly id: string;
  readonly name: string;
  readonly class: string;
  readonly level: number;
  readonly updatedAt: string;
}

export interface ApiCharacterDetail {
  readonly id: string;
  readonly name: string;
  readonly class: string;
  readonly level: number;
  /** The verbatim DEC-014 envelope; null when the character has never saved. */
  readonly envelope: unknown;
}

/** Contract error shape: `{ error: { code, message } }` with a 4xx/5xx status. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

async function toApiError(response: Response): Promise<ApiError> {
  let code = "unknown";
  let message = `HTTP ${String(response.status)}`;
  try {
    const body = (await response.json()) as {
      error?: { code?: unknown; message?: unknown };
    };
    if (typeof body.error?.code === "string") {
      code = body.error.code;
    }
    if (typeof body.error?.message === "string") {
      message = body.error.message;
    }
  } catch {
    // Non-JSON error body (proxy page, network hiccup): keep the fallback.
  }
  return new ApiError(response.status, code, message);
}

export class ApiClient {
  readonly #origin: string;
  readonly #fetch: FetchLike;

  /**
   * @param origin API origin with scheme, no trailing slash, e.g.
   *   `https://api.example.com` or `http://localhost:3000`.
   */
  public constructor(origin: string, fetchImpl?: FetchLike) {
    this.#origin = origin.replace(/\/$/, "");
    this.#fetch = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  async #request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const init: RequestInit = {
      method,
      credentials: "include",
    };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const response = await this.#fetch(`${this.#origin}${path}`, init);
    if (!response.ok) {
      throw await toApiError(response);
    }
    if (response.status === 204) {
      return { status: response.status, body: undefined as T };
    }
    return { status: response.status, body: (await response.json()) as T };
  }

  public async signup(email: string, password: string): Promise<string> {
    const result = await this.#request<{ userId: string }>(
      "POST",
      "/auth/signup",
      { email, password },
    );
    return result.body.userId;
  }

  public async login(email: string, password: string): Promise<string> {
    const result = await this.#request<{ userId: string }>(
      "POST",
      "/auth/login",
      { email, password },
    );
    return result.body.userId;
  }

  public async logout(): Promise<void> {
    await this.#request<void>("POST", "/auth/logout");
  }

  /** Returns null when not signed in (401) instead of throwing. */
  public async session(): Promise<ApiSession | null> {
    try {
      const result = await this.#request<ApiSession>("GET", "/auth/session");
      return result.body;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return null;
      }
      throw error;
    }
  }

  public async listCharacters(): Promise<readonly ApiCharacterSummary[]> {
    const result = await this.#request<readonly ApiCharacterSummary[]>(
      "GET",
      "/characters",
    );
    return result.body;
  }

  public async createCharacter(
    name: string,
    characterClass: "barbarian",
  ): Promise<string> {
    const result = await this.#request<{ id: string }>("POST", "/characters", {
      name,
      class: characterClass,
    });
    return result.body.id;
  }

  public async getCharacter(id: string): Promise<ApiCharacterDetail> {
    const result = await this.#request<ApiCharacterDetail>(
      "GET",
      `/characters/${id}`,
    );
    return result.body;
  }

  public async saveCharacter(
    id: string,
    envelope: unknown,
    level: number,
  ): Promise<number> {
    const result = await this.#request<{ revision: number }>(
      "PUT",
      `/characters/${id}/save`,
      { envelope, level },
    );
    return result.body.revision;
  }

  public async deleteCharacter(id: string): Promise<void> {
    await this.#request<void>("DELETE", `/characters/${id}`);
  }
}
