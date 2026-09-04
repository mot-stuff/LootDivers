# TASK-P0-002 Browser, Performance, and Bundle Gates

**Status:** Specification complete; representative gates deferred until their
fixtures exist
**Owner:** QA Reviewer; threshold changes and waivers require Director approval
**Target tier:** Windows 10/11, four physical CPU cores, 8 GB RAM, Intel UHD
630-class integrated GPU, 1920×1080 at device-pixel ratio (DPR) 1
**Scope:** Phase 0 measurement contract only; this document does not authorize
gameplay or TASK-P0-003 implementation

## 1. Gate states

Every result must use exactly one of these states:

- **PASS:** the required fixture exists, the prescribed run completed on an
  eligible machine, and every required threshold passed.
- **FAIL:** a required run completed and one or more required thresholds failed,
  or the fixture crashed, logged an unhandled error, lost required diagnostics,
  or produced invalid samples.
- **NOT RUN:** tooling, hardware, browser, or fixture was unavailable.
- **DEFERRED:** the gate intentionally depends on a later Phase 0 task named in
  this document. `DEFERRED` is not `PASS`.
- **INELIGIBLE:** measurements were collected on a machine or configuration that
  does not match the acceptance tier. They are diagnostic only.

### Measurable now

Before TASK-P0-003 there is no browser application in the repository. The
following checks are nevertheless measurable:

1. repository/static-fixture presence;
2. machine, display, power, GPU-driver, browser, and tool metadata capture;
3. whether the machine is eligible for acceptance;
4. a no-gameplay `data:` URL browser dry run when a branded browser is locally
   available.

### Deferred representative-fixture gates

- Shell transfer and startup gates begin with TASK-P0-003's production build and
  boot page.
- Isometric terrain and zone loading measurements begin with TASK-P0-006.
- Spatial-query and path-request load begins with TASK-P0-007.
- Full actor, projectile, particle, loot, frame-time, and allocation measurements
  begin with TASK-P0-008.
- Automated context-loss and complete browser-matrix evidence begin with
  TASK-P0-012.

No placeholder page, synthetic `data:` page, or faster developer machine can
pass a deferred representative gate.

## 2. Acceptance hardware and exact metadata

Strict performance acceptance must run on a physical machine with:

- Windows 10 or Windows 11 on a supported, fully patched build;
- exactly four enabled physical CPU cores (simultaneous multithreading may be
  enabled and must be recorded);
- 8 GB installed physical RAM;
- Intel UHD Graphics 630, or an owner-approved GPU with documented evidence that
  it is no faster than the UHD 630-class target;
- the benchmark browser rendered by that integrated GPU, not a discrete GPU,
  virtual GPU, software renderer, remote desktop adapter, or compatibility
  layer;
- one 1920×1080 display at 60 Hz, Windows scaling 100%, browser zoom 100%, and
  `window.devicePixelRatio === 1`.

More capable machines may produce diagnostic reports but are `INELIGIBLE`.
Reducing process affinity, allocating less memory, underclocking, or forcing a
stronger GPU does not turn a stronger machine into the reference machine.
Virtual machines and remote-desktop sessions are not acceptance environments.

Each report must capture:

