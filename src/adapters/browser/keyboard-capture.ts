import type { IntentSink } from "../../core";
import type { ShellIntent } from "../../presentation/shell-contracts";

export function isCanvasKeyboardCaptureAllowed(
  activeElement: Element | null,
  canvas: HTMLCanvasElement,
  event: Pick<
    KeyboardEvent,
    "altKey" | "code" | "ctrlKey" | "isComposing" | "metaKey" | "shiftKey"
  >,
): boolean {
  return (
    activeElement === canvas &&
    event.code !== "Tab" &&
    !event.isComposing &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

export function captureCanvasKeyboardEvent(
  activeElement: Element | null,
  canvas: HTMLCanvasElement,
  event: Pick<
    KeyboardEvent,
    | "altKey"
    | "code"
    | "ctrlKey"
    | "isComposing"
    | "metaKey"
    | "preventDefault"
    | "shiftKey"
    | "stopPropagation"
  >,
  intents: IntentSink<ShellIntent>,
): boolean {
  if (!isCanvasKeyboardCaptureAllowed(activeElement, canvas, event)) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  intents.emit({
    type: "shell.canvas-keyboard-observed",
    code: event.code,
  });
  return true;
}

export function installKeyboardCapture(
  canvas: HTMLCanvasElement,
  intents: IntentSink<ShellIntent>,
): () => void {
  const focusCanvas = (): void => {
    canvas.focus({ preventScroll: true });
  };

  const capture = (event: KeyboardEvent): void => {
    captureCanvasKeyboardEvent(document.activeElement, canvas, event, intents);
  };

  canvas.addEventListener("pointerdown", focusCanvas);
  window.addEventListener("keydown", capture, true);

  return () => {
    canvas.removeEventListener("pointerdown", focusCanvas);
    window.removeEventListener("keydown", capture, true);
  };
}
