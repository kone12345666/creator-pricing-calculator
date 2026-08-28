import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFileArgs = ["--env-file-if-exists=.env"];

function spawnService(args, label) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: false,
  });

  child.on("error", (error) => {
    process.stderr.write(`[dev] 无法启动 ${label}：${error.message}\n`);
    if (error.code === "ENOENT" && process.platform === "win32") {
      process.stderr.write(
        "[dev] Windows 提示：请确认 Node.js 已安装并已加入 PATH。\n",
      );
    }
    process.exit(1);
  });

  return child;
}

const children = [
  spawnService(
    [...envFileArgs, "scripts/feishu-sync-server.mjs"],
    "飞书同步服务",
  ),
  spawnService(["scripts/vinext-run.mjs", "dev"], "页面服务"),
];

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => {
    if (!child.killed) child.kill(signal);
  });
}

children.forEach((child) => {
  child.on("exit", (code) => {
    if (!stopping && code && code !== 0) process.exitCode = code;
    stop();
  });
});

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