```powershell
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor
$cs = Get-CimInstance Win32_ComputerSystem
$gpu = Get-CimInstance Win32_VideoController
[pscustomobject]@{
  TimestampUtc = (Get-Date).ToUniversalTime().ToString("o")
  ComputerName = $env:COMPUTERNAME
  Manufacturer = $cs.Manufacturer
  Model = $cs.Model
  OS = $os.Caption
  OSVersion = $os.Version
  OSBuild = $os.BuildNumber
  CPU = ($cpu.Name -join "; ")
  PhysicalCores = ($cpu.NumberOfCores | Measure-Object -Sum).Sum
  LogicalProcessors = ($cpu.NumberOfLogicalProcessors | Measure-Object -Sum).Sum
  RAMBytes = $cs.TotalPhysicalMemory
  GPU = ($gpu.Name -join "; ")
  DriverVersion = ($gpu.DriverVersion -join "; ")
  DriverDate = (($gpu.DriverDate | ForEach-Object {
    $_.ToString("yyyy-MM-dd")
  }) -join "; ")
} | Format-List

powercfg /getactivescheme
Get-CimInstance Win32_VideoController |
  Select-Object Name,CurrentHorizontalResolution,
    CurrentVerticalResolution,CurrentRefreshRate
Get-NetAdapter | Where-Object Status -eq "Up" |
  Select-Object Name,InterfaceDescription,LinkSpeed
git rev-parse HEAD
git status --short
git --version
node --version
npm --version
npx playwright --version
```

Also attach screenshots or exported text from Windows Advanced display settings
showing 1920×1080, 60 Hz, and 100% scaling. Record ambient temperature when a
thermometer is available; otherwise write `not measured`. Record whether the
device is on AC power and, if sensors are available, CPU/GPU temperatures before
and after every repetition. Missing optional temperature sensors do not fail the
gate, but visible thermal throttling does.

## 3. Browser and graphics metadata

Use clean, extension-free profiles and current stable branded Google Chrome,
Microsoft Edge, and Mozilla Firefox. Record product and file versions from the
browser executable; do not record only the engine family. At release gates also
run the prior major where the vendor binary remains available.

For Chromium browsers save `chrome://version` or `edge://version` and
`chrome://gpu` or `edge://gpu`. For Firefox save `about:support`. Evidence must
include:

- full browser version and executable path;
- command-line flags;
- profile path (a disposable benchmark profile);
- graphics feature status, renderer/vendor strings, driver, and compositing
  mode;
- hardware acceleration enabled;
- WebGL 2 renderer in use and no SwiftShader/software fallback.

Record Playwright package and browser revisions from:

```powershell
npx playwright --version
npx playwright install --dry-run
```

Automated Playwright `chromium`, `firefox`, and `webkit` runs complement but do
not replace branded-browser runs. A browser auto-update during a run invalidates
the complete browser sample and requires all repetitions for that browser to be
rerun.

## 4. Controlled benchmark conditions

Before each acceptance session:

1. Install updates and drivers, then reboot. Pause update/download activity for
   the session; do not benchmark while an update is pending or installing.
2. Connect AC power. Select the Windows **Balanced** plan. Record its GUID and
   all vendor performance/battery settings. A different plan is allowed only as
   a separately reported diagnostic run.
3. Set 1920×1080, 60 Hz, 100% scaling, browser zoom 100%, and DPR 1. Disable HDR,
   variable refresh rate, screen recording, game overlays, and frame limiters.
4. Allow ten idle minutes after login. Keep vents unobstructed. If throttling or
   temperatures outside the device's normal sustained range are observed, cool
   the machine and restart the browser's complete five-run set.
5. Close IDEs, terminals not serving the artifact, launchers, sync clients,
   media, VMs, antivirus scans, and nonessential tray applications. Keep the
   local static server and one browser tab only. Record remaining processes
   with accumulated CPU time or at least 100 MB working set:

```powershell
Get-Process | Where-Object {
  $_.CPU -gt 0 -or $_.WorkingSet64 -ge 100MB
} | Sort-Object WorkingSet64 -Descending |
  Select-Object Name,Id,CPU,WorkingSet64
```

6. Use a fresh browser process and disposable profile for each repetition.
   Disable extensions, DevTools, traces, screenshots, video capture, and
   profiler recording during timed samples. Browser automation may collect the
   fixture's diagnostics after sampling ends.
7. Serve the exact production `dist` artifact over loopback HTTP. Performance
   and simulation runs operate offline after the artifact is locally available.
   Reject runs with unexpected requests, failed requests, service workers,
   background tabs, focus loss, resize, or visibility changes.

