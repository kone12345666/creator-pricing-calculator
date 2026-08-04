import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(
  root,
  "node_modules",
  "vinext",
  "dist",
  "server",
  "static-file-cache.js",
);

const marker =
  'for (const [rawRelativePath, fileInfo] of allFiles) {\n\t\t\tconst relativePath = rawRelativePath.replace(/\\\\/g, "/");';

let source;
try {
  source = readFileSync(target, "utf8");
} catch {
  process.exit(0);
}

if (source.includes(marker)) {
  process.exit(0);
}

const original =
  "\t\tfor (const [relativePath, fileInfo] of allFiles) {\n\t\t\tif (relativePath.endsWith(\".br\") || relativePath.endsWith(\".gz\") || relativePath.endsWith(\".zst\")) continue;";

const patched =
  '\t\tfor (const [rawRelativePath, fileInfo] of allFiles) {\n\t\t\tconst relativePath = rawRelativePath.replace(/\\\\/g, "/");\n\t\t\tif (relativePath.endsWith(".br") || relativePath.endsWith(".gz") || relativePath.endsWith(".zst")) continue;';

if (!source.includes(original)) {
  process.stderr.write(
    "[patch-vinext-windows] vinext static-file-cache.js format changed; skip patch\n",
  );
  process.exit(0);
}

writeFileSync(target, source.replace(original, patched), "utf8");
process.stdout.write(
  "[patch-vinext-windows] applied Windows static asset path fix\n",
);
