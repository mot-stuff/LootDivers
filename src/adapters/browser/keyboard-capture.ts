import type { IntentSink } from "../../core";
import type { ShellIntent } from "../../presentation/shell-contracts";

export function isCanvasKeyboardCaptureAllowed(
  activeElement: Element | null,
  canvas: HTMLCanvasElement,
  event: Pick<
    KeyboardEvent,
    "altKey" | "code" | "ctrlKey" | "isComposing" | "metaKey"
  >,
): boolean {
  return (
    activeElement === canvas &&
    event.code !== "Tab" &&
    !event.isComposing &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}

export function installKeyboardCapture(
  canvas: HTMLCanvasElement,
  intents: IntentSink<ShellIntent>,
): () => void {
  const focusCanvas = (): void => {
    canvas.focus({ preventScroll: true });
  };

  const capture = (event: KeyboardEvent): void => {
    if (
      !isCanvasKeyboardCaptureAllowed(document.activeElement, canvas, event)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    intents.emit({
      type: "shell.canvas-keyboard-observed",
      code: event.code,
    });
  };

  canvas.addEventListener("pointerdown", focusCanvas);
  window.addEventListener("keydown", capture, true);

  return () => {
    canvas.removeEventListener("pointerdown", focusCanvas);
    window.removeEventListener("keydown", capture, true);
  };
}
