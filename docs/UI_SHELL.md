# TASK-P0-011 UI Shell

**Status:** Implemented with synthetic diagnostics only
**Decision basis:** Active DEC-009, DEC-010, and DEC-015; no new ADR required

## Boundary

The technical shell renders Preact DOM around a Phaser canvas. Core exports only
two generic contracts:

- `ReadModelSource<T>` exposes a current read-only snapshot and subscription.
- `IntentSink<T>` accepts typed requested actions.

The Preact component receives those two capabilities through `ShellBindings`.
It has no core runtime, command queue, state publisher, or mutation callback.
The composition root handles synthetic shell intents and publishes replacement
read models. These fixtures do not represent gameplay.

The current technical intent vocabulary covers a diagnostic request, renderer
retry request, and an observed canvas keyboard event. It must not be expanded
into gameplay behavior as part of Phase 0.

## Focus and accessibility

The canvas is keyboard-focusable, labelled, and described by visible keyboard
instructions. Window-level keyboard capture accepts an event only while the
canvas itself is `document.activeElement`. It ignores composing events, `Tab`,
and every shifted or modifier-key sequence. This includes the modifier keydown
that occurs before `Shift+Tab`, so focus navigation emits no canvas intent
before focus leaves. Focus on a DOM control cannot reach the canvas input sink.

The shell includes:

- a keyboard-visible skip link;
- semantic heading, diagnostic list, renderer region, buttons, and output;
- one polite loading status or one assertive error alert, without a duplicate
  live-region summary;
- visible focus indicators;
- actionable WebGL2 failure guidance and retry intent;
- no color-only loading or error message.

## Resize and DPR

The canvas host keeps a 16:9 technical viewport. A `ResizeObserver` and window
resize listener measure its CSS content box. The canvas backing store uses
`round(css pixels × devicePixelRatio)`, while its CSS size remains in logical
pixels. Invalid or transient zero measurements use a safe minimum. Phaser's
scale manager is updated before the CSS size is restored.

Automated coverage checks 1024×768, 1280×720, and 1920×1080 desktop viewports,
horizontal overflow, canvas/host alignment, and DPR 1 and 2 backing stores.

## Manual keyboard review

Run this review against the production build with browser zoom at 100%:

1. Press `Tab` from the address bar. Confirm the skip link is visible and moves
   focus past the canvas controls when activated.
2. Continue with `Tab` and `Shift+Tab`. Confirm every shell button has a visible
   focus indicator and the order follows the document.
3. Focus **Send diagnostic intent**, press `W`, then `Space`. Confirm `W` does
   not increase **Canvas keys**, while `Space` activates the button once.
4. Focus the canvas and press `W`. Confirm **Canvas keys** increments once.
5. Press `Shift+Tab` from the canvas. Confirm neither **Intents** nor **Canvas
   keys** increments before focus moves to the skip link. Repeat with `Tab`
   toward the diagnostic button, then press `W` and confirm both counts remain
   unchanged.
6. Force or encounter WebGL2 failure. Confirm the error is announced, all
   guidance is readable, and **Retry renderer** is keyboard operable.
7. Repeat at 1024×768 and 1920×1080. Confirm no horizontal scrolling, clipping,
   or hidden focused control.

**Execution record, 2026-09-04:** NOT RUN as a human manual review. The agent
environment can execute automated keyboard behavior but cannot honestly certify
visual focus appearance, assistive-technology announcements, or human keyboard
usability. The equivalent Chromium behavioral assertions passed in Playwright.

## Commands

Use the pinned bootstrap described in `TOOLING.md`, then run:

```powershell
& $npm run format:check
& $npm run lint
& $npm run typecheck
& $npm test
& $npm run test:component
& $npm run content:check
& $npm run build
& $npm run budget
& $npm run test:smoke
```

`test:component` uses Vitest Browser Mode with the pinned Playwright Chromium
provider for Preact component tests. The consolidated `test:browser` command
runs that gate plus the configured Playwright matrix. `test:smoke` serves the
exact `dist` artifact and includes focus, resize, DPR, startup, console, and
network checks.

## Limitations

- Real Safari is NOT RUN because macOS/Safari hardware is unavailable.
  Playwright WebKit is deferred to TASK-P0-012 and is not Safari certification.
- Branded Chrome, Edge, Firefox, and WebKit coverage belongs to TASK-P0-012.
- This machine is not the P0-002 minimum reference hardware; no strict
  performance acceptance is claimed.
- HUD, inventory, abilities, vendors, visual identity, gameplay, and Phase 1
  behavior are intentionally absent.
