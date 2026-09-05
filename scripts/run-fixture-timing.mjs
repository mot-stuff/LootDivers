import { spawn } from "node:child_process";

function value(name, fallback) {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
}

const child = spawn(
  process.execPath,
  [
    "scripts/run-playwright.mjs",
    "tests/e2e/entity-lifecycle-performance.spec.ts",
    "--project=chromium",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      RARPG_PERFORMANCE_DIAGNOSTIC: "1",
      RARPG_PERFORMANCE_WARMUP_SECONDS: value("warmup-seconds", "30"),
      RARPG_PERFORMANCE_SAMPLE_SECONDS: value("sample-seconds", "120"),
    },
  },
);

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
