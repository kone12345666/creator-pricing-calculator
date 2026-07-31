import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["scripts/feishu-sync-server.mjs"], {
    stdio: "inherit",
  }),
  spawn("npm", ["run", "dev:site"], {
    stdio: "inherit",
  }),
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
