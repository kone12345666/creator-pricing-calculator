import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PAYLOAD_DIR_NAME = ".feishu-sync-tmp";
const PAYLOAD_DIR = join(PROJECT_ROOT, PAYLOAD_DIR_NAME);
const HOST = process.env.SYNC_HOST ?? "127.0.0.1";
const PORT = Number(process.env.SYNC_PORT ?? 3001);
const BASE_TOKEN = process.env.FEISHU_BASE_TOKEN ?? "";
const PROJECT_TABLE_ID = process.env.FEISHU_PROJECT_TABLE_ID ?? "";
const CREATOR_TABLE_ID = process.env.FEISHU_CREATOR_TABLE_ID ?? "";
const BASE_URL = process.env.FEISHU_BASE_URL ?? "";
const ALLOWED_ORIGINS = (
  process.env.SYNC_ALLOWED_ORIGIN ?? "http://localhost:3000"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function resolveCorsOrigin(request) {
  const origin = request.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  return ALLOWED_ORIGINS[0] ?? "http://localhost:3000";
}
const LARK_IDENTITY = process.env.LARK_IDENTITY ?? "user";
const LARK_PROFILE = process.env.LARK_PROFILE?.trim() ?? "";
const DEFAULT_LARK_CLI =
  process.platform === "win32"
    ? `${process.env.APPDATA ?? ""}\\npm\\lark-cli.cmd`
    : `${homedir()}/.local/bin/lark-cli`;
const LARK_CLI = process.env.LARK_CLI_PATH?.trim() || DEFAULT_LARK_CLI;
const LARK_CLI_USE_SHELL =
  process.platform === "win32" && /\.(cmd|bat)$/i.test(LARK_CLI);

let payloadDirReady;
let tempFileCounter = 0;

async function ensurePayloadDir() {
  if (!payloadDirReady) {
    payloadDirReady = mkdir(PAYLOAD_DIR, { recursive: true });
  }
  await payloadDirReady;
}

async function writeTempJson(value) {
  await ensurePayloadDir();
  const fileName = `payload-${process.pid}-${++tempFileCounter}.json`;
  const content = typeof value === "string" ? value : JSON.stringify(value);
  await writeFile(join(PAYLOAD_DIR, fileName), content, "utf8");
  return `./${PAYLOAD_DIR_NAME}/${fileName}`;
}

function jsonFileArg(relativePath) {
  return `@${relativePath.replace(/\\/g, "/")}`;
}

function ensureFeishuConfig() {
  const missing = [
    ["FEISHU_BASE_TOKEN", BASE_TOKEN],
    ["FEISHU_PROJECT_TABLE_ID", PROJECT_TABLE_ID],
    ["FEISHU_CREATOR_TABLE_ID", CREATOR_TABLE_ID],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`飞书同步尚未配置：缺少 ${missing.join("、")}`);
  }
}

const projectFields = [
  "项目名称",
  "项目编号",
  "客户名称",
  "保量成本CPM",
  "默认客户CPM",
  "默认目标毛利率",
  "报价取整方式",
  "税费口径",
  "项目状态",
];

const creatorFields = [
  "达人名称",
  "抖音号",
  "所属项目",
  "采买成本",
  "当前报价",
  "客户CPM",
  "预计自然播放",
  "其他成本",
  "目标毛利率",
  "是否参与计算",
  "备注",
  "KPI播放量",
  "保量成本",
  "总成本",
  "实际毛利率",
  "最高可承受采买成本",
  "风险状态",
];

const projectWriteFields = {
  guaranteeCpm: "保量成本CPM",
  clientCpm: "默认客户CPM",
  defaultMargin: "默认目标毛利率",
  rounding: "报价取整方式",
};

const creatorWriteFields = {
  name: "达人名称",
  douyinId: "抖音号",
  purchaseCost: "采买成本",
  currentPrice: "当前报价",
  customerCpm: "客户CPM",
  organicViews: "预计自然播放",
  otherCost: "其他成本",
  margin: "目标毛利率",
  kpiViews: "KPI播放量",
  guaranteeCost: "保量成本",
  totalCost: "总成本",
  actualMargin: "实际毛利率",
  maxPurchaseCost: "最高可承受采买成本",
  riskStatus: "风险状态",
};

