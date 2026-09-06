import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ApiClient, ApiError } from "../../src/adapters/http/api-client";
import { HttpSaveRepository } from "../../src/adapters/http/http-save-repository";
import {
  deriveApiOrigin,
  isLocalDevHostname,
  probeAuthSession,
} from "../../src/adapters/http/session-probe";
import {
  CombatArenaSimulation,
  DEFAULT_COMBAT_ARENA_CONFIG,
} from "../../src/core";
import {
  CHARACTER_SAVE_CODEC,
  PersistenceError,
  type ChecksumProvider,
  type SaveClock,
} from "../../src/persistence";

const checksumProvider: ChecksumProvider = {
  digest(value) {
    return Promise.resolve(createHash("sha256").update(value).digest("hex"));
  },
};

const clock: SaveClock = {
  nowIso: () => "2026-09-05T12:00:00.000Z",
};

const CHARACTER_ID = "11111111-2222-4333-8444-555555555555";

describe("deriveApiOrigin", () => {
  it("maps custom domains to their api sibling and strips www", () => {
    expect(deriveApiOrigin("example.com")).toBe("https://api.example.com");
    expect(deriveApiOrigin("www.example.com")).toBe("https://api.example.com");
    expect(deriveApiOrigin("Play.Example.Com")).toBe(
      "https://api.play.example.com",
    );
  });

  it("returns null for local, IP, Pages, and api-host origins", () => {
    expect(deriveApiOrigin("localhost")).toBeNull();
    expect(deriveApiOrigin("127.0.0.1")).toBeNull();
    expect(deriveApiOrigin("192.168.1.50")).toBeNull();
    expect(deriveApiOrigin("lootdivers.pages.dev")).toBeNull();
    expect(deriveApiOrigin("api.example.com")).toBeNull();
  });
});

describe("isLocalDevHostname (DEC-040 gate boundary)", () => {
  it("treats only loopback and LAN IPs as the ungated dev door", () => {
    expect(isLocalDevHostname("localhost")).toBe(true);
    expect(isLocalDevHostname("127.0.0.1")).toBe(true);
    expect(isLocalDevHostname("192.168.1.50")).toBe(true);
    expect(isLocalDevHostname("[::1]")).toBe(true);
  });

  it("gates every player-reachable host, including Pages previews", () => {
    expect(isLocalDevHostname("example.com")).toBe(false);
    expect(isLocalDevHostname("www.example.com")).toBe(false);
    expect(isLocalDevHostname("lootdivers.pages.dev")).toBe(false);
    expect(isLocalDevHostname("api.example.com")).toBe(false);
  });
});

describe("probeAuthSession", () => {
  it("skips the network entirely on local origins", async () => {
    let called = false;
    const state = await probeAuthSession("localhost", () => {
      called = true;
      return Promise.resolve(new Response("{}"));
    });
    expect(called).toBe(false);
    expect(state).toEqual({ settled: true, session: null, apiOrigin: null });
  });

  it("resolves signed-out when the API is unreachable", async () => {
    const state = await probeAuthSession("example.com", () =>
      Promise.reject(new TypeError("network down")),
    );
    expect(state.settled).toBe(true);
    expect(state.session).toBeNull();
    expect(state.apiOrigin).toBe("https://api.example.com");
  });

  it("returns the session from a live API", async () => {
    const state = await probeAuthSession("example.com", (input) => {
      expect(input).toBe("https://api.example.com/auth/session");
      return Promise.resolve(
        new Response(JSON.stringify({ userId: "u-1", email: "a@b.test" }), {
          status: 200,
        }),
      );
    });
    expect(state.session).toEqual({ userId: "u-1", email: "a@b.test" });
  });
});

describe("ApiClient error mapping", () => {
  it("surfaces contract error codes as ApiError", async () => {
    const client = new ApiClient("https://api.example.com", () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "slot-limit", message: "Accounts hold at most 4." },
          }),
          { status: 403 },
        ),
      ),
    );
    const failure = await client
      .createCharacter("Fifth", "barbarian")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(403);
    expect((failure as ApiError).code).toBe("slot-limit");
  });

  it("treats 401 on the session probe as signed out, not an error", async () => {
    const client = new ApiClient("https://api.example.com", () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: "unauthorized", message: "no" } }),
          { status: 401 },
        ),
      ),
    );
    expect(await client.session()).toBeNull();
  });
});

/**
 * Minimal in-memory stand-in for the TASK-707 server: stores the envelope
 * verbatim per the DEC-032 contract and replays it on GET.
 */
