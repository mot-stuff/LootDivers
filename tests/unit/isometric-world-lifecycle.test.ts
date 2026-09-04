import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({
  default: {
    Display: {
      Color: {
        HexStringToColor: (value: string) => ({
          color: Number.parseInt(value.replace("#", ""), 16),
        }),
      },
    },
    Math: {
      Vector2: class Vector2 {
        public constructor(
          public readonly x: number,
          public readonly y: number,
        ) {}
      },
    },
  },
}));

import { IsometricZoneAdapter } from "../../src/adapters/phaser/isometric-world";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function fixtureResponse(status = 200): Response {
  const path = fileURLToPath(
    new URL(
      "../../public/zones/technical-isometric.zone.json",
      import.meta.url,
    ),
  );
  return new Response(readFileSync(path, "utf8"), { status });
}

class FakeGameObject {
  public x = 0;
  public y = 0;
  public depth = 0;
  public destroyed = false;

  public destroy(): void {
    this.destroyed = true;
  }

  public setAlpha(): this {
    return this;
  }

  public setData(): this {
    return this;
  }

  public setDepth(depth: number): this {
    this.depth = depth;
    return this;
  }

  public setOrigin(): this {
    return this;
  }

  public setText(): this {
    return this;
  }

  public setTint(): this {
    return this;
  }
}

function createScene() {
  const textures = new Set<string>();
  const pointerHandlers = new Set<(pointer: unknown) => void>();

  const graphics = () =>
    Object.assign(new FakeGameObject(), {
      fillCircle: () => undefined,
      fillPoints: () => undefined,
      fillStyle: () => undefined,
      generateTexture: (key: string) => textures.add(key),
      lineStyle: () => undefined,
      strokeCircle: () => undefined,
      strokePoints: () => undefined,
    });
  const image = (x: number, y: number) =>
    Object.assign(new FakeGameObject(), { x, y });

  return {
    add: {
      graphics,
      image: (x: number, y: number) => image(x, y),
      text: (x: number, y: number) => image(x, y),
    },
    cameras: {
      main: {
        getWorldPoint: (x: number, y: number) => ({ x, y }),
        height: 540,
        width: 960,
      },
    },
    game: {
      canvas: {
        getBoundingClientRect: () => ({
          height: 540,
          left: 0,
          top: 0,
          width: 960,
        }),
        height: 540,
        width: 960,
      },
    },
    input: {
      emitPointerDown: () => {
        for (const handler of pointerHandlers) {
          handler({ event: { clientX: 480, clientY: 108 } });
        }
      },
      off: (_event: string, handler: (pointer: unknown) => void) => {
        pointerHandlers.delete(handler);
      },
      on: (_event: string, handler: (pointer: unknown) => void) => {
        pointerHandlers.add(handler);
      },
    },
    pointerHandlers,
    textures: {
      exists: (key: string) => textures.has(key),
      remove: (key: string) => textures.delete(key),
    },
  };
}

const loadedDiagnostics = {
  assetCount: 1,
  chunkCount: 20,
  listenerCount: 1,
  objectCount: 27,
  pickedCell: null,
  zoneId: "fixture:technical-isometric",
};

const unloadedDiagnostics = {
  assetCount: 0,
  chunkCount: 0,
  listenerCount: 0,
  objectCount: 0,
  pickedCell: null,
  zoneId: null,
};

describe("IsometricZoneAdapter lifecycle serialization", () => {
  const fetchMock =
    vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("allows only the newest overlapping load to commit", async () => {
    const scene = createScene();
    const adapter = new IsometricZoneAdapter(scene as never);
    const first = deferred<Response>();
    const second = deferred<Response>();
    fetchMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const staleLoad = adapter.load("/zones/first.json");
    const latestLoad = adapter.load("/zones/second.json");
    expect(adapter.diagnostics()).toEqual(unloadedDiagnostics);

    second.resolve(fixtureResponse());
    await latestLoad;
    expect(adapter.diagnostics()).toEqual(loadedDiagnostics);
    expect(scene.pointerHandlers.size).toBe(1);

    first.resolve(fixtureResponse());
    await staleLoad;
    expect(adapter.diagnostics()).toEqual(loadedDiagnostics);
    expect(scene.pointerHandlers.size).toBe(1);
  });

  it("prevents unload resurrection, releases clicks, and reloads", async () => {
    const scene = createScene();
    const adapter = new IsometricZoneAdapter(scene as never);
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);

    const load = adapter.load("/zones/pending.json");
    adapter.unload();
    pending.resolve(fixtureResponse());
    await load;

    expect(adapter.diagnostics()).toEqual(unloadedDiagnostics);
    expect(scene.pointerHandlers.size).toBe(0);
    expect(() => scene.input.emitPointerDown()).not.toThrow();

    fetchMock.mockResolvedValueOnce(fixtureResponse());
    await adapter.load("/zones/reload.json");
    expect(adapter.diagnostics()).toEqual(loadedDiagnostics);
  });

  it("isolates stale failures and reports current failures with context", async () => {
    const scene = createScene();
    const adapter = new IsometricZoneAdapter(scene as never);
    const stale = deferred<Response>();
    const latest = deferred<Response>();
    fetchMock
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(latest.promise);

    const staleLoad = adapter.load("/zones/stale-failure.json");
    const latestLoad = adapter.load("/zones/latest.json");
    latest.resolve(fixtureResponse());
    await latestLoad;
    stale.resolve(fixtureResponse(503));
    await expect(staleLoad).resolves.toBeUndefined();
    expect(adapter.diagnostics()).toEqual(loadedDiagnostics);

    fetchMock.mockResolvedValueOnce(fixtureResponse(502));
    await expect(adapter.load("/zones/current-failure.json")).rejects.toThrow(
      'Technical zone "/zones/current-failure.json" failed to load: request returned HTTP 502',
    );
    expect(adapter.diagnostics()).toEqual(unloadedDiagnostics);

    fetchMock.mockResolvedValueOnce(fixtureResponse());
    await adapter.load("/zones/recovered.json");
    expect(adapter.diagnostics()).toEqual(loadedDiagnostics);
  });
});