Loading is tested separately. The hard loading budgets use loopback with cache
disabled to remove internet variance; transfer-byte budgets remain authoritative.
Staging tests must report DNS, connection, TLS, TTFB, and download timing but
cannot fail the hardware gate solely because of an uncontrolled internet path.
Do not substitute DevTools' named presets. If network shaping is later required,
record exact latency, downstream, upstream, packet loss, shaping tool/version,
and calibration evidence before defining a new gate.

## 5. Deterministic representative fixture

The fixture is technical content, not gameplay. It must expose its build commit,
seed, population counts, simulation-step count, camera phase, and timings through
a test-only diagnostics API. It must reject a run if counts differ from the
contract.

Use seed `0x5EED2008` and the following exact fixture:

- one 128×128 isometric tile field, 64×32 pixel tile footprint, with four fully
  populated static terrain layers (ground, detail, low terrain, overhang) plus
  one deterministic foreground/occlusion layer covering 10% of cells;
- a fixed 1920×1080 camera following a 30-second closed path through all four
  map quadrants, repeated for the entire sample;
- 200 visible moving actor presentations with four-direction, eight-frame
  looping synthetic animation; actors follow seeded closed waypoints and simple
  local separation, never despawn, and remain distributed across the camera
  path;
- 500 live projectile simulation records and presentations moving on seeded
  straight paths; crossing a boundary wraps the projectile without allocation;
- 1,000 visible lightweight cosmetic particles with seeded positions,
  velocities, and lifetimes, maintained at exactly 1,000 through a fixed pool;
- 100 visible loot presentations with stable foot-point depth ordering;
- every simulation step: 200 actor-neighbor radius queries (radius 96 logical
  units) and 500 projectile swept-segment candidate queries against the same
  uniform spatial index;
- 20 bounded A* path requests per second, issued one request every three
  simulation steps in round-robin actor order, on a deterministic 128×128
  walkability/cost grid; each request has a 2,048-node expansion cap and reports
  completion, no-path, or budget exhaustion;
- fixed-step simulation at 60 Hz, interpolation enabled for presentation, no AI,
  combat, damage, item generation, networking, or production assets.

All visuals use committed synthetic atlases. The fixture must report atlas
count, texture memory estimate where available, visible/culled counts, draw
calls where the renderer exposes them, pool capacity/high-water marks, spatial
candidate counts, A* expansions, allocations where measurable, and JS heap
where supported. These diagnostics are report-only unless another threshold
below governs them; missing optional browser APIs must be recorded, not treated
as zero.

## 6. Warm-up, samples, and calculations

For each browser, run five repetitions in sequence. Each repetition uses a new
browser process/profile and performs:

1. load and assert production build, fixture seed, counts, WebGL2, DPR, viewport,
   renderer, and zero console/network errors;
2. warm up for 30 seconds (1,800 simulation steps); do not retain warm-up
   samples;
3. sample continuously for 120 seconds (7,200 expected simulation steps);
4. stop sampling before traces, screenshots, or report export;
5. wait two idle minutes before launching the next repetition.

Use `performance.now()` from the page. A frame interval is the difference
between consecutive `requestAnimationFrame` callback starts. Main-thread frame
work starts at the callback and ends after bounded fixed-step processing,
presentation synchronization, and renderer submission return. Report simulation,
spatial, pathfinding, presentation, render-submission, and total main-thread
work separately as well as their combined value.

Sort valid values ascending. For `N` values, p95 is the value at one-based rank
`ceil(0.95 × N)` (nearest-rank method); do not interpolate. A valid repetition
must cover at least 118 seconds, contain no visibility/focus/configuration
change, and retain at least 99% of expected rAF samples for the observed refresh
rate. Report each repetition and the pooled samples across all five; never show
only the best run.

## 7. Frame and main-thread gates

Chrome, Edge, and Firefox each must pass all of these on the eligible machine:

