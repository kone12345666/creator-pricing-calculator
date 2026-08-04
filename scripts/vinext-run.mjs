<<<<<<< HEAD
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  spawnSync(process.execPath, ["scripts/patch-vinext-windows.mjs"], {
    stdio: "inherit",
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  });
}

const command = process.argv[2];
const supported = new Set(["build", "start", "dev"]);

if (!command || !supported.has(command)) {
  process.stderr.write(
    "Usage: node scripts/vinext-run.mjs <build|start|dev> [vinext args...]\n",
  );
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vinextCli = resolve(root, "node_modules", "vinext", "dist", "cli.js");
const vinextArgs = [vinextCli, command, ...process.argv.slice(3)];

process.env.WRANGLER_LOG_PATH ??= ".wrangler/wrangler.log";

function reportSpawnError(error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

if (command === "build") {
  const result = spawnSync(process.execPath, vinextArgs, {
    stdio: "inherit",
    env: process.env,
    cwd: root,
  });

  if (result.error) reportSpawnError(result.error);
  process.exit(result.status ?? 1);
}

const child = spawn(process.execPath, vinextArgs, {
  stdio: "inherit",
  env: process.env,
  cwd: root,
});

child.on("error", reportSpawnError);

function forwardSignal(signal) {
  if (!child.killed) child.kill(signal);
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
=======
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  spawnSync(process.execPath, ["scripts/patch-vinext-windows.mjs"], {
    stdio: "inherit",
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  });
}

const command = process.argv[2];
const supported = new Set(["build", "start", "dev"]);

if (!command || !supported.has(command)) {
  process.stderr.write(
    "Usage: node scripts/vinext-run.mjs <build|start|dev> [vinext args...]\n",
  );
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vinextCli = resolve(root, "node_modules", "vinext", "dist", "cli.js");
const vinextArgs = [vinextCli, command, ...process.argv.slice(3)];

process.env.WRANGLER_LOG_PATH ??= ".wrangler/wrangler.log";

function reportSpawnError(error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

if (command === "build") {
  const result = spawnSync(process.execPath, vinextArgs, {
    stdio: "inherit",
    env: process.env,
    cwd: root,
  });

  if (result.error) reportSpawnError(result.error);
  process.exit(result.status ?? 1);
}

const child = spawn(process.execPath, vinextArgs, {
  stdio: "inherit",
  env: process.env,
  cwd: root,
});

child.on("error", reportSpawnError);

function forwardSignal(signal) {
  if (!child.killed) child.kill(signal);
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
>>>>>>> 84daeb15b3733bd91c34b98bdac9dbd8028e4e4a