async function runLark(args) {
  try {
    const profileArgs = LARK_PROFILE ? ["--profile", LARK_PROFILE] : [];
    const { stdout } = await execFileAsync(
      LARK_CLI,
      [...profileArgs, ...args],
      {
        maxBuffer: 20 * 1024 * 1024,
        shell: LARK_CLI_USE_SHELL,
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
          LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
        },
      },
    );
    const parsed = JSON.parse(stdout);
    if (!parsed.ok) throw new Error(parsed.error?.message ?? "飞书操作失败");
    return parsed.data;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "EINVAL" || error.code === "ENOENT")
    ) {
      throw new Error(
        `无法执行 lark-cli（${LARK_CLI}）。请确认 LARK_CLI_PATH 指向 lark-cli.cmd 的完整路径，且 LARK_PROFILE 与 lark-cli config show 中的 profile 一致。`,
      );
    }
    const stderr = error && typeof error === "object" ? error.stderr : null;
    if (typeof stderr === "string" && stderr.trim()) {
      try {
        const parsed = JSON.parse(stderr);
        throw new Error(parsed.error?.message ?? "飞书操作失败");
      } catch (parsedError) {
        if (
          parsedError instanceof Error &&
          parsedError.message !== "飞书操作失败"
        ) {
          throw parsedError;
        }
      }
    }
    throw error;
  }
}

async function listRecords({ tableId, fields, filter }) {
  ensureFeishuConfig();
  const rows = [];
  const recordIds = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const filterArgs = filter
      ? [
          "--filter-json",
          jsonFileArg(await writeTempJson(filter)),
        ]
      : [];
    const args = [
      "base",
      "+record-list",
      "--base-token",
      BASE_TOKEN,
      "--table-id",
      tableId,
      ...fields.flatMap((field) => ["--field-id", field]),
      ...filterArgs,
      "--offset",
      String(offset),
      "--limit",
      "200",
      "--format",
      "json",
      "--as",
      LARK_IDENTITY,
    ];
    const result = await runLark(args);
    rows.push(...(result.data ?? []));
    recordIds.push(...(result.record_id_list ?? []));
    hasMore = Boolean(result.has_more);
    offset += result.data?.length ?? 0;
    if (hasMore && !result.data?.length) break;
  }

  return { rows, recordIds };
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function numberOr(value, fallback) {
  return hasValue(value) && Number.isFinite(Number(value))
    ? Number(value)
    : fallback;
}

function percentOr(value, fallback) {
  if (!hasValue(value) || !Number.isFinite(Number(value))) return fallback;
  const number = Number(value);
  return number <= 1 ? number * 100 : number;
}

function roundingMode(value) {
  const normalized = String(firstValue(value) ?? "");
  if (normalized.includes("千")) return "thousand";
  if (normalized.includes("百")) return "hundred";
  return "none";
}

async function readProject(projectName, includeAllCreators = false) {
  const projectFilter = JSON.stringify({
    logic: "and",
    conditions: [["项目名称", "==", projectName]],
  });
  const projectResult = await listRecords({
    tableId: PROJECT_TABLE_ID,
    fields: projectFields,
    filter: projectFilter,
  });
  const projectRow = projectResult.rows[0];
  const projectRecordId = projectResult.recordIds[0];
  if (!projectRow || !projectRecordId) {
    throw new Error(`未找到项目“${projectName}”`);
  }

  const settings = {
    guaranteeCpm: numberOr(projectRow[3], 0),
    clientCpm: numberOr(projectRow[4], 0),
    defaultMargin: percentOr(projectRow[5], 0),
    rounding: roundingMode(projectRow[6]),
  };

  const creatorFilter = JSON.stringify({
    logic: "and",
    conditions: [
      ["所属项目", "intersects", [{ id: projectRecordId }]],
    ],
  });
  const creatorResult = await listRecords({
    tableId: CREATOR_TABLE_ID,
    fields: creatorFields,
    filter: creatorFilter,
  });
  const allCreators = creatorResult.rows.map((row, index) => ({
    recordId: creatorResult.recordIds[index] ?? `row-${index + 1}`,
    name: String(row[0] ?? ""),
    douyinId: String(row[1] ?? ""),
    purchaseCost: numberOr(row[3], 0),
    currentPrice: numberOr(row[4], 0),
    customerCpm: numberOr(row[5], settings.clientCpm),
    organicViews: numberOr(row[6], 0),
    otherCost: numberOr(row[7], 0),
    margin: percentOr(row[8], settings.defaultMargin),
    included: row[9] !== false,
    note: String(row[10] ?? ""),
    kpiViews: numberOr(row[11], 0),
    guaranteeCost: numberOr(row[12], 0),
    totalCost: numberOr(row[13], 0),
    actualMargin: percentOr(row[14], 0),
    maxPurchaseCost: numberOr(row[15], 0),
    riskStatus: String(firstValue(row[16]) ?? ""),
  }));
  const creators = allCreators.filter((creator) => creator.included);

  return {
    recordId: projectRecordId,
    name: String(projectRow[0] ?? projectName),
    code: String(projectRow[1] ?? ""),
    clientName: String(projectRow[2] ?? ""),
    taxBasis: String(firstValue(projectRow[7]) ?? ""),
    status: String(firstValue(projectRow[8]) ?? ""),
    sourceUrl: BASE_URL,
    syncedAt: new Date().toISOString(),
    hiddenCreatorCount: allCreators.length - creators.length,
    settings,
    creators,
    ...(includeAllCreators ? { allCreators } : {}),
  };
}

