import type { CanvasViewportReadModel } from "../../presentation/shell-contracts";

const MINIMUM_CANVAS_DIMENSION = 1;

export function measureCanvasViewport(
  host: Pick<HTMLElement, "clientHeight" | "clientWidth">,
  devicePixelRatio: number,
): CanvasViewportReadModel {
  const cssWidth = Math.max(MINIMUM_CANVAS_DIMENSION, host.clientWidth);
  const cssHeight = Math.max(MINIMUM_CANVAS_DIMENSION, host.clientHeight);
  const safeDpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;

  return {
    cssWidth,
    cssHeight,
    backingWidth: Math.max(
      MINIMUM_CANVAS_DIMENSION,
      Math.round(cssWidth * safeDpr),
    ),
    backingHeight: Math.max(
      MINIMUM_CANVAS_DIMENSION,
      Math.round(cssHeight * safeDpr),
    ),
    devicePixelRatio: safeDpr,
  };
}

export function applyCanvasViewport(
  canvas: HTMLCanvasElement,
  viewport: CanvasViewportReadModel,
): void {
  if (canvas.width !== viewport.backingWidth) {
    canvas.width = viewport.backingWidth;
  }
  if (canvas.height !== viewport.backingHeight) {
    canvas.height = viewport.backingHeight;
  }
  canvas.style.width = `${viewport.cssWidth}px`;
  canvas.style.height = `${viewport.cssHeight}px`;
}

export function observeCanvasViewport(
  host: HTMLElement,
  onResize: (viewport: CanvasViewportReadModel) => void,
): () => void {
  let previousKey = "";

  const measure = (): void => {
    const viewport = measureCanvasViewport(host, window.devicePixelRatio);
    const key = [
      viewport.cssWidth,
      viewport.cssHeight,
      viewport.backingWidth,
      viewport.backingHeight,
      viewport.devicePixelRatio,
    ].join(":");

    if (key !== previousKey) {
      previousKey = key;
      onResize(viewport);
    }
  };

  const observer = new ResizeObserver(measure);
  observer.observe(host);
  window.addEventListener("resize", measure);
  measure();

  return () => {
    observer.disconnect();
    window.removeEventListener("resize", measure);
  };
}
