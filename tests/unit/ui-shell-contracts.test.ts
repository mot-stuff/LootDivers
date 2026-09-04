import { describe, expect, it, vi } from "vitest";

import { measureCanvasViewport } from "../../src/adapters/browser/canvas-viewport";
import {
  captureCanvasKeyboardEvent,
  isCanvasKeyboardCaptureAllowed,
} from "../../src/adapters/browser/keyboard-capture";
import { createReadModelChannel } from "../../src/adapters/ui/read-model-channel";

describe("UI shell boundaries", () => {
  it("publishes read models without exposing a mutation method to consumers", () => {
    interface TestReadModel {
      readonly revision: number;
      readonly label: string;
    }

    const first: Readonly<TestReadModel> = Object.freeze({
      revision: 0,
      label: "loading",
    });
    const second: Readonly<TestReadModel> = Object.freeze({
      revision: 1,
      label: "ready",
    });
    const channel = createReadModelChannel(first);
    const listener = vi.fn();
    const unsubscribe = channel.source.subscribe(listener);

    expect(Object.keys(channel.source).sort()).toEqual([
      "getSnapshot",
      "subscribe",
    ]);

    channel.publisher.publish(second);

    expect(channel.source.getSnapshot()).toBe(second);
    expect(listener).toHaveBeenCalledExactlyOnceWith(second);

    unsubscribe();
    channel.publisher.publish(first);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("converts CSS size and DPR into deterministic backing dimensions", () => {
    expect(
      measureCanvasViewport({ clientWidth: 853, clientHeight: 480 }, 1.25),
    ).toEqual({
      cssWidth: 853,
      cssHeight: 480,
      backingWidth: 1066,
      backingHeight: 600,
      devicePixelRatio: 1.25,
    });
  });

  it("uses safe minimums for transient zero-size and invalid DPR", () => {
    expect(
      measureCanvasViewport({ clientWidth: 0, clientHeight: 0 }, Number.NaN),
    ).toEqual({
      cssWidth: 1,
      cssHeight: 1,
      backingWidth: 1,
      backingHeight: 1,
      devicePixelRatio: 1,
    });
  });

  it("allows keyboard capture only while the canvas itself owns focus", () => {
    const canvas = {} as HTMLCanvasElement;
    const uiControl = {} as HTMLButtonElement;
    const plainEvent = {
      altKey: false,
      code: "KeyW",
      ctrlKey: false,
      isComposing: false,
      metaKey: false,
      shiftKey: false,
    };

    expect(isCanvasKeyboardCaptureAllowed(canvas, canvas, plainEvent)).toBe(
      true,
    );
    expect(isCanvasKeyboardCaptureAllowed(uiControl, canvas, plainEvent)).toBe(
      false,
    );
    expect(
      isCanvasKeyboardCaptureAllowed(canvas, canvas, {
        ...plainEvent,
        ctrlKey: true,
      }),
    ).toBe(false);
    expect(
      isCanvasKeyboardCaptureAllowed(canvas, canvas, {
        ...plainEvent,
        code: "Tab",
      }),
    ).toBe(false);
  });

  it("emits no intents for focus-navigation modifier sequences", () => {
    const canvas = {} as HTMLCanvasElement;
    const emit = vi.fn();
    const baseEvent = {
      altKey: false,
      code: "Tab",
      ctrlKey: false,
      isComposing: false,
      metaKey: false,
      preventDefault: vi.fn(),
      shiftKey: false,
      stopPropagation: vi.fn(),
    };
    const focusNavigationSequence = [
      { ...baseEvent, code: "ShiftLeft", shiftKey: true },
      { ...baseEvent, shiftKey: true },
      { ...baseEvent, code: "ControlLeft", ctrlKey: true },
      { ...baseEvent, ctrlKey: true },
      { ...baseEvent, code: "AltLeft", altKey: true },
      { ...baseEvent, altKey: true },
      { ...baseEvent, code: "MetaLeft", metaKey: true },
      { ...baseEvent, metaKey: true },
    ];

    for (const event of focusNavigationSequence) {
      expect(captureCanvasKeyboardEvent(canvas, canvas, event, { emit })).toBe(
        false,
      );
    }

    expect(emit).not.toHaveBeenCalled();
    expect(baseEvent.preventDefault).not.toHaveBeenCalled();
    expect(baseEvent.stopPropagation).not.toHaveBeenCalled();
  });
});