async function readProjects() {
  const result = await listRecords({
    tableId: PROJECT_TABLE_ID,
    fields: projectFields,
  });
  return result.rows
    .map((row, index) => ({
      recordId: result.recordIds[index],
      name: String(row[0] ?? ""),
      code: String(row[1] ?? ""),
      clientName: String(row[2] ?? ""),
      status: String(firstValue(row[8]) ?? ""),
    }))
    .filter((project) => project.recordId && project.name);
}

function comparable(value) {
  if (typeof value === "number") return Math.round(value * 1000000) / 1000000;
  return value ?? "";
}

function normalizeDouyinId(value) {
  return String(value ?? "").trim().toLowerCase();
}

function writeCellValue(field, value) {
  if (
    field === "defaultMargin" ||
    field === "margin" ||
    field === "actualMargin"
  ) {
    return Number(value) / 100;
  }
  if (field === "rounding") {
    return value === "thousand" ? "千元" : value === "hundred" ? "百元" : "元";
  }
  return value;
}

async function batchUpdate(tableId, updateRecords) {
  if (!Object.keys(updateRecords).length) return;
  await runLark([
    "base",
    "+record-batch-update",
    "--base-token",
    BASE_TOKEN,
    "--table-id",
    tableId,
    "--json",
    jsonFileArg(
      await writeTempJson({ update_records: updateRecords }),
    ),
    "--format",
    "json",
    "--as",
    LARK_IDENTITY,
  ]);
}

async function batchCreate(tableId, createRecords) {
  for (let index = 0; index < createRecords.length; index += 200) {
    await runLark([
      "base",
      "+record-batch-create",
      "--base-token",
      BASE_TOKEN,
      "--table-id",
      tableId,
      "--json",
      jsonFileArg(
        await writeTempJson({
          create_records: createRecords.slice(index, index + 200),
        }),
      ),
      "--format",
      "json",
      "--as",
      LARK_IDENTITY,
    ]);
  }
}

