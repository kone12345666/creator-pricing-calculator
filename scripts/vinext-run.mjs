import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
const supported = new Set(["build", "start", "dev"]);

if (!command || !supported.has(command)) {
  process.stderr.write(
    "Usage: node scripts/vinext-run.mjs <build|start|dev> [vinext args...]\n",
  );
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vinextBin = resolve(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vinext.cmd" : "vinext",
);

process.env.WRANGLER_LOG_PATH ??= ".wrangler/wrangler.log";

const result = spawnSync(
  vinextBin,
  [command, ...process.argv.slice(3)],
  {
    stdio: "inherit",
    env: process.env,
    cwd: root,
  },
);

process.exit(result.status ?? 1);