- pooled p95 rAF frame interval: **at most 18.0 ms**;
- each repetition p95 rAF frame interval: **at most 20.0 ms**;
- each 120-second repetition: **at least 7,080 rAF callbacks** (59 FPS mean);
- pooled p95 combined main-thread frame work: **at most 16.7 ms**;
- each repetition p95 combined main-thread frame work: **at most 18.0 ms**;
- pooled frames with interval greater than 33.4 ms: **at most 0.1%**;
- no frame interval greater than 100 ms, excluding a fixture-declared context
  loss test outside the timed sample;
- no crash, hang, unhandled page/console error, failed request, population drift,
  pool exhaustion, or unexpected software renderer.

All required conditions must pass; averaging browsers together is forbidden.
GPU timing, draw calls, heap, memory trend, and stage timing are mandatory report
fields where the browser exposes them but have no P0-002 threshold.

## 8. Fixed simulation and catch-up gate

The future fixed-step runner must use a 60 Hz step and expose counters that
distinguish executed and discarded time. Test it outside the frame sample:

1. During 10 seconds visible and focused, execute 600 steps ±1.
2. Inject a 100 ms frame gap: execute no more than five catch-up steps in one
   render turn; discard/account for excess rather than growing a backlog.
3. Inject a 5,000 ms gap: execute no more than five catch-up steps in the first
   turn and retain no backlog into the third visible render turn.
4. Hide the page for 30 seconds: execute zero gameplay steps while hidden.
5. Resume: execute no more than one normal step plus the configured catch-up
   maximum in the first turn, do not replay hidden time, and return to at most
   one-step accumulator debt by the third visible render turn.
6. Repeat hide/resume ten times. Total executed steps must equal the fixture's
   expected visible-time steps ±1 per transition, and queued commands/events
   must stay bounded.

Any unbounded replay, time-dependent population divergence, negative/discontinuous
counter, or missing discarded-time accounting is `FAIL`. This gate is
`DEFERRED` to TASK-P0-004 and automated lifecycle coverage to TASK-P0-012.

## 9. Startup, loading, and transfer budgets

Measure the exact production artifact, source maps excluded. Produce a manifest
of every initial request with path, content type, raw bytes, gzip bytes, Brotli
bytes, cache status, and initiator. Generate Brotli size with a tool pinned by
the browser toolchain, record `<tool> --version`, and use maximum quality with
the exact command `<tool> --quality=11 --output=<file>.br <file>` for each
artifact (or its documented equivalent if that pinned tool uses different
flags). Record the literal expanded command and SHA-256 of each input in the
report. The server's actual Brotli wire response must also be checked at staging
in TASK-P0-013.

Hard budgets:

- initial application-shell JavaScript + CSS + framework, all initial chunks
  summed: **≤ 1 MiB (1,048,576 bytes) Brotli**;
- total initial shell transfer including HTML, manifest, fonts, and shell icons,
  but excluding zone/game assets: **≤ 1.25 MiB Brotli**;
- any single initial JavaScript chunk: **≤ 512 KiB Brotli**;
- source maps: **0 bytes transferred** to a normal client;
- initial technical-zone bundle and its synthetic atlases: **≤ 8 MiB Brotli**;
- shell plus initial technical zone to fixture-ready: **≤ 10 MiB Brotli**;
- no future/unselected zone bundle requested before explicit zone selection.

On loopback, with cache disabled and a fresh profile, run five cold starts per
browser and report median and worst:

- navigation start to visible loading/error shell: median **≤ 1,000 ms**, worst
  **≤ 1,500 ms**;
- navigation start to WebGL2 preflight and renderer ready: median **≤ 2,000 ms**,
  worst **≤ 3,000 ms**;
- navigation start to deterministic technical fixture ready: median
  **≤ 4,000 ms**, worst **≤ 6,000 ms**.

