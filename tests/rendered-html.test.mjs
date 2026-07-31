import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the creator pricing calculator", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>达人报价测算器<\/title>/i);
  assert.match(html, /每一笔采买/);
  assert.match(html, /达人明细/);
  assert.match(html, /添加达人/);
  assert.match(html, /写回飞书/);
  assert.match(html, /KPI播放量（自动）/);
  assert.match(html, /placeholder="填写达人名称"/);
  assert.match(html, /placeholder="填写抖音号"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("keeps new-creator writeback protections in place", async () => {
  const [page, syncServer] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/feishu-sync-server.mjs", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(page, /creatorCreates:\s*CreatorWritebackCreate\[\]/);
  assert.match(page, /creatorCreates:\s*writebackPlan\.creatorCreates/);
  assert.match(page, /待写入飞书/);
  assert.match(page, /\[data-creator-name-id=/);
  assert.match(page, /请填写达人名称/);
  assert.match(page, /请填写抖音号/);
  assert.match(page, /抖音号与当前项目中的达人重复/);

  assert.match(syncServer, /\+record-batch-create/);
  assert.match(syncServer, /fields\["所属项目"\]\s*=\s*\[\{ id:/);
  assert.match(syncServer, /fields\["是否参与计算"\]\s*=\s*true/);
  assert.match(syncServer, /expected:\s*"当前项目内唯一"/);
  assert.match(syncServer, /createdCreatorRecords:/);
});
