import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, SESSION_COOKIE } from "../src/app.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { auditStoredSaves, renderAuditReport } from "../src/save-audit.js";
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

    it("CORS preflights allow PUT and DELETE from the site origin", async () => {
      // Regression (2026-09-05, live): the default preflight allow-list is
      // GET,HEAD,POST, so browsers silently blocked every cross-origin
      // save PUT and character DELETE after a 204 preflight. Node clients
      // never see CORS, so only this header assertion guards it.
      for (const method of ["PUT", "DELETE"]) {
        const response = await app.inject({
          method: "OPTIONS",
          url: "/characters/some-id/save",
          headers: {
            origin: "https://example.test",
            "access-control-request-method": method,
            "access-control-request-headers": "content-type",
          },
        });
        expect(response.statusCode).toBe(204);
        expect(response.headers["access-control-allow-origin"]).toBe(
          "https://example.test",
        );
        expect(response.headers["access-control-allow-credentials"]).toBe(
          "true",
        );
        const allowed = String(
          response.headers["access-control-allow-methods"] ?? "",
        );
        expect(allowed).toContain(method);
      }
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
        isAdmin: false,
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

    it("bans lock out login and live sessions; unban restores both (TASK-718)", async () => {
      const session = await signup("banhammer@example.test", "ban test pw ok");

      const beforeBan = await app.inject({
        method: "GET",
        url: "/characters",
        headers: { cookie: session.cookie },
      });
      expect(beforeBan.statusCode).toBe(200);

      // Banning is a store-level operation (the ban CLI, DEC-044): no HTTP
      // admin surface exists on purpose.
      expect(
        await harness.store.banUser(session.userId, "contract-suite test ban"),
      ).toBe(true);

      // The live session is rejected on its very next request.
      for (const request of [
        { method: "GET" as const, url: "/characters" },
        { method: "GET" as const, url: "/auth/session" },
      ]) {
        const blocked = await app.inject({
          ...request,
          headers: { cookie: session.cookie },
        });
        expect(blocked.statusCode, request.url).toBe(403);
        expect(
          blocked.json<{ error: { code: string; message: string } }>().error,
          request.url,
        ).toMatchObject({ code: "account-banned" });
      }

      // Login with the CORRECT password answers 403 account-banned (wrong
      // passwords still get the usual 401, revealing nothing).
      const bannedLogin = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: "banhammer@example.test",
          password: "ban test pw ok",
        },
      });
      expect(bannedLogin.statusCode).toBe(403);
      expect(
        bannedLogin.json<{ error: { code: string; message: string } }>().error,
      ).toMatchObject({ code: "account-banned" });
      const wrongPassword = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "banhammer@example.test", password: "not the pw!" },
      });
      expect(wrongPassword.statusCode).toBe(401);

      // Unban restores login AND the untouched original session.
      expect(await harness.store.unbanUser(session.userId)).toBe(true);
      const loginAgain = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: "banhammer@example.test",
          password: "ban test pw ok",
        },
      });
      expect(loginAgain.statusCode).toBe(200);
      const sessionAgain = await app.inject({
        method: "GET",
        url: "/characters",
        headers: { cookie: session.cookie },
      });
      expect(sessionAgain.statusCode).toBe(200);

      // Unknown accounts are reported, not silently "banned".
      expect(
        await harness.store.banUser(
          "00000000-0000-4000-8000-000000000000",
          "nobody",
        ),
      ).toBe(false);
    });

    it("logs every save-content rejection to the audit trail (TASK-718)", async () => {
      const session = await signup("rejections@example.test");
      const id = await createCharacter(session, "Reject Target");
      const countFor = async (): Promise<number> => {
        const counts = await harness.store.listSaveRejectionCounts();
        return counts.find((row) => row.userId === session.userId)?.count ?? 0;
      };
      expect(await countFor()).toBe(0);

      const base = await signedEnvelope(
        simulationAtLevel(1).captureCharacterSave(),
        1,
      );

      // 422 invalid-save (forged gold, re-signed).
      const forged = await app.inject({
        method: "PUT",
        url: `/characters/${id}/save`,
        headers: { cookie: session.cookie },
        payload: {
          envelope: await tamperedResigned(base, (draft) => {
            characterOf(draft).gold = GOLD_MAX_TOTAL + 1;
          }),
          level: 1,
        },
      });
      expect(forged.statusCode).toBe(422);
      expect(await countFor()).toBe(1);

      // 409 stale-revision: land revision 2, then replay it.
      const landed = await app.inject({
        method: "PUT",
        url: `/characters/${id}/save`,
        headers: { cookie: session.cookie },
        payload: {
          envelope: await signedEnvelope(
            simulationAtLevel(1).captureCharacterSave(),
            2,
          ),
          level: 1,
        },
      });
      expect(landed.statusCode).toBe(200);
      const replay = await app.inject({
        method: "PUT",
        url: `/characters/${id}/save`,
        headers: { cookie: session.cookie },
        payload: { envelope: base, level: 1 },
      });
      expect(replay.statusCode).toBe(409);
      expect(await countFor()).toBe(2);

      // Accepted saves add nothing; the report row carries the email.
      const counts = await harness.store.listSaveRejectionCounts();
      expect(counts).toContainEqual({
        userId: session.userId,
        email: "rejections@example.test",
        count: 2,
      });
    });

    it("audit sweep passes valid data and flags a pre-validation blob (TASK-718)", async () => {
      const session = await signup("audit@example.test");
      const cleanId = await createCharacter(session, "Clean Diver");
      const seeded = await app.inject({
        method: "PUT",
        url: `/characters/${cleanId}/save`,
        headers: { cookie: session.cookie },
        payload: {
          envelope: await signedEnvelope(
            simulationAtLevel(2).captureCharacterSave(),
            1,
          ),
          level: 2,
        },
      });
      expect(seeded.statusCode).toBe(200);

      // Everything the suite has stored so far went through write-time
      // validation, so the sweep over the whole store must be clean.
      const baseline = await auditStoredSaves(harness.store);
      expect(baseline.invalidFindings).toHaveLength(0);
      expect(
        baseline.findings.find((f) => f.characterId === cleanId),
      ).toMatchObject({
        email: "audit@example.test",
        characterName: "Clean Diver",
        verdict: "valid",
        codes: [],
      });

      // Simulate a row stored BEFORE validation shipped: write an unsigned
      // blob directly through the store, bypassing the route entirely.
      const forgedId = await createCharacter(session, "Forged Blob");
      const inserted = await harness.store.saveCharacter(
        session.userId,
        forgedId,
        makeEnvelope(),
        3,
        1,
        "ab".repeat(32),
        3,
      );
      expect(inserted).toEqual({ revision: 1 });

      const report = await auditStoredSaves(harness.store);
      expect(report.invalidFindings).toHaveLength(1);
      expect(report.invalidFindings[0]).toMatchObject({
        userId: session.userId,
        email: "audit@example.test",
        characterId: forgedId,
        characterName: "Forged Blob",
        verdict: "invalid",
        codes: ["checksum-mismatch"],
      });
      // The report carries the write-time rejection totals as the DEC-044
      // human-decision signal.
      expect(report.rejectionCounts).toEqual(
        await harness.store.listSaveRejectionCounts(),
      );
      const rendered = renderAuditReport(report);
      expect(rendered).toContain("1 invalid");
      expect(rendered).toContain("Forged Blob");
      expect(rendered).toContain("checksum-mismatch");

      // Leave the store clean for any later sweep.
      const removed = await app.inject({
        method: "DELETE",
        url: `/characters/${forgedId}`,
        headers: { cookie: session.cookie },
      });
      expect(removed.statusCode).toBe(204);
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

    // --- TASK-720 (DEC-046): admin surface, news, and the delete/CORS fix --

    async function signupAdmin(email: string): Promise<Session> {
      const session = await signup(email);
      expect(await harness.store.setAdmin(session.userId, true)).toBe(true);
      return session;
    }

    // The CORS preflight regression pin lives earlier in this suite (the
    // main-branch hotfix and TASK-720 found the same bug independently).

    it("deletes a character and its stored save for good (TASK-720 check)", async () => {
      const session = await signup("deleter@example.test");
      const id = await createCharacter(session, "Doomed Diver");
      const seeded = await app.inject({
        method: "PUT",
        url: `/characters/${id}/save`,
        headers: { cookie: session.cookie },
        payload: {
          envelope: await signedEnvelope(
            simulationAtLevel(2).captureCharacterSave(),
            1,
          ),
          level: 2,
        },
      });
      expect(seeded.statusCode).toBe(200);

      const removed = await app.inject({
        method: "DELETE",
        url: `/characters/${id}`,
        headers: { cookie: session.cookie },
      });
      expect(removed.statusCode).toBe(204);

      const gone = await app.inject({
        method: "GET",
        url: `/characters/${id}`,
        headers: { cookie: session.cookie },
      });
      expect(gone.statusCode).toBe(404);

      const list = await app.inject({
        method: "GET",
        url: "/characters",
        headers: { cookie: session.cookie },
      });
      expect(list.json<readonly unknown[]>()).toHaveLength(0);

      const again = await app.inject({
        method: "DELETE",
        url: `/characters/${id}`,
        headers: { cookie: session.cookie },
      });
      expect(again.statusCode).toBe(404);
    });

    it("gates every admin route: 401 anonymous, 403 non-admin (TASK-720)", async () => {
      const outsider = await signup("not-an-admin@example.test");
      const zeroId = "00000000-0000-4000-8000-000000000000";
      const routes = [
        { method: "GET" as const, url: "/admin/accounts?email=x@example.test" },
        { method: "POST" as const, url: `/admin/accounts/${zeroId}/ban` },
        { method: "POST" as const, url: `/admin/accounts/${zeroId}/unban` },
        { method: "GET" as const, url: "/admin/save-rejections" },
        { method: "POST" as const, url: "/admin/news" },
        { method: "PUT" as const, url: `/admin/news/${zeroId}` },
        { method: "DELETE" as const, url: `/admin/news/${zeroId}` },
      ];
      for (const route of routes) {
        const label = `${route.method} ${route.url}`;
        const needsBody = route.method === "POST" || route.method === "PUT";
        const anonymous = await app.inject(
          needsBody ? { ...route, payload: {} } : route,
        );
        expect(anonymous.statusCode, label).toBe(401);

        const forbidden = await app.inject({
          ...(needsBody ? { ...route, payload: {} } : route),
          headers: { cookie: outsider.cookie },
        });
        expect(forbidden.statusCode, label).toBe(403);
        expect(
          forbidden.json<{ error: { code: string } }>().error.code,
          label,
        ).toBe("admin-required");
      }
    });

    it("exposes isAdmin through /auth/session; demotion closes the gate (TASK-720)", async () => {
      const session = await signupAdmin("promoted@example.test");
      const probe = await app.inject({
        method: "GET",
        url: "/auth/session",
        headers: { cookie: session.cookie },
      });
      expect(probe.statusCode).toBe(200);
      expect(probe.json()).toEqual({
        userId: session.userId,
        email: "promoted@example.test",
        isAdmin: true,
      });
      const open = await app.inject({
        method: "GET",
        url: "/admin/save-rejections",
        headers: { cookie: session.cookie },
      });
      expect(open.statusCode).toBe(200);

      // Demotion (the CLI path) takes effect on the very next request.
      expect(await harness.store.setAdmin(session.userId, false)).toBe(true);
      const closed = await app.inject({
        method: "GET",
        url: "/admin/save-rejections",
        headers: { cookie: session.cookie },
      });
      expect(closed.statusCode).toBe(403);
      const demotedProbe = await app.inject({
        method: "GET",
        url: "/auth/session",
        headers: { cookie: session.cookie },
      });
      expect(demotedProbe.json<{ isAdmin: boolean }>().isAdmin).toBe(false);
    });

    it("admin ban/unban endpoints mirror the CLI semantics (TASK-720)", async () => {
      const admin = await signupAdmin("panel-admin@example.test");
      const target = await signup(
        "panel-target@example.test",
        "panel target pw",
      );

      const emptyReason = await app.inject({
        method: "POST",
        url: `/admin/accounts/${target.userId}/ban`,
        headers: { cookie: admin.cookie },
        payload: { reason: "   " },
      });
      expect(emptyReason.statusCode).toBe(422);
      expect(emptyReason.json<{ error: { code: string } }>().error.code).toBe(
        "invalid-ban-reason",
      );

      const unknownAccount = await app.inject({
        method: "POST",
        url: "/admin/accounts/00000000-0000-4000-8000-000000000000/ban",
        headers: { cookie: admin.cookie },
        payload: { reason: "nobody" },
      });
      expect(unknownAccount.statusCode).toBe(404);

      const banned = await app.inject({
        method: "POST",
        url: `/admin/accounts/${target.userId}/ban`,
        headers: { cookie: admin.cookie },
        payload: { reason: "panel test ban" },
      });
      expect(banned.statusCode).toBe(200);
      const banBody = banned.json<{
        id: string;
        email: string;
        bannedAt: string | null;
        banReason: string | null;
      }>();
      expect(banBody.id).toBe(target.userId);
      expect(banBody.email).toBe("panel-target@example.test");
      expect(banBody.bannedAt).not.toBeNull();
      expect(banBody.banReason).toBe("panel test ban");

      // Same enforcement as the CLI ban: live session dies, login blocked.
      const liveSession = await app.inject({
        method: "GET",
        url: "/characters",
        headers: { cookie: target.cookie },
      });
      expect(liveSession.statusCode).toBe(403);
      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: "panel-target@example.test",
          password: "panel target pw",
        },
      });
      expect(login.statusCode).toBe(403);
      expect(login.json<{ error: { code: string } }>().error.code).toBe(
        "account-banned",
      );

      // Admin accounts are immune over HTTP (demote via CLI first): a
      // stolen admin session cannot lock the owner out.
      const banAdmin = await app.inject({
        method: "POST",
        url: `/admin/accounts/${admin.userId}/ban`,
        headers: { cookie: admin.cookie },
        payload: { reason: "self-destruct" },
      });
      expect(banAdmin.statusCode).toBe(409);
      expect(banAdmin.json<{ error: { code: string } }>().error.code).toBe(
        "target-is-admin",
      );

      const unbanned = await app.inject({
        method: "POST",
        url: `/admin/accounts/${target.userId}/unban`,
        headers: { cookie: admin.cookie },
      });
      expect(unbanned.statusCode).toBe(200);
      expect(
        unbanned.json<{ id: string; bannedAt: string | null }>(),
      ).toMatchObject({ id: target.userId, bannedAt: null });

      const loginAgain = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: "panel-target@example.test",
          password: "panel target pw",
        },
      });
      expect(loginAgain.statusCode).toBe(200);
      const sessionAgain = await app.inject({
        method: "GET",
        url: "/characters",
        headers: { cookie: target.cookie },
      });
      expect(sessionAgain.statusCode).toBe(200);

      const unbanUnknown = await app.inject({
        method: "POST",
        url: "/admin/accounts/00000000-0000-4000-8000-000000000000/unban",
        headers: { cookie: admin.cookie },
      });
      expect(unbanUnknown.statusCode).toBe(404);
    });

    it("serves the save-rejection log with per-account counts (TASK-720)", async () => {
      const admin = await signupAdmin("log-reader@example.test");
      const target = await signup("logged-cheater@example.test");
      const characterId = await createCharacter(target, "Logged Forger");
      const base = await signedEnvelope(
        simulationAtLevel(1).captureCharacterSave(),
        1,
      );
      const rejected = await app.inject({
        method: "PUT",
        url: `/characters/${characterId}/save`,
        headers: { cookie: target.cookie },
        payload: {
          envelope: await tamperedResigned(base, (draft) => {
            characterOf(draft).gold = GOLD_MAX_TOTAL + 1;
          }),
          level: 1,
        },
      });
      expect(rejected.statusCode).toBe(422);

      const log = await app.inject({
        method: "GET",
        url: "/admin/save-rejections",
        headers: { cookie: admin.cookie },
      });
      expect(log.statusCode).toBe(200);
      const body = log.json<{
        recent: readonly {
          userId: string;
          email: string;
          characterId: string;
          code: string;
          createdAt: string;
        }[];
        counts: readonly { userId: string; email: string; count: number }[];
      }>();
      const row = body.recent.find((r) => r.userId === target.userId);
      expect(row).toMatchObject({
        email: "logged-cheater@example.test",
        characterId,
        code: "invalid-save",
      });
      expect(typeof row?.createdAt).toBe("string");
      expect(body.counts.find((c) => c.userId === target.userId)).toMatchObject(
        { email: "logged-cheater@example.test", count: 1 },
      );

      const limited = await app.inject({
        method: "GET",
        url: "/admin/save-rejections?limit=1",
        headers: { cookie: admin.cookie },
      });
      expect(
        limited.json<{ recent: readonly unknown[] }>().recent,
      ).toHaveLength(1);
      for (const bad of ["0", "-3", "abc", "9999"]) {
        const invalid = await app.inject({
          method: "GET",
          url: `/admin/save-rejections?limit=${bad}`,
          headers: { cookie: admin.cookie },
        });
        expect(invalid.statusCode, `limit=${bad}`).toBe(422);
      }
    });

    it("admin account lookup returns flags and characters, never secrets (TASK-720)", async () => {
      const admin = await signupAdmin("account-reader@example.test");
      const player = await signup("sought-after@example.test");
      const characterId = await createCharacter(player, "Zone Walker");

      // Pre-save: the character line exists with a null zone.
      const fresh = await app.inject({
        method: "GET",
        // Mixed case + uriencoding: the route normalizes like auth does.
        url: "/admin/accounts?email=Sought-After%40Example.Test",
        headers: { cookie: admin.cookie },
      });
      expect(fresh.statusCode).toBe(200);
      interface LookupBody {
        id: string;
        email: string;
        createdAt: string;
        bannedAt: string | null;
        banReason: string | null;
        isAdmin: boolean;
        characters: readonly {
          id: string;
          name: string;
          level: number;
          zoneId: string | null;
          updatedAt: string;
        }[];
      }
      const before = fresh.json<LookupBody>();
      expect(before).toMatchObject({
        id: player.userId,
        email: "sought-after@example.test",
        bannedAt: null,
        banReason: null,
        isAdmin: false,
      });
      expect(typeof before.createdAt).toBe("string");
      expect(before.characters).toHaveLength(1);
      expect(before.characters[0]).toMatchObject({
        id: characterId,
        name: "Zone Walker",
        level: 1,
        zoneId: null,
      });
      // The password hash never crosses the wire in any spelling.
      const raw = fresh.body.toLowerCase();
      expect(raw).not.toContain("password");
      expect(raw).not.toContain("hash");

      const save = simulationAtLevel(2).captureCharacterSave();
      const seeded = await app.inject({
        method: "PUT",
        url: `/characters/${characterId}/save`,
        headers: { cookie: player.cookie },
        payload: { envelope: await signedEnvelope(save, 1), level: 2 },
      });
      expect(seeded.statusCode).toBe(200);

      const after = await app.inject({
        method: "GET",
        url: "/admin/accounts?email=sought-after@example.test",
        headers: { cookie: admin.cookie },
      });
      expect(after.json<LookupBody>().characters[0]).toMatchObject({
        level: 2,
        zoneId: save.zoneId,
      });

      const unknown = await app.inject({
        method: "GET",
        url: "/admin/accounts?email=nobody-here@example.test",
        headers: { cookie: admin.cookie },
      });
      expect(unknown.statusCode).toBe(404);

      for (const badQuery of ["", "?email=", "?email=not-an-email"]) {
        const invalid = await app.inject({
          method: "GET",
          url: `/admin/accounts${badQuery}`,
          headers: { cookie: admin.cookie },
        });
        expect(invalid.statusCode, badQuery).toBe(422);
      }
    });

    it("news: public feed, admin CRUD, newest-first (TASK-720/DEC-046)", async () => {
      const admin = await signupAdmin("news-editor@example.test");

      const invalidCases: readonly {
        label: string;
        payload: Record<string, unknown>;
        code: string;
      }[] = [
        { label: "empty body object", payload: {}, code: "invalid-news" },
        {
          label: "blank title",
          payload: { title: "   ", body: "text" },
          code: "invalid-news-title",
        },
        {
          label: "blank body",
          payload: { title: "Title", body: "" },
          code: "invalid-news-body",
        },
        {
          label: "oversized body",
          payload: { title: "Title", body: "x".repeat(20_001) },
          code: "invalid-news-body",
        },
        {
          label: "bad publishedAt",
          payload: { title: "Title", body: "text", publishedAt: "not-a-date" },
          code: "invalid-news-published-at",
        },
        {
          label: "blank author",
          payload: { title: "Title", body: "text", author: " " },
          code: "invalid-news-author",
        },
      ];
      for (const testCase of invalidCases) {
        const response = await app.inject({
          method: "POST",
          url: "/admin/news",
          headers: { cookie: admin.cookie },
          payload: testCase.payload,
        });
        expect(response.statusCode, testCase.label).toBe(422);
        expect(
          response.json<{ error: { code: string } }>().error.code,
          testCase.label,
        ).toBe(testCase.code);
      }

      interface NewsBody {
        id: string;
        date: string;
        title: string;
        body: string;
        author: string;
        publishedAt: string;
      }
      const olderResponse = await app.inject({
        method: "POST",
        url: "/admin/news",
        headers: { cookie: admin.cookie },
        payload: {
          title: "Older patch notes",
          body: "The **older** entry.",
          publishedAt: "2026-09-01T00:00:00.000Z",
        },
      });
      expect(olderResponse.statusCode).toBe(201);
      const older = olderResponse.json<NewsBody>();
      // Response stays close to the static news.json shape (date/title/body)
      // so the TASK-721 homepage swap is mechanical.
      expect(older).toMatchObject({
        date: "2026-09-01",
        title: "Older patch notes",
        body: "The **older** entry.",
        author: "Loot Divers Team",
        publishedAt: "2026-09-01T00:00:00.000Z",
      });

      const newerResponse = await app.inject({
        method: "POST",
        url: "/admin/news",
        headers: { cookie: admin.cookie },
        payload: {
          title: "Newer patch notes",
          body: "The newer entry.",
          author: "The Owner",
          publishedAt: "2026-09-03T00:00:00.000Z",
        },
      });
      expect(newerResponse.statusCode).toBe(201);
      const newer = newerResponse.json<NewsBody>();
      expect(newer.author).toBe("The Owner");

      // The public feed needs no session and sorts newest-first.
      const publicFeed = await app.inject({ method: "GET", url: "/news" });
      expect(publicFeed.statusCode).toBe(200);
      const mine = publicFeed
        .json<readonly NewsBody[]>()
        .filter((entry) => entry.id === older.id || entry.id === newer.id);
      expect(mine.map((entry) => entry.title)).toEqual([
        "Newer patch notes",
        "Older patch notes",
      ]);

      // Update replaces title/body, keeps author/publishedAt when omitted.
      const updated = await app.inject({
        method: "PUT",
        url: `/admin/news/${older.id}`,
        headers: { cookie: admin.cookie },
        payload: { title: "Older, revised", body: "Edited body." },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json<NewsBody>()).toMatchObject({
        id: older.id,
        title: "Older, revised",
        body: "Edited body.",
        author: "Loot Divers Team",
        publishedAt: "2026-09-01T00:00:00.000Z",
      });

      const zeroId = "00000000-0000-4000-8000-000000000000";
      const updateMissing = await app.inject({
        method: "PUT",
        url: `/admin/news/${zeroId}`,
        headers: { cookie: admin.cookie },
        payload: { title: "Ghost", body: "Ghost." },
      });
      expect(updateMissing.statusCode).toBe(404);
      const deleteMissing = await app.inject({
        method: "DELETE",
        url: `/admin/news/${zeroId}`,
        headers: { cookie: admin.cookie },
      });
      expect(deleteMissing.statusCode).toBe(404);

      const removed = await app.inject({
        method: "DELETE",
        url: `/admin/news/${newer.id}`,
        headers: { cookie: admin.cookie },
      });
      expect(removed.statusCode).toBe(204);
      const afterDelete = await app.inject({ method: "GET", url: "/news" });
      const ids = afterDelete
        .json<readonly NewsBody[]>()
        .map((entry) => entry.id);
      expect(ids).not.toContain(newer.id);
      expect(ids).toContain(older.id);
    });
  });
}