Run five warm reloads with immutable assets cached. The shell must be visible
within **750 ms median / 1,000 ms worst**, and hashed assets must transfer zero
body bytes. Any preload that defeats zone-on-demand loading, missing compression
metadata, duplicate bytes under different URLs, or service-worker interception
fails the applicable gate.

The shell timing/bundle subset is measurable after TASK-P0-003. Technical-zone
budgets are deferred to TASK-P0-006; full fixture-ready timing is deferred to
TASK-P0-008.

## 10. WebGL2 and context loss

Every target browser must:

- obtain a real `webgl2` context before framework boot and expose renderer/vendor
  diagnostics;
- show an actionable unsupported-browser message if WebGL2 creation returns
  `null`; it must not silently use Canvas, WebGL1, or software rendering;
- call `preventDefault()` for an intentionally recoverable
  `webglcontextlost` event, pause presentation and simulation advancement, and
  prevent saves from being written from partial presentation state;
- when `WEBGL_lose_context` is available, lose the context after fixture-ready,
  hold it lost for two seconds, then restore it;
- either restore all renderer resources and resume the same domain snapshot
  within five seconds, with populations and simulation counters intact, or show
  a stable reload prompt within two seconds and reload to the last validated
  state;
- survive three loss/restore cycles without duplicate canvas/listeners, leaked
  populations, corrupt state, unhandled errors, or infinite reload.

If `WEBGL_lose_context` is unavailable, record `NOT RUN`; do not fake a pass.
Manual coverage begins with a renderer fixture; repeatable matrix artifacts are
deferred to TASK-P0-012.

## 11. Reports, pass/fail, and waivers

Commit or archive one machine-readable JSON report and one readable summary per
acceptance session. Each must include:

- task/build commit and dirty-state output;
- fixture/schema version, seed, exact populations, duration, and repetition;
- all machine, display, power, thermal, process, browser, Playwright, graphics,
  driver, server, compression, and network metadata required above;
- raw sample artifact or lossless sample attachment, per-run and pooled
  statistics, start/end UTC timestamps, and invalid-sample reasons;
- console messages, page errors, failed/unexpected requests, context-loss
  outcome, and screenshots after (not during) sampling;
- every gate marked `PASS`, `FAIL`, `NOT RUN`, `DEFERRED`, or `INELIGIBLE`.

A session passes only when all gates currently due for that task are `PASS`.
`NOT RUN`, `DEFERRED`, and `INELIGIBLE` cannot be used to claim overall Phase 0
acceptance. Reruns must preserve failed reports and explain why a rerun occurred.

A waiver must be a written Director approval that identifies the exact gate and
browser, evidence, user impact, reason remediation is not immediate, compensating
control, owner, tracking task, and expiry date or build. Waivers never rewrite
historical results and cannot silently change thresholds. An expired waiver is a
failure. Changing a numeric threshold requires a reviewed specification change
with before/after measurements on the eligible machine.

## 12. Safari and WebKit

Real macOS/Safari hardware is unavailable for the current project. Playwright
WebKit is an interim compatibility signal only and **must not be described as
Safari testing or Safari certification**. WebKit results use the same functional
expectations where supported, but are report-only for strict hardware
performance. Every Phase 0/release report must state `Real Safari: NOT RUN —
hardware unavailable` until the project obtains representative macOS hardware.
Real current-stable Safari remains a release risk and manual release check.

## 13. No-gameplay static dry run

When no repository fixture exists, do not add runtime source for P0-002. Use this
procedure:

1. Run the metadata commands in sections 2 and 3.
2. Confirm fixture absence:

```powershell
git ls-files
Test-Path package.json
Get-ChildItem -Recurse -File -Include *.html,*.js,*.ts |
  Select-Object FullName
```

3. If a branded browser exists, open this address in a fresh profile at
   1920×1080, zoom 100%. It is a transient static page, not the representative
   fixture:

