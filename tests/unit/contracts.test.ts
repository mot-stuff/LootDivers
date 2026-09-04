import { describe, expect, expectTypeOf, it } from "vitest";

import {
  contentId,
  persistentInstanceId,
  SequentialRuntimeEntityIds,
  type CommandsFrom,
  type ContentId,
  type EventsFrom,
  type PersistentInstanceId,
  type RuntimeEntityId,
} from "../../src/core";

interface FixtureCommandPayloads {
  "fixture:increment": { readonly amount: number };
  "fixture:sample": undefined;
}

interface FixtureEventPayloads {
  "fixture:changed": { readonly value: number };
}

type FixtureCommand = CommandsFrom<FixtureCommandPayloads>;
type FixtureEvent = EventsFrom<FixtureEventPayloads>;

describe("identity contracts", () => {
  it("allocates opaque, positive process-local entity IDs", () => {
    const source = new SequentialRuntimeEntityIds();

    expect(source.next()).toBe(1);
    expect(source.next()).toBe(2);
    expectTypeOf<RuntimeEntityId>().not.toEqualTypeOf<number>();
  });

  it("fails instead of wrapping exhausted runtime identity", () => {
    const source = new SequentialRuntimeEntityIds(0xffff_ffff);

    expect(source.next()).toBe(0xffff_ffff);
    expect(() => source.next()).toThrow(/exhausted/);
  });

  it("brands validated stable namespaced IDs by purpose", () => {
    const definition = contentId("core:fixture/example");
    const instance = persistentInstanceId("world:fixture-0001");

    expect(definition).toBe("core:fixture/example");
    expect(instance).toBe("world:fixture-0001");
    expectTypeOf(definition).toEqualTypeOf<ContentId>();
    expectTypeOf(instance).toEqualTypeOf<PersistentInstanceId>();
    expectTypeOf<ContentId>().not.toEqualTypeOf<PersistentInstanceId>();
  });

  it.each(["missing_namespace", ":missing", "Core:upper", "core:bad value"])(
    "rejects invalid stable ID %s",
    (value) => {
      expect(() => contentId(value)).toThrow(/namespaced ID/);
      expect(() => persistentInstanceId(value)).toThrow(/namespaced ID/);
    },
  );
});

describe("typed message contracts", () => {
  it("creates discriminated command and event unions", () => {
    const command: FixtureCommand = {
      type: "fixture:increment",
      sequence: 3,
      targetTick: 8,
      payload: { amount: 2 },
    };
    const event: FixtureEvent = {
      type: "fixture:changed",
      tick: 8,
      sequence: 0,
      payload: { value: 2 },
    };

    if (command.type === "fixture:increment") {
      expect(command.payload.amount).toBe(2);
    }

    expect(event).toMatchObject({
      type: "fixture:changed",
      tick: 8,
      payload: { value: 2 },
    });
  });
});
