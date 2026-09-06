import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, SESSION_COOKIE } from "../src/app.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import type { DataStore } from "../src/store.js";
import {
  CombatArenaSimulation,
  DEFAULT_COMBAT_ARENA_CONFIG,
  EQUIPMENT_BASE_CATALOG,
  GOLD_MAX_TOTAL,
  experienceToNextLevel,
  generateEquipmentItem,
  persistentInstanceId,
  type CharacterSave,
} from "../../src/core";
import {
  CHARACTER_SAVE_CODEC,
  signEnvelope,
  type CharacterSaveEnvelope,
  type ChecksumProvider,
} from "../../src/persistence";

export interface StoreHarness {
  readonly store: DataStore;
  cleanup(): Promise<void>;
}

export function testConfig(): ServerConfig {
  return loadConfig({
    DATABASE_URL: "postgres://unused-in-tests",
    APP_DOMAIN: "example.test",
  });
}

interface Session {
  readonly cookie: string;
  readonly userId: string;
}

/**
 * A shape-plausible but unsigned/invalid envelope: still useful for the
 * shape-check and size-cap rows of the contract (rejected before or during
 * TASK-717 content validation, never stored).
 */
function makeEnvelope(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    format: "rarpg-character-save",
    formatVersion: 1,
    saveId: "character:slot-1",
    revision: 3,
    createdAt: "2026-09-05T12:00:00.000Z",
    updatedAt: "2026-09-05T12:34:56.000Z",
    compatibility: { build: "loot-divers-client", contentSchemaVersion: 1 },
    migrationProvenance: [],
    payload: { character: { zoneId: "zone:hearthmere", gold: 42 } },
    checksum: { algorithm: "SHA-256", value: "ab".repeat(32) },
    ...overrides,
  };
}

// --- TASK-717 (DEC-043) real-save helpers -------------------------------
// Server-side validation runs the client's own codec + parseCharacterSave,
// so the accepted-save tests must submit envelopes a real client would
// produce: states captured from the core simulation, signed with the shared
// canonical-JSON SHA-256 checksum.

const checksumProvider: ChecksumProvider = {
  digest: (value) =>
    Promise.resolve(createHash("sha256").update(value, "utf8").digest("hex")),
};

/** A legitimately levelled character: XP granted through the core formulas. */
function simulationAtLevel(level: number): CombatArenaSimulation {
  const simulation = new CombatArenaSimulation(DEFAULT_COMBAT_ARENA_CONFIG);
  for (let current = 1; current < level; current += 1) {
    simulation.grantExperience(experienceToNextLevel(current));
  }
  return simulation;
}

function signedEnvelope(
  save: CharacterSave,
  revision = 1,
): Promise<CharacterSaveEnvelope> {
  return CHARACTER_SAVE_CODEC.create(
    save,
    {
      saveId: "character:slot-1",
      revision,
      createdAt: "2026-09-05T10:00:00.000Z",
      updatedAt: "2026-09-05T11:00:00.000Z",
      build: "contract-test",
      contentSchemaVersion: 1,
    },
    checksumProvider,
  );
}

type JsonRecord = Record<string, unknown>;

function characterOf(envelope: JsonRecord): JsonRecord {
  const payload = envelope.payload as JsonRecord;
  return payload.character as JsonRecord;
}

/**
 * Clones the envelope, applies a tamper, and RE-SIGNS it so the checksum is
 * valid again — modelling a cheater who controls the whole client and can
 * forge everything except a state the validators accept.
 */
async function tamperedResigned(
  envelope: CharacterSaveEnvelope,
  tamper: (draft: JsonRecord) => void,
): Promise<JsonRecord> {
  const draft = JSON.parse(JSON.stringify(envelope)) as JsonRecord;
  tamper(draft);
  delete draft.checksum;
  return signEnvelope(draft, checksumProvider);
}

/**
 * The Phase 8 kickoff §2 contract, exercised end-to-end through
 * `app.inject()`. Runs identically against `MemoryStore` (always) and
 * `PgStore` (when TEST_DATABASE_URL points at a disposable Postgres).
 */