function fakeServer(): {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  state: { envelope: unknown; level: number | null; puts: number };
} {
  const state: { envelope: unknown; level: number | null; puts: number } = {
    envelope: null,
    level: null,
    puts: 0,
  };
  const fetchImpl = (input: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    if (
      method === "PUT" &&
      input.endsWith(`/characters/${CHARACTER_ID}/save`)
    ) {
      if (typeof init?.body !== "string") {
        throw new TypeError("Expected a JSON string body.");
      }
      const body = JSON.parse(init.body) as {
        envelope: unknown;
        level: number;
      };
      state.envelope = body.envelope;
      state.level = body.level;
      state.puts += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ revision: state.puts }), { status: 200 }),
      );
    }
    if (method === "GET" && input.endsWith(`/characters/${CHARACTER_ID}`)) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: CHARACTER_ID,
            name: "Round Tripper",
            class: "barbarian",
            level: state.level ?? 1,
            envelope: state.envelope,
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({ error: { code: "not-found", message: "no route" } }),
        { status: 404 },
      ),
    );
  };
  return { fetch: fetchImpl, state };
}

function makeRepository(
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
): HttpSaveRepository {
  return new HttpSaveRepository({
    client: new ApiClient("https://api.example.com", fetchImpl),
    characterId: CHARACTER_ID,
    codec: CHARACTER_SAVE_CODEC,
    checksumProvider,
    clock,
    build: "unit-test",
    contentSchemaVersion: 1,
  });
}

describe("HttpSaveRepository", () => {
  it("round-trips a character save through the API verbatim", async () => {
    const server = fakeServer();
    const repository = makeRepository(server.fetch);

    const simulation = new CombatArenaSimulation(DEFAULT_COMBAT_ARENA_CONFIG);
    simulation.grantGold(250);
    const save = simulation.captureCharacterSave();

    const envelope = await repository.save(save);
    expect(envelope.revision).toBe(1);
    expect(server.state.level).toBe(save.progression.level);

    const loaded = await repository.load();
    expect(loaded.state).toEqual(save);
    expect(loaded.source).toBe("active");
    expect(loaded.recoveredFromInvalidGeneration).toBe(false);

    // A second save continues the envelope revision chain.
    const second = await repository.save(loaded.state);
    expect(second.revision).toBe(2);
  });

  it("marks save PUTs keepalive so a page-hide flush survives (TASK-719)", async () => {
    const server = fakeServer();
    const seen: (boolean | undefined)[] = [];
    const repository = makeRepository((input, init) => {
      if (init?.method === "PUT") {
        seen.push(init.keepalive);
      }
      return server.fetch(input, init);
    });

    const simulation = new CombatArenaSimulation(DEFAULT_COMBAT_ARENA_CONFIG);
    await repository.save(simulation.captureCharacterSave());
    expect(seen).toEqual([true]);
  });

  it("reports a never-saved character as not-found", async () => {
    const server = fakeServer();
    const repository = makeRepository(server.fetch);
    const failure = await repository.load().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PersistenceError);
    expect((failure as PersistenceError).code).toBe("not-found");
  });

  it("rejects a tampered server blob via the client-side checksum", async () => {
    const server = fakeServer();
    const repository = makeRepository(server.fetch);
    const simulation = new CombatArenaSimulation(DEFAULT_COMBAT_ARENA_CONFIG);
    await repository.save(simulation.captureCharacterSave());

    const tampered = server.state.envelope as {
      payload: { character: { gold: number } };
    };
    tampered.payload.character.gold = 999_999;

    const failure = await repository.load().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PersistenceError);
    expect((failure as PersistenceError).code).toBe("checksum");
  });

  it("maps API failures onto persistence error codes", async () => {
    const errorResponse = (status: number, code: string) =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code, message: code } }), {
          status,
        }),
      );

    const unauthorized = makeRepository(() =>
      errorResponse(401, "unauthorized"),
    );
    const simulation = new CombatArenaSimulation(DEFAULT_COMBAT_ARENA_CONFIG);
    const save = simulation.captureCharacterSave();
    await expect(unauthorized.save(save)).rejects.toMatchObject({
      name: "PersistenceError",
      code: "blocked",
    });

    const overCap = makeRepository(() =>
      errorResponse(413, "envelope-too-large"),
    );
    await expect(overCap.save(save)).rejects.toMatchObject({ code: "quota" });

    const offline = makeRepository(() =>
      Promise.reject(new TypeError("network down")),
    );
    await expect(offline.save(save)).rejects.toMatchObject({
      code: "storage-unavailable",
    });
  });
});
