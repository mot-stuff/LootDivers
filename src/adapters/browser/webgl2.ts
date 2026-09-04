export type WebGL2Support =
  | {
      readonly supported: true;
      readonly context: WebGL2RenderingContext;
      readonly version: string;
    }
  | {
      readonly supported: false;
      readonly reason: string;
    };

const contextAttributes: WebGLContextAttributes = {
  alpha: false,
  antialias: true,
  depth: true,
  powerPreference: "high-performance",
};

export function preflightWebGL2(canvas: HTMLCanvasElement): WebGL2Support {
  try {
    const context = canvas.getContext("webgl2", contextAttributes);

    if (context === null) {
      return {
        supported: false,
        reason: "This browser could not create the required WebGL2 context.",
      };
    }

    return {
      supported: true,
      context,
      version: String(context.getParameter(context.VERSION)),
    };
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : "unknown browser error";

    return {
      supported: false,
      reason: `WebGL2 initialization failed: ${detail}`,
    };
  }
}

export function assertWebGL2Context(canvas: HTMLCanvasElement): string {
  const context = canvas.getContext("webgl2");

  if (context === null) {
    throw new Error("Phaser booted without the required WebGL2 context.");
  }

  const version = String(context.getParameter(context.VERSION));

  if (!version.startsWith("WebGL 2")) {
    throw new Error(
      `Expected WebGL 2 after Phaser boot, received "${version}".`,
    );
  }

  return version;
}