async function writeBack(body) {
  const currentProject = await readProject(
    String(body.projectName ?? ""),
    true,
  );
  if (currentProject.recordId !== body.projectRecordId) {
    throw new Error("项目记录已变化，请重新同步后再写回");
  }
  if (
    !body.projectCode ||
    String(body.projectCode) !== String(currentProject.code)
  ) {
    throw new Error("项目 ID 不匹配，已拒绝写回");
  }

  const conflicts = [];
  const projectUpdates = {};
  for (const [key, change] of Object.entries(body.projectChanges ?? {})) {
    if (!Object.hasOwn(projectWriteFields, key)) continue;
    const currentValue = currentProject.settings[key];
    if (comparable(currentValue) !== comparable(change.before)) {
      conflicts.push({
        scope: "project",
        name: currentProject.name,
        field: projectWriteFields[key],
        expected: change.before,
        current: currentValue,
        desired: change.after,
      });
      continue;
    }
    projectUpdates[projectWriteFields[key]] = writeCellValue(key, change.after);
  }

  const currentCreators = new Map(
    currentProject.creators.map((creator) => [creator.recordId, creator]),
  );
  const creatorUpdates = {};
  for (const creatorChange of body.creatorChanges ?? []) {
    const currentCreator = currentCreators.get(creatorChange.recordId);
    if (!currentCreator) {
      conflicts.push({
        scope: "creator",
        name: creatorChange.name ?? creatorChange.recordId,
        field: "记录",
        expected: "存在",
        current: "不存在或已退出计算",
        desired: "更新",
      });
      continue;
    }

    const fields = {};
    for (const [key, change] of Object.entries(creatorChange.fields ?? {})) {
      if (!Object.hasOwn(creatorWriteFields, key)) continue;
      const currentValue = currentCreator[key];
      if (comparable(currentValue) !== comparable(change.before)) {
        conflicts.push({
          scope: "creator",
          name: currentCreator.name,
          field: creatorWriteFields[key],
          expected: change.before,
          current: currentValue,
          desired: change.after,
        });
        continue;
      }
      fields[creatorWriteFields[key]] = writeCellValue(key, change.after);
    }
    if (Object.keys(fields).length) {
      creatorUpdates[creatorChange.recordId] = fields;
    }
  }

  const existingDouyinIds = new Map();
  for (const creator of currentProject.allCreators ?? currentProject.creators) {
    const douyinId = normalizeDouyinId(creator.douyinId);
    if (douyinId && !existingDouyinIds.has(douyinId)) {
      existingDouyinIds.set(douyinId, creator);
    }
  }
  const pendingDouyinIds = new Map();
  const creatorCreateRecords = [];
  for (const creatorCreate of body.creatorCreates ?? []) {
    const name = String(creatorCreate.name ?? "").trim();
    const douyinId = String(creatorCreate.douyinId ?? "").trim();
    const normalizedDouyinId = normalizeDouyinId(douyinId);
    if (!name || !douyinId) {
      conflicts.push({
        scope: "creator-create",
        name: name || "未命名达人",
        field: !name ? "达人名称" : "抖音号",
        expected: "已填写",
        current: "空",
        desired: "新增记录",
      });
      continue;
    }

    const existingCreator = existingDouyinIds.get(normalizedDouyinId);
    const pendingCreator = pendingDouyinIds.get(normalizedDouyinId);
    if (existingCreator || pendingCreator) {
      const duplicateCreator = existingCreator ?? pendingCreator;
      conflicts.push({
        scope: "creator-create",
        name,
        field: "抖音号",
        expected: "当前项目内唯一",
        current: `${duplicateCreator.name}（${douyinId}）`,
        desired: "新增记录",
      });
      continue;
    }

    const fields = {};
    for (const [key, value] of Object.entries(creatorCreate.fields ?? {})) {
      if (!Object.hasOwn(creatorWriteFields, key)) continue;
      fields[creatorWriteFields[key]] = writeCellValue(key, value);
    }
    fields["达人名称"] = name;
    fields["抖音号"] = douyinId;
    fields["所属项目"] = [{ id: currentProject.recordId }];
    fields["是否参与计算"] = true;
    creatorCreateRecords.push(fields);
    pendingDouyinIds.set(normalizedDouyinId, { name, douyinId });
  }

  if (conflicts.length) {
    return { conflict: true, conflicts };
  }

  if (Object.keys(projectUpdates).length) {
    await batchUpdate(PROJECT_TABLE_ID, {
      [currentProject.recordId]: projectUpdates,
    });
  }
  await batchUpdate(CREATOR_TABLE_ID, creatorUpdates);
  await batchCreate(CREATOR_TABLE_ID, creatorCreateRecords);

  const refreshedProject = await readProject(currentProject.name);
  return {
    conflict: false,
    project: refreshedProject,
    updatedProjectFields: Object.keys(projectUpdates).length,
    updatedCreatorRecords: Object.keys(creatorUpdates).length,
    createdCreatorRecords: creatorCreateRecords.length,
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error("写回内容过大");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, request, status, body) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": resolveCorsOrigin(request),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, request, 204, {});
    return;
  }

  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  if (url.pathname === "/health") {
    sendJson(response, request, 200, {
      ok: true,
      configured: Boolean(BASE_TOKEN && PROJECT_TABLE_ID && CREATOR_TABLE_ID),
      sourceUrl: BASE_URL,
    });
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/projects") {
      sendJson(response, request, 200, {
        ok: true,
        sourceUrl: BASE_URL,
        projects: await readProjects(),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/project") {
      const name = url.searchParams.get("name")?.trim();
      if (!name) throw new Error("缺少项目名称");
      const project = await readProject(name);
      sendJson(response, request, 200, { ok: true, project });
      return;
    }
    if (request.method === "POST" && url.pathname === "/writeback") {
      const result = await writeBack(await readJsonBody(request));
      if (result.conflict) {
        sendJson(response, request, 409, { ok: false, ...result });
      } else {
        sendJson(response, request, 200, { ok: true, ...result });
      }
      return;
    }
    sendJson(response, request, 404, { ok: false, message: "接口不存在" });
  } catch (error) {
    sendJson(response, request, 500, {
      ok: false,
      message: error instanceof Error ? error.message : "飞书同步失败",
    });
  }
}).listen(PORT, HOST, () => {
  process.stdout.write(
    `Feishu sync helper listening on http://${HOST}:${PORT}\n`,
  );
});
