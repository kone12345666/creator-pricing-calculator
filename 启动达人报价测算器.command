#!/bin/zsh
set -e

SCRIPT_DIR="${0:A:h}"
RUNTIME_NODE="/Users/kone/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

cd "$SCRIPT_DIR"

if [[ ! -x "$RUNTIME_NODE" ]]; then
  echo "未找到本地运行环境，请先在 Codex 中打开本项目。"
  read -k 1 "?按任意键关闭..."
  exit 1
fi

export NEXT_PUBLIC_SYNC_ROOT="http://127.0.0.1:3104"
export SYNC_HOST="127.0.0.1"
export SYNC_PORT="3104"
export SYNC_ALLOWED_ORIGIN="http://localhost:3103"

"$RUNTIME_NODE" scripts/feishu-sync-server.mjs &
SYNC_PROCESS=$!
cleanup() { kill "$SYNC_PROCESS" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(sleep 3; open "http://localhost:3103/") &
WRANGLER_LOG_PATH=.wrangler/wrangler.log "$RUNTIME_NODE" scripts/vinext-run.mjs dev --port 3103