export function runContractSuite(
  suiteName: string,
  makeHarness: () => Promise<StoreHarness>,
): void {
  describe(suiteName, () => {
    let harness: StoreHarness;
    let app: FastifyInstance;
    let nowMs = Date.parse("2026-09-05T12:00:00.000Z");

    beforeAll(async () => {
      harness = await makeHarness();
      app = await buildApp({
        store: harness.store,
        config: testConfig(),
        now: () => nowMs,
        rateLimits: false,
        logger: false,
      });
    });

    afterAll(async () => {
      await app.close();
      await harness.cleanup();
    });

    async function signup(
      email: string,
      password = "correct horse battery",
    ): Promise<Session> {
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email, password },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<{ userId: string }>();
      const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
      expect(cookie).toBeDefined();
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite?.toLowerCase()).toBe("lax");
      return {
        cookie: `${SESSION_COOKIE}=${cookie?.value ?? ""}`,
        userId: body.userId,
      };
    }

    async function createCharacter(
      session: Session,
      name: string,
    ): Promise<string> {
      const response = await app.inject({
        method: "POST",
        url: "/characters",
        headers: { cookie: session.cookie },
        payload: { name, class: "barbarian" },
      });
      expect(response.statusCode).toBe(201);
      return response.json<{ id: string }>().id;
    }

    it("GET /healthz returns 200 ok", async () => {
      const response = await app.inject({ method: "GET", url: "/healthz" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok" });
    });

    it("signup auto-logs-in, rejects duplicates and invalid credentials", async () => {
      const session = await signup("dupe-check@example.test");
      expect(session.userId).toMatch(/[0-9a-f-]{36}/i);

      // Duplicate email is case-insensitive (emails normalize to lowercase).
      const duplicate = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email: "Dupe-Check@Example.Test",
          password: "long enough pw",
        },
      });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json<{ error: { code: string } }>().error.code).toBe(
        "email-taken",
      );

      const badEmail = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email: "not-an-email", password: "long enough pw" },
      });
      expect(badEmail.statusCode).toBe(422);

      const shortPassword = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email: "short-pw@example.test", password: "short" },
      });
      expect(shortPassword.statusCode).toBe(422);
    });

    it("login succeeds with correct credentials only", async () => {
      await signup("login-user@example.test", "the right password");

      const wrong = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: "login-user@example.test",
          password: "the wrong password",
        },
      });
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json<{ error: { code: string } }>().error.code).toBe(
        "invalid-credentials",
      );

      const unknown = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "nobody@example.test", password: "whatever it is" },
      });
      expect(unknown.statusCode).toBe(401);

      const right = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: "Login-User@example.test",
          password: "the right password",
        },
      });
      expect(right.statusCode).toBe(200);
      expect(right.cookies.some((c) => c.name === SESSION_COOKIE)).toBe(true);
    });

    it("session probe reflects login state; logout invalidates the token", async () => {
      const session = await signup("probe@example.test");

      const probe = await app.inject({
        method: "GET",
        url: "/auth/session",
        headers: { cookie: session.cookie },
      });
      expect(probe.statusCode).toBe(200);
      expect(probe.json()).toEqual({
        userId: session.userId,
        email: "probe@example.test",
      });

      const anonymous = await app.inject({
        method: "GET",
        url: "/auth/session",
      });
      expect(anonymous.statusCode).toBe(401);

      const logout = await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { cookie: session.cookie },
      });
      expect(logout.statusCode).toBe(204);

      const afterLogout = await app.inject({
        method: "GET",
        url: "/auth/session",
        headers: { cookie: session.cookie },
      });
      expect(afterLogout.statusCode).toBe(401);
    });

    it("sessions expire after the TTL", async () => {
      const session = await signup("expiry@example.test");
      const originalNow = nowMs;
      try {
        nowMs += 31 * 24 * 60 * 60 * 1000; // 31 days > 30-day TTL
        const probe = await app.inject({
          method: "GET",
          url: "/auth/session",
          headers: { cookie: session.cookie },
        });
        expect(probe.statusCode).toBe(401);
      } finally {
        nowMs = originalNow;
      }
    });

    it("character creation enforces the name rules", async () => {
      const session = await signup("names@example.test");

      const created = await createCharacter(session, "Rega the Bold");
      expect(created).toMatch(/[0-9a-f-]{36}/i);

      const cases: readonly { name: string; status: number; code: string }[] = [
        { name: "ab", status: 422, code: "invalid-name" }, // too short
        { name: "a".repeat(17), status: 422, code: "invalid-name" }, // too long
        { name: "1Rega", status: 422, code: "invalid-name" }, // digit first
        { name: "'Rega", status: 422, code: "invalid-name" }, // separator first
        { name: "Rega--Bold", status: 422, code: "invalid-name" }, // consecutive separators
        { name: "Rega  Bold", status: 422, code: "invalid-name" }, // consecutive spaces
        { name: "Rega_Bold", status: 422, code: "invalid-name" }, // bad char
        { name: "rega the bold", status: 409, code: "duplicate-name" }, // case-insensitive dup
        { name: "  Rega the Bold  ", status: 409, code: "duplicate-name" }, // trims then dups
      ];
      for (const testCase of cases) {
        const response = await app.inject({
          method: "POST",
          url: "/characters",
          headers: { cookie: session.cookie },
          payload: { name: testCase.name, class: "barbarian" },
        });
        expect(response.statusCode, testCase.name).toBe(testCase.status);
        expect(
          response.json<{ error: { code: string } }>().error.code,
          testCase.name,
        ).toBe(testCase.code);
      }

      const badClass = await app.inject({
        method: "POST",
        url: "/characters",
        headers: { cookie: session.cookie },
        payload: { name: "Different Name", class: "wizard" },
      });
      expect(badClass.statusCode).toBe(422);
      expect(badClass.json<{ error: { code: string } }>().error.code).toBe(
        "invalid-class",
      );
    });

    it("enforces the 4-character slot limit and frees slots on delete", async () => {
      const session = await signup("slots@example.test");
      const ids: string[] = [];
      for (const name of ["Slot One", "Slot Two", "Slot Three", "Slot Four"]) {
        ids.push(await createCharacter(session, name));
      }
      const fifth = await app.inject({
        method: "POST",
        url: "/characters",
        headers: { cookie: session.cookie },
        payload: { name: "Slot Five", class: "barbarian" },
      });
      expect(fifth.statusCode).toBe(403);
      expect(fifth.json<{ error: { code: string } }>().error.code).toBe(
        "slot-limit",
      );

      const removed = await app.inject({
        method: "DELETE",
        url: `/characters/${ids[0] ?? ""}`,
        headers: { cookie: session.cookie },
      });
      expect(removed.statusCode).toBe(204);

      const afterDelete = await createCharacter(session, "Slot Five");
      expect(afterDelete).toMatch(/[0-9a-f-]{36}/i);
    });

    it("lists characters with metadata and fetches envelope null before first save", async () => {
      const session = await signup("list@example.test");
      const id = await createCharacter(session, "Fresh Diver");

      const list = await app.inject({
        method: "GET",
        url: "/characters",
        headers: { cookie: session.cookie },
      });
      expect(list.statusCode).toBe(200);
      const rows = list.json<
        readonly {
          id: string;
          name: string;
          class: string;
          level: number;
          updatedAt: string;
        }[]
      >();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id,
        name: "Fresh Diver",
        class: "barbarian",
        level: 1,
      });
      expect(typeof rows[0]?.updatedAt).toBe("string");

      const detail = await app.inject({
        method: "GET",
        url: `/characters/${id}`,
        headers: { cookie: session.cookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toEqual({
        id,
        name: "Fresh Diver",
        class: "barbarian",
        level: 1,
        envelope: null,
      });
    });

    it("save stores the envelope verbatim, bumps revision, updates level metadata", async () => {
      const session = await signup("saver@example.test");
      const id = await createCharacter(session, "Save Target");
      const envelope = await signedEnvelope(
        simulationAtLevel(7).captureCharacterSave(),
        1,
      );

      const first = await app.inject({
        method: "PUT",
        url: `/characters/${id}/save`,
        headers: { cookie: session.cookie },
        payload: { envelope, level: 7 },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ revision: 1 });

      const secondEnvelope = await signedEnvelope(
        simulationAtLevel(8).captureCharacterSave(),
        2,
      );
      const second = await app.inject({
        method: "PUT",
        url: `/characters/${id}/save`,
        headers: { cookie: session.cookie },
        payload: { envelope: secondEnvelope, level: 8 },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ revision: 2 });

      const detail = await app.inject({
        method: "GET",
        url: `/characters/${id}`,
        headers: { cookie: session.cookie },
      });
      const body = detail.json<{
        level: number;
        envelope: Record<string, unknown>;
      }>();
      expect(body.level).toBe(8);
      // Verbatim blob round-trip (DEC-032: the server validates on write
      // since TASK-717 but still stores and returns the exact blob).
      expect(body.envelope).toEqual(JSON.parse(JSON.stringify(secondEnvelope)));
    });

    it("accepts a played character's save: gear, gold, spent points (TASK-717)", async () => {
      const session = await signup("played@example.test");
      const id = await createCharacter(session, "Veteran Diver");

      const simulation = simulationAtLevel(3);
      expect(simulation.allocateAttribute("strength").accepted).toBe(true);
      expect(simulation.allocateAttribute("vitality").accepted).toBe(true);
      expect(simulation.grantGold(4_321)).toBe(4_321);
      simulation.addCharacterItem(
        generateEquipmentItem({
          seed: 7,
          instanceId: persistentInstanceId("item:contract-rare"),
          baseId: EQUIPMENT_BASE_CATALOG[0]!.id,
          rarity: "rare",
          origin: "loot",
        }),
      );
      const envelope = await signedEnvelope(
        simulation.captureCharacterSave(),
        1,
      );

      const response = await app.inject({
        method: "PUT",
        url: `/characters/${id}/save`,
        headers: { cookie: session.cookie },
        payload: { envelope, level: 3 },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ revision: 1 });
    });

    it("rejects each tampered save dimension with 422 (TASK-717/DEC-043)", async () => {
      const session = await signup("tamper@example.test");
      const id = await createCharacter(session, "Forged Diver");
      const base = await signedEnvelope(
        simulationAtLevel(1).captureCharacterSave(),
        1,
      );

      async function expectRejected(
        label: string,
        envelope: unknown,
        code: string,
        level = 1,
      ): Promise<void> {
        const response = await app.inject({
          method: "PUT",
          url: `/characters/${id}/save`,
          headers: { cookie: session.cookie },
          payload: { envelope, level },
        });
        expect(response.statusCode, label).toBe(422);
        expect(
          response.json<{ error: { code: string } }>().error.code,
          label,
        ).toBe(code);
      }

      // Gold above GOLD_MAX_TOTAL (re-signed, so only the bound rejects it).
      await expectRejected(
        "gold over cap",
        await tamperedResigned(base, (draft) => {
          characterOf(draft).gold = GOLD_MAX_TOTAL + 1;
        }),
        "invalid-save",
      );

      // Attribute points the recorded level never earned.
      await expectRejected(
        "unearned attribute points",
        await tamperedResigned(base, (draft) => {
          const progression = characterOf(draft).progression as JsonRecord;
          (progression.attributes as JsonRecord).strength = 50;
        }),
        "invalid-save",
      );

      // Unearned passive points via the unspent pool.
      await expectRejected(
        "unearned passive points",
        await tamperedResigned(base, (draft) => {
          const progression = characterOf(draft).progression as JsonRecord;
          progression.unspentPassivePoints = 999;
        }),
        "invalid-save",
      );

      // An item whose affix tier is outside the legal 1-5 band.
      const withItem = await signedEnvelope(
        (() => {
          const simulation = simulationAtLevel(1);
          simulation.addCharacterItem(
            generateEquipmentItem({
              seed: 11,
              instanceId: persistentInstanceId("item:contract-tamper"),
              baseId: EQUIPMENT_BASE_CATALOG[0]!.id,
              rarity: "rare",
              origin: "loot",
            }),
          );
          return simulation.captureCharacterSave();
        })(),
        1,
      );
      await expectRejected(
        "illegal item affix tier",
        await tamperedResigned(withItem, (draft) => {
          const items = characterOf(draft).items as JsonRecord;
          const inventory = items.inventory as (JsonRecord | null)[];
          const item = inventory.find((slot) => slot !== null);
          expect(item).toBeDefined();
          const affixes = item?.affixes as JsonRecord[];
          expect(affixes.length).toBeGreaterThan(0);
          affixes[0]!.tier = 9;
        }),
        "invalid-save",
      );

      // Checksum tampered without re-signing.
      const badChecksum = JSON.parse(JSON.stringify(base)) as JsonRecord;
      const checksum = badChecksum.checksum as JsonRecord;
      checksum.value = (checksum.value as string).replace(/^./, (first) =>
        first === "0" ? "1" : "0",
      );
      await expectRejected("forged checksum", badChecksum, "checksum-mismatch");

      // A format version this server does not know.
      await expectRejected(
        "unknown format version",
        await tamperedResigned(base, (draft) => {
          draft.formatVersion = 99;
        }),
        "unsupported-version",
      );

      // Level metadata that contradicts the save's progression.
      await expectRejected("level mismatch", base, "level-mismatch", 5);

      // Nothing above was stored.
      const detail = await app.inject({
        method: "GET",
        url: `/characters/${id}`,
        headers: { cookie: session.cookie },
      });
      expect(detail.json<{ envelope: unknown }>().envelope).toBeNull();
    });

    it("rejects stale envelope revisions with 409 (TASK-717/DEC-043)", async () => {
      const session = await signup("stale@example.test");
      const id = await createCharacter(session, "Rewind Diver");
      const save = simulationAtLevel(1).captureCharacterSave();

      const revisionTwo = await signedEnvelope(save, 2);
      const first = await app.inject({
        method: "PUT",
        url: `/characters/${id}/save`,
        headers: { cookie: session.cookie },
        payload: { envelope: revisionTwo, level: 1 },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ revision: 1 });

      for (const staleRevision of [2, 1]) {
        const stale = await app.inject({
          method: "PUT",
          url: `/characters/${id}/save`,
          headers: { cookie: session.cookie },
          payload: {
            envelope: await signedEnvelope(save, staleRevision),
            level: 1,
          },
        });
        expect(stale.statusCode, `revision ${String(staleRevision)}`).toBe(409);
        expect(
          stale.json<{ error: { code: string } }>().error.code,
          `revision ${String(staleRevision)}`,
        ).toBe("stale-revision");
      }

      const newer = await app.inject({
        method: "PUT",
        url: `/characters/${id}/save`,
        headers: { cookie: session.cookie },
        payload: { envelope: await signedEnvelope(save, 3), level: 1 },
      });
      expect(newer.statusCode).toBe(200);
      expect(newer.json()).toEqual({ revision: 2 });
    });

    it("rejects malformed and oversized envelopes with contract codes", async () => {
      const session = await signup("shapes@example.test");
      const id = await createCharacter(session, "Shape Target");

      const notAnEnvelope = await app.inject({
        method: "PUT",
        url: `/characters/${id}/save`,
        headers: { cookie: session.cookie },
        payload: { envelope: { hello: "world" }, level: 2 },
      });
      expect(notAnEnvelope.statusCode).toBe(422);
      expect(notAnEnvelope.json<{ error: { code: string } }>().error.code).toBe(
        "invalid-envelope",
      );

      const missingChecksum = await app.inject({
        method: "PUT",
        url: `/characters/${id}/save`,
        headers: { cookie: session.cookie },
        payload: { envelope: makeEnvelope({ checksum: undefined }), level: 2 },
      });
      expect(missingChecksum.statusCode).toBe(422);

      const badLevel = await app.inject({
        method: "PUT",
        url: `/characters/${id}/save`,
        headers: { cookie: session.cookie },
        payload: { envelope: makeEnvelope(), level: 2.5 },
      });
      expect(badLevel.statusCode).toBe(422);
      expect(badLevel.json<{ error: { code: string } }>().error.code).toBe(
        "invalid-level",
      );

      // Above the 1 MB cap but under the transport body limit: rejected by
      // the in-handler size check.
      const oversized = await app.inject({
        method: "PUT",
        url: `/characters/${id}/save`,
        headers: { cookie: session.cookie },
        payload: {
          envelope: makeEnvelope({ payload: { blob: "x".repeat(1_050_000) } }),
          level: 2,
        },
      });
      expect(oversized.statusCode).toBe(413);
      expect(oversized.json<{ error: { code: string } }>().error.code).toBe(
        "envelope-too-large",
      );

      // Far above the transport limit: rejected by Fastify body limit, same
      // contract shape.
      const enormous = await app.inject({
        method: "PUT",
        url: `/characters/${id}/save`,
        headers: { cookie: session.cookie },
        payload: {
          envelope: makeEnvelope({ payload: { blob: "x".repeat(2_000_000) } }),
          level: 2,
        },
      });
      expect(enormous.statusCode).toBe(413);
      expect(enormous.json<{ error: { code: string } }>().error.code).toBe(
        "envelope-too-large",
      );
    });

    it("isolates ownership: user B cannot see or touch user A's characters", async () => {
      const userA = await signup("owner-a@example.test");
      const userB = await signup("owner-b@example.test");
      const characterId = await createCharacter(userA, "Property of A");
      const levelFive = await signedEnvelope(
        simulationAtLevel(5).captureCharacterSave(),
        1,
      );
      const seeded = await app.inject({
        method: "PUT",
        url: `/characters/${characterId}/save`,
        headers: { cookie: userA.cookie },
        payload: { envelope: levelFive, level: 5 },
      });
      expect(seeded.statusCode).toBe(200);

      const read = await app.inject({
        method: "GET",
        url: `/characters/${characterId}`,
        headers: { cookie: userB.cookie },
      });
      expect(read.statusCode).toBe(404);

      // A fully VALID save from the wrong account: content validation
      // passes, the store's ownership filter still answers 404.
      const write = await app.inject({
        method: "PUT",
        url: `/characters/${characterId}/save`,
        headers: { cookie: userB.cookie },
        payload: {
          envelope: await signedEnvelope(
            simulationAtLevel(1).captureCharacterSave(),
            7,
          ),
          level: 1,
        },
      });
      expect(write.statusCode).toBe(404);

      const remove = await app.inject({
        method: "DELETE",
        url: `/characters/${characterId}`,
        headers: { cookie: userB.cookie },
      });
      expect(remove.statusCode).toBe(404);

      const bList = await app.inject({
        method: "GET",
        url: "/characters",
        headers: { cookie: userB.cookie },
      });
      expect(bList.json<readonly unknown[]>()).toHaveLength(0);

      // B can also create a same-named character: uniqueness is per-account.
      const sameName = await app.inject({
        method: "POST",
        url: "/characters",
        headers: { cookie: userB.cookie },
        payload: { name: "Property of A", class: "barbarian" },
      });
      expect(sameName.statusCode).toBe(201);

      // A's character is untouched.
      const aDetail = await app.inject({
        method: "GET",
        url: `/characters/${characterId}`,
        headers: { cookie: userA.cookie },
      });
      expect(aDetail.statusCode).toBe(200);
      expect(aDetail.json<{ level: number }>().level).toBe(5);
    });

    it("requires authentication on every character route", async () => {
      for (const request of [
        { method: "GET" as const, url: "/characters" },
        { method: "POST" as const, url: "/characters" },
        {
          method: "GET" as const,
          url: "/characters/00000000-0000-4000-8000-000000000000",
        },
        {
          method: "PUT" as const,
          url: "/characters/00000000-0000-4000-8000-000000000000/save",
        },
        {
          method: "DELETE" as const,
          url: "/characters/00000000-0000-4000-8000-000000000000",
        },
      ]) {
        const needsBody = request.method === "POST" || request.method === "PUT";
        const response = await app.inject(
          needsBody ? { ...request, payload: {} } : request,
        );
        expect(response.statusCode, `${request.method} ${request.url}`).toBe(
          401,
        );
        expect(
          response.json<{ error: { code: string } }>().error.code,
          `${request.method} ${request.url}`,
        ).toBe("unauthorized");
      }
    });

    it("treats malformed and unknown character ids as 404", async () => {
      const session = await signup("missing@example.test");
      const malformed = await app.inject({
        method: "GET",
        url: "/characters/not-a-uuid",
        headers: { cookie: session.cookie },
      });
      expect(malformed.statusCode).toBe(404);

      const unknown = await app.inject({
        method: "GET",
        url: "/characters/00000000-0000-4000-8000-000000000000",
        headers: { cookie: session.cookie },
      });
      expect(unknown.statusCode).toBe(404);
    });
  });
}
