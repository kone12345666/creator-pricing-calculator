import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const distDir = resolve(root, "dist");
const entry = resolve(root, "scripts/windows/launcher.cjs");
const output = resolve(distDir, "start-calculator.exe");

mkdirSync(distDir, { recursive: true });

const pkgArgs = [
  entry,
  "--targets",
  "node22-win-x64",
  "--output",
  output,
  "--compress",
  "GZip",
];

process.stdout.write("[build-exe] 正在打包 Windows 启动器…\n");

const result = spawnSync("npx", ["--yes", "@yao-pkg/pkg", ...pkgArgs], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

if (result.error) {
  process.stderr.write(`[build-exe] 失败：${result.error.message}\n`);
  process.exit(1);
}

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

process.stdout.write(`[build-exe] 已生成：${output}\n`);
process.stdout.write(
  "[build-exe] 请将 start-calculator.exe 复制到项目根目录后双击运行。\n",
);
