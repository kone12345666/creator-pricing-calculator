"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const APP_TITLE = "达人报价测算器";
const DEFAULT_SITE_PORT = 3000;
const DEFAULT_SYNC_PORT = 3001;
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 13;

function parseArgs(argv) {
  const flags = new Set();
  for (const arg of argv) {
    if (arg.startsWith("--")) flags.add(arg);
  }
  return {
    prod: flags.has("--prod"),
    noBrowser: flags.has("--no-browser"),
    help: flags.has("--help") || flags.has("-h"),
  };
}

function isPackaged() {
  return Boolean(process.pkg);
}

function resolveNodeBinary() {
  if (isPackaged()) {
    return "node";
  }
  return process.execPath;
}

function resolveProjectRoot() {
  const candidates = [
    process.env.CREATOR_PRICING_ROOT,
    path.dirname(process.execPath),
    path.resolve(__dirname, "../.."),
    process.cwd(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (fs.existsSync(path.join(root, "package.json"))) {
      return root;
    }
  }

  throw new Error(
    "未找到项目根目录。请将启动器放在仓库根目录，或设置 CREATOR_PRICING_ROOT。",
  );
}

function pause(message = "按 Enter 键退出…") {
  return new Promise((resolve) => {
    process.stdout.write(`\n${message}`);
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
}

function log(message) {
  process.stdout.write(`[${APP_TITLE}] ${message}\n`);
}

function fail(message, code = 1) {
  process.stderr.write(`[${APP_TITLE}] 错误：${message}\n`);
  return code;
}

function commandExists(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

function readNodeVersion(nodeBinary = resolveNodeBinary()) {
  const result = spawnSync(nodeBinary, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    shell: isPackaged() && process.platform === "win32",
  });
  const match = /^v(\d+)\.(\d+)\./.exec(result.stdout ?? "");
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function assertNodeVersion() {
  const nodeBinary = resolveNodeBinary();
  if (isPackaged() && !commandExists(nodeBinary)) {
    throw new Error(
      "未找到系统 Node.js。exe 启动器需要 Node.js 22.13+ 已安装并加入 PATH。",
    );
  }

  const version = readNodeVersion(nodeBinary);
  if (!version) {
    throw new Error("无法识别 Node.js 版本，请安装 Node.js 22.13 或更高版本。");
  }
  if (
    version.major < MIN_NODE_MAJOR ||
    (version.major === MIN_NODE_MAJOR && version.minor < MIN_NODE_MINOR)
  ) {
    throw new Error(
      `当前 Node.js 版本过低（需要 >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}）。`,
    );
  }
}

function assertDependencies(root) {
  if (!fs.existsSync(path.join(root, "node_modules"))) {
    throw new Error("依赖尚未安装，请先在项目目录执行：npm ci");
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function waitForPort(port, host = "127.0.0.1", timeoutMs = 120_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    function attempt() {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`等待 ${host}:${port} 超时`));
        return;
      }

      const socket = net.connect({ port, host });
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        setTimeout(attempt, 500);
      });
    }

    attempt();
  });
}

function openBrowser(url) {
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }

  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "linux"
        ? "xdg-open"
        : null;
  if (!opener) return;

  spawn(opener, [url], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

function spawnService(root, command, args, label, shell = false) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: false,
    shell,
  });

  child.on("error", (error) => {
    process.stderr.write(`[${APP_TITLE}] 无法启动 ${label}：${error.message}\n`);
  });

  return child;
}

async function startDevelopment(root) {
  log("正在启动开发模式（页面 + 飞书同步服务）…");
  const nodeBinary = resolveNodeBinary();
  return spawnService(
    root,
    nodeBinary,
    [
      "--env-file-if-exists=.env.local",
      "--env-file-if-exists=.env",
      "scripts/dev.mjs",
    ],
    "开发服务",
    isPackaged() && process.platform === "win32",
  );
}

async function startProduction(root) {
  if (!fs.existsSync(path.join(root, "dist"))) {
    throw new Error("未找到 dist 目录，请先执行：npm run build");
  }

  log("正在启动生产模式（页面 + 飞书同步服务）…");
  const nodeBinary = resolveNodeBinary();
  const useShell = isPackaged() && process.platform === "win32";
  const syncChild = spawnService(
    root,
    nodeBinary,
    [
      "--env-file-if-exists=.env.local",
      "--env-file-if-exists=.env",
      "scripts/feishu-sync-server.mjs",
    ],
    "飞书同步服务",
    useShell,
  );
  const siteChild = spawnService(
    root,
    npmCommand(),
    ["run", "start"],
    "页面服务",
    useShell,
  );
  return [syncChild, siteChild];
}

function attachShutdown(children) {
  let stopping = false;

  function stop(signal = "SIGTERM") {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      if (child && !child.killed) child.kill(signal);
    }
  }

  for (const child of children) {
    child.on("exit", (code) => {
      if (!stopping && code && code !== 0) process.exitCode = code;
      stop();
    });
  }

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

function printHelp() {
  process.stdout.write(`\
${APP_TITLE} Windows 启动器

用法：
  start-windows.cmd
  node scripts/windows/launcher.cjs
  dist/start-calculator.exe

选项：
  --prod        启动生产模式（需先 npm run build）
  --no-browser  启动后不自动打开浏览器
  --help        显示帮助

环境变量：
  CREATOR_PRICING_ROOT  指定项目根目录
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (process.platform === "win32") {
    try {
      process.stdout.write("\u001b]0;" + APP_TITLE + "\u0007");
    } catch {
      // ignore unsupported terminals
    }
  }

  log("正在检查运行环境…");

  const root = resolveProjectRoot();
  process.chdir(root);
  log(`项目目录：${root}`);

  assertNodeVersion();
  if (!commandExists(npmCommand())) {
    throw new Error("未找到 npm，请安装 Node.js 并确保 npm 在 PATH 中。");
  }
  assertDependencies(root);

  if (process.platform === "win32") {
    spawnSync(resolveNodeBinary(), ["scripts/patch-vinext-windows.mjs"], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      shell: isPackaged(),
    });
  }

  const sitePort = Number(process.env.SITE_PORT ?? DEFAULT_SITE_PORT);
  const syncPort = Number(process.env.SYNC_PORT ?? DEFAULT_SYNC_PORT);
  const siteUrl =
    process.env.SITE_URL ?? `http://127.0.0.1:${sitePort}`;

  const children = options.prod
    ? await startProduction(root)
    : [await startDevelopment(root)];
  attachShutdown(children);

  if (!options.noBrowser) {
    log(`等待页面服务就绪（${siteUrl}）…`);
    waitForPort(sitePort)
      .then(() => {
        log(`正在打开浏览器：${siteUrl}`);
        openBrowser(siteUrl);
        log(`飞书同步服务默认端口：${syncPort}`);
        log("关闭此窗口将停止所有服务。");
      })
      .catch((error) => {
        process.stderr.write(
          `[${APP_TITLE}] 页面服务可能尚未就绪：${error.message}\n`,
        );
      });
  } else {
    log("已跳过自动打开浏览器。");
  }
}

main().catch(async (error) => {
  fail(error instanceof Error ? error.message : String(error));
  if (process.platform === "win32" && process.stdin.isTTY) {
    await pause();
  }
  process.exit(1);
});
