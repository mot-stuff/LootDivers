import { createHash } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  CHECKSUM_ALGORITHM,
  SAVE_FORMAT,
  canonicalJson,
  type SaveEnvelopeV1,
} from "../../src/persistence";

const fixture = (counter: number) => ({
  label: "Playwright synthetic fixture",
  counter,
  markers: [{ id: "fixture:browser", value: counter * 10 }],
});

async function openFixture(page: Page): Promise<void> {
  await page.goto("/play/?persistenceTest", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await page.evaluate(async () => {
    await window.__RARPG_PERSISTENCE_TEST__?.reset();
  });
}

test.describe("IndexedDB persistence generations", () => {
  test.describe.configure({ mode: "serial" });

  test("round trips through a real reload", async ({ page }) => {
    await openFixture(page);
    await page.evaluate(
      async (state) => window.__RARPG_PERSISTENCE_TEST__?.save(state),
      fixture(11),
    );

    await page.reload({ waitUntil: "networkidle" });
    const loaded = await page.evaluate(async () =>
      window.__RARPG_PERSISTENCE_TEST__?.load(),
    );

    expect(loaded?.state).toEqual(fixture(11));
    expect(loaded?.source).toBe("active");
    await expect(page.getByTestId("persistence-status")).toHaveAttribute(
      "data-status-kind",
      "loaded",
    );
  });

  test("uses backup when the newest generation is invalid", async ({
    page,
  }) => {
    await openFixture(page);
    await page.evaluate(
      async (state) => window.__RARPG_PERSISTENCE_TEST__?.save(state),
      fixture(1),
    );
    await page.evaluate(
      async (state) => window.__RARPG_PERSISTENCE_TEST__?.save(state),
      fixture(2),
    );
    await page.evaluate(async () => {
      await window.__RARPG_PERSISTENCE_TEST__?.corruptActive();
    });

    const loaded = await page.evaluate(async () =>
      window.__RARPG_PERSISTENCE_TEST__?.load(),
    );

    expect(loaded?.state).toEqual(fixture(1));
    expect(loaded?.source).toBe("backup");
    expect(loaded?.recoveredFromInvalidGeneration).toBe(true);
    await expect(page.getByTestId("persistence-status")).toHaveAttribute(
      "data-status-kind",
      "recovered",
    );
  });

  test("serializes concurrent saves and preserves fallback backup", async ({
    page,
  }) => {
    await openFixture(page);
    const envelopes = await page.evaluate(
      async (states) => {
        const api = window.__RARPG_PERSISTENCE_TEST__;

        if (api === undefined) {
          throw new Error("Persistence test API is unavailable.");
        }

        return Promise.all(states.map((state) => api.save(state)));
      },
      [fixture(20), fixture(21), fixture(22)],
    );

    expect(envelopes.map((envelope) => envelope.revision)).toEqual([1, 2, 3]);
    await page.evaluate(async () => {
      await window.__RARPG_PERSISTENCE_TEST__?.corruptActive();
    });

    const loaded = await page.evaluate(async () =>
      window.__RARPG_PERSISTENCE_TEST__?.load(),
    );
    expect(loaded?.state).toEqual(fixture(21));
    expect(loaded?.source).toBe("backup");
    expect(loaded?.recoveredFromInvalidGeneration).toBe(true);

    const generations = await page.evaluate(async () =>
      window.__RARPG_PERSISTENCE_TEST__?.generationState(),
    );
    expect(generations?.generations).toHaveLength(2);
    expect(generations?.activeGeneration).not.toBe(
      generations?.backupGeneration,
    );
  });

  test("keeps active save when generation promotion is interrupted", async ({
    page,
  }) => {
    await openFixture(page);
    await page.evaluate(
      async (state) => window.__RARPG_PERSISTENCE_TEST__?.save(state),
      fixture(3),
    );
    await page.evaluate(() => {
      window.__RARPG_PERSISTENCE_TEST__?.armFault("write-aborted");
    });

    await expect(
      page.evaluate(
        async (state) => window.__RARPG_PERSISTENCE_TEST__?.save(state),
        fixture(4),
      ),
    ).rejects.toThrow();

    const loaded = await page.evaluate(async () =>
      window.__RARPG_PERSISTENCE_TEST__?.load(),
    );
    expect(loaded?.state).toEqual(fixture(3));

    await page.evaluate(
      async (state) => window.__RARPG_PERSISTENCE_TEST__?.save(state),
      fixture(5),
    );
    const generations = await page.evaluate(async () =>
      window.__RARPG_PERSISTENCE_TEST__?.generationState(),
    );
    expect(generations).toEqual({
      activeGeneration: 3,
      backupGeneration: 1,
      generations: [1, 3],
    });
  });

  test("surfaces quota and blocked storage errors", async ({ page }) => {
    await openFixture(page);
    await page.evaluate(() => {
      window.__RARPG_PERSISTENCE_TEST__?.armFault("quota");
    });
    await expect(
      page.evaluate(
        async (state) => window.__RARPG_PERSISTENCE_TEST__?.save(state),
        fixture(5),
      ),
    ).rejects.toThrow();
    await expect(page.getByTestId("persistence-status")).toHaveAttribute(
      "data-error-code",
      "quota",
    );

    await page.evaluate(async () => {
      await window.__RARPG_PERSISTENCE_TEST__?.prepareBlockedUpgrade();
    });
    await expect(
      page.evaluate(async () => window.__RARPG_PERSISTENCE_TEST__?.load()),
    ).rejects.toThrow();
    await expect(page.getByTestId("persistence-status")).toHaveAttribute(
      "data-error-code",
      "blocked",
    );
    await page.evaluate(() => {
      window.__RARPG_PERSISTENCE_TEST__?.releaseBlockedUpgrade();
    });
  });

  test("exports and imports validated fixture state", async ({ page }) => {
    await openFixture(page);
    await page.evaluate(
      async (state) => window.__RARPG_PERSISTENCE_TEST__?.save(state),
      fixture(7),
    );
    const exported = await page.evaluate(async () =>
      window.__RARPG_PERSISTENCE_TEST__?.exportJson(),
    );
    if (exported === undefined) {
      throw new Error("Persistence test API did not return an export.");
    }
    await page.evaluate(
      async (state) => window.__RARPG_PERSISTENCE_TEST__?.save(state),
      fixture(8),
    );
    await page.evaluate(
      async (serialized) =>
        window.__RARPG_PERSISTENCE_TEST__?.importJson(serialized),
      exported,
    );

    const loaded = await page.evaluate(async () =>
      window.__RARPG_PERSISTENCE_TEST__?.load(),
    );
    expect(loaded?.state).toEqual(fixture(7));
    expect(loaded?.envelope.revision).toBe(3);
  });

  test("preserves ordered migration provenance through import and export", async ({
    page,
  }) => {
    await openFixture(page);
    const unsigned = {
      format: SAVE_FORMAT,
      formatVersion: 1 as const,
      saveId: "fixture:legacy-browser",
      revision: 4,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
      compatibility: {
        build: "legacy-browser-fixture",
        contentSchemaVersion: 1,
      },
      payload: {
        fixtureName: "Migrated browser fixture",
        fixtureCount: 31,
        markerValues: { "fixture:legacy": 12 },
      },
    } satisfies Omit<SaveEnvelopeV1, "checksum">;
    const legacy: SaveEnvelopeV1 = {
      ...unsigned,
      checksum: {
        algorithm: CHECKSUM_ALGORITHM,
        value: createHash("sha256")
          .update(canonicalJson(unsigned))
          .digest("hex"),
      },
    };

    await page.evaluate(
      async (serialized) =>
        window.__RARPG_PERSISTENCE_TEST__?.importJson(serialized),
      JSON.stringify(legacy),
    );
    const exported = await page.evaluate(async () =>
      window.__RARPG_PERSISTENCE_TEST__?.exportJson(),
    );
    const parsed = JSON.parse(exported ?? "{}") as {
      migrationProvenance?: readonly {
        fromVersion: number;
        toVersion: number;
        migratedAt: string;
      }[];
    };

    expect(parsed.migrationProvenance).toHaveLength(1);
    expect(parsed.migrationProvenance?.[0]).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
    });
    expect(parsed.migrationProvenance?.[0]?.migratedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
  });

  test("malformed import cannot replace a valid save", async ({ page }) => {
    await openFixture(page);
    await page.evaluate(
      async (state) => window.__RARPG_PERSISTENCE_TEST__?.save(state),
      fixture(6),
    );
    const before = await page.evaluate(async () =>
      window.__RARPG_PERSISTENCE_TEST__?.exportJson(),
    );

    await expect(
      page.evaluate(async () =>
        window.__RARPG_PERSISTENCE_TEST__?.importJson("{malformed"),
      ),
    ).rejects.toThrow();
    await expect(page.getByTestId("persistence-status")).toHaveAttribute(
      "data-error-code",
      "invalid-import",
    );
    const tampered = JSON.parse(before ?? "{}") as {
      payload?: { fixture?: { counter?: number } };
    };
    if (tampered.payload?.fixture !== undefined) {
      tampered.payload.fixture.counter = 999;
    }
    await expect(
      page.evaluate(
        async (serialized) =>
          window.__RARPG_PERSISTENCE_TEST__?.importJson(serialized),
        JSON.stringify(tampered),
      ),
    ).rejects.toThrow();
    const unknownField = JSON.parse(before ?? "{}") as Record<string, unknown>;
    unknownField.unrecognizedFutureField = "must-not-be-ignored";
    await expect(
      page.evaluate(
        async (serialized) =>
          window.__RARPG_PERSISTENCE_TEST__?.importJson(serialized),
        JSON.stringify(unknownField),
      ),
    ).rejects.toThrow();

    const after = await page.evaluate(async () =>
      window.__RARPG_PERSISTENCE_TEST__?.exportJson(),
    );
    expect(after).toBe(before);
    const loaded = await page.evaluate(async () =>
      window.__RARPG_PERSISTENCE_TEST__?.load(),
    );
    expect(loaded?.state).toEqual(fixture(6));
  });
});
