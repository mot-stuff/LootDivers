import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CHECKSUM_ALGORITHM,
  SAVE_FORMAT,
  canonicalJson,
  createSaveEnvelope,
  decodeSaveEnvelope,
  parseSaveJson,
  serializeSaveEnvelope,
  type ChecksumProvider,
  type SaveClock,
  type SaveEnvelopeV1,
} from "../../src/persistence";

const checksumProvider: ChecksumProvider = {
  digest(value) {
    return Promise.resolve(createHash("sha256").update(value).digest("hex"));
  },
};

const clock: SaveClock = {
  nowIso: () => "2026-09-04T22:00:00.000Z",
};

describe("save envelope codec", () => {
  it("round trips validated synthetic fixture state", async () => {
    const state = {
      label: "Synthetic round trip",
      counter: 42,
      markers: [
        { id: "fixture:alpha", value: 3.5 },
        { id: "fixture:beta", value: -7 },
      ],
    };
    const envelope = await createSaveEnvelope(
      state,
      {
        saveId: "fixture:unit",
        revision: 3,
        createdAt: "2026-09-04T20:00:00.000Z",
        updatedAt: "2026-09-04T21:00:00.000Z",
        build: "unit-test",
        contentSchemaVersion: 1,
      },
      checksumProvider,
    );

    const decoded = await decodeSaveEnvelope(
      parseSaveJson(serializeSaveEnvelope(envelope)),
      checksumProvider,
      clock,
    );

    expect(decoded.migratedFromVersion).toBeNull();
    expect(decoded.envelope.payload.fixture).toEqual(state);
    expect(decoded.envelope.checksum.value).toMatch(/^[a-f0-9]{64}$/);
  });

  it("applies ordered version 1 to version 2 migration", async () => {
    const unsigned = {
      format: SAVE_FORMAT,
      formatVersion: 1 as const,
      saveId: "fixture:migration",
      revision: 8,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
      compatibility: {
        build: "legacy-fixture",
        contentSchemaVersion: 1,
      },
      payload: {
        fixtureName: "Legacy synthetic state",
        fixtureCount: 9,
        markerValues: {
          "fixture:zeta": 6,
          "fixture:alpha": 2,
        },
      },
    } satisfies Omit<SaveEnvelopeV1, "checksum">;
    const legacy: SaveEnvelopeV1 = {
      ...unsigned,
      checksum: {
        algorithm: CHECKSUM_ALGORITHM,
        value: await checksumProvider.digest(canonicalJson(unsigned)),
      },
    };

    const decoded = await decodeSaveEnvelope(legacy, checksumProvider, clock);

    expect(decoded.migratedFromVersion).toBe(1);
    expect(decoded.envelope.formatVersion).toBe(2);
    expect(decoded.envelope.payload.fixture).toEqual({
      label: "Legacy synthetic state",
      counter: 9,
      markers: [
        { id: "fixture:alpha", value: 2 },
        { id: "fixture:zeta", value: 6 },
      ],
    });
    expect(decoded.envelope.migrationProvenance).toEqual([
      {
        fromVersion: 1,
        toVersion: 2,
        migratedAt: "2026-09-04T22:00:00.000Z",
      },
    ]);

    const verifiedAgain = await decodeSaveEnvelope(
      decoded.envelope,
      checksumProvider,
      clock,
    );
    expect(verifiedAgain.migratedFromVersion).toBeNull();
  });

  it("rejects checksum changes and malformed fixture state", async () => {
    const valid = await createSaveEnvelope(
      { label: "Valid fixture", counter: 1, markers: [] },
      {
        saveId: "fixture:validation",
        revision: 1,
        createdAt: "2026-09-04T20:00:00.000Z",
        updatedAt: "2026-09-04T20:00:00.000Z",
        build: "unit-test",
        contentSchemaVersion: 1,
      },
      checksumProvider,
    );

    await expect(
      decodeSaveEnvelope(
        {
          ...valid,
          payload: { fixture: { ...valid.payload.fixture, counter: 2 } },
        },
        checksumProvider,
        clock,
      ),
    ).rejects.toMatchObject({ code: "checksum" });

    await expect(
      createSaveEnvelope(
        {
          label: "Invalid fixture",
          counter: -1,
          markers: [],
        },
        {
          saveId: "fixture:validation",
          revision: 2,
          createdAt: "2026-09-04T20:00:00.000Z",
          updatedAt: "2026-09-04T20:00:00.000Z",
          build: "unit-test",
          contentSchemaVersion: 1,
        },
        checksumProvider,
      ),
    ).rejects.toMatchObject({ code: "corrupt" });
  });

  it("rejects unknown envelope fields not covered by the original checksum", async () => {
    const valid = await createSaveEnvelope(
      { label: "Unknown-field fixture", counter: 2, markers: [] },
      {
        saveId: "fixture:unknown-field",
        revision: 1,
        createdAt: "2026-09-04T20:00:00.000Z",
        updatedAt: "2026-09-04T20:00:00.000Z",
        build: "unit-test",
        contentSchemaVersion: 1,
      },
      checksumProvider,
    );

    await expect(
      decodeSaveEnvelope(
        { ...valid, unrecognizedFutureField: "must-not-be-ignored" },
        checksumProvider,
        clock,
      ),
    ).rejects.toMatchObject({ code: "checksum" });
  });
});
