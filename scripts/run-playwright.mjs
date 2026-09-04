import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import process from "node:process";

function allocateLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a loopback preview port."));
        return;
      }
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

const port = await allocateLoopbackPort();
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");
const child = spawn(
  process.execPath,
  [playwrightCli, "test", ...process.argv.slice(2)],
  {
    env: {
      ...process.env,
      RARPG_PLAYWRIGHT_PORT: String(port),
    },
    stdio: "inherit",
  },
);

child.once("error", (error) => {
  throw error;
});
child.once("exit", (code, signal) => {
  if (signal !== null) {
    console.error(`Playwright terminated by signal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