```text
data:text/html,<meta charset=utf-8><canvas id=c width=1920 height=1080></canvas><pre id=o></pre><script>const g=c.getContext('webgl2');let a=[],p=performance.now();function f(n){let q=performance.now();a.push(q-p);p=q;if(n<600)return requestAnimationFrame(()=>f(n+1));a.sort((x,y)=>x-y);o.textContent=JSON.stringify({ua:navigator.userAgent,dpr:devicePixelRatio,inner:[innerWidth,innerHeight],webgl2:!!g,renderer:g&&g.getParameter(g.RENDERER),samples:a.length,p95:a[Math.ceil(.95*a.length)-1]},null,2)}requestAnimationFrame(()=>f(0))</script>
```

4. Wait for 601 callbacks and save the displayed JSON plus browser graphics
   diagnostics. Mark frame values `INELIGIBLE/diagnostic`: a static page does
   not contain the required workload and cannot pass performance.
5. If no browser executable is available, record `NOT RUN` and the discovery
   commands/output. Do not install TASK-P0-003 tooling as part of this task.

## 14. P0-002 dry-run evidence — 2026-09-04

The machine-readable session report is archived at
[`reports/TASK-P0-002/2026-09-04-dry-run.json`](../reports/TASK-P0-002/2026-09-04-dry-run.json).
It records unavailable fields as `null` with limitations and does not claim that
raw terminal output, samples, traces, or screenshots were retained.

Repository commit before this specification: `de11c54` (`TASK-P0-001: Restore
canonical project documentation`). The worktree was clean before editing.

Fixture discovery found no `package.json`, HTML, JavaScript, TypeScript, Vite, or
Playwright project. `README.md` explicitly states that the repository contains
only documentation and governance until TASK-P0-003. Therefore all runtime,
bundle, loading, frame, simulation, and context-loss gates are `DEFERRED`, not
passed.

Machine capture returned:

- computer `NE-299202512`, Micro-Star International `MS-7E71`;
- Windows 11 Home `10.0.26200`, build `26200`;
- AMD Ryzen 7 9800X3D, 8 physical cores / 16 logical processors;
- 33,346,146,304 bytes RAM;
- NVIDIA GeForce RTX 5070 Ti, driver `32.0.16.1088` dated 2026-07-21;
- secondary AMD Radeon Graphics, driver `32.0.21030.2001` dated 2025-09-24;
- 1920×1080 at 74 Hz reported on the NVIDIA adapter;
- active Balanced power plan,
  `381b4222-f694-41f0-9685-ff5bb260df2e`;
- active Realtek Ethernet at 1 Gbps plus two active VMware virtual adapters;
- Windows time zone `Central Standard Time`;
- PowerShell `5.1.26100.9168`, Git `2.54.0.windows.1`, Node `v22.22.0`;
- `npm` and `npx` were not available on `PATH`;
- Microsoft Edge `152.0.4191.62` was present at
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
- Mozilla Firefox `154.0` was present at
  `C:\Program Files\Mozilla Firefox\firefox.exe`;
- Google Chrome was not found in the checked user-local, Program Files, command,
  or registered App Paths locations.

This machine is `INELIGIBLE` because CPU core count, RAM, GPU class, and refresh
rate exceed/differ from the target. An Edge headless transient static probe used
a fresh temporary profile, 1920×1080 window argument, forced DPR 1, and no
extensions. It reported Edge UA `152.0.0.0`, DPR 1, visible state, inner viewport
1896×988, WebGL2 available, and generic renderer `WebKit WebGL`; it also emitted
two `GPU state invalid after WaitForGetOffsetInRange` errors. The 601-callback
rAF probe remained at `waiting` under headless virtual time, so no static p95 was
recorded. Result: `INELIGIBLE/diagnostic` for WebGL2 availability and `NOT RUN`
for static frame p95. Firefox was version-captured but not manually exercised.
This is an honest procedure dry run only; it provides no RARPG performance
evidence.
