import { expect, test, type Page } from "@playwright/test";

const fixture = (counter: number) => ({
  label: "Playwright synthetic fixture",
  counter,
  markers: [{ id: "fixture:browser", value: counter * 10 }],
});

async function openFixture(page: Page): Promise<void> {
  await page.goto("/?persistenceTest", { waitUntil: "networkidle" });
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
