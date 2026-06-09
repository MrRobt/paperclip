#!/usr/bin/env bash
# demo/scenario_a_health.sh — 场景 A：云端冒烟（健康 / register / heartbeat）
# 关联：INTEGRATION_CONTRACT §2.2 A1/A2，ACCEPTANCE_MATRIX §2.1
# 状态：脚手架，本轮未执行；QC3-01 阶段汇总验收。
set -uo pipefail
SCRIPT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_HOME/env.sh"

echo "[A1] 准备调用 $DYQ_BASE_URL$DYQ_HEALTH_PATH"
if command -v curl >/dev/null 2>&1; then
  http_code=$(curl -s -o "$EVIDENCE_DIR/A1_health.json" -w "%{http_code}" "$DYQ_BASE_URL$DYQ_HEALTH_PATH" || true)
  echo "[A1] HTTP=$http_code（期望 200）"
  if [ "$http_code" != "200" ]; then
    echo "[A1][WARN] 健康端点非 200；按 r2 修复路径排查 nacosConfig 等"
  fi
else
  echo "[A1][SKIP] curl 不可用，跳过真实探测"
fi

echo "[A2] 准备调用 Paperclip scripts/c1_claw_device_smoke.py"
SMOKE_PY="$HERMES_KANBAN_WORKSPACE/scripts/c1_claw_device_smoke.py"
if [ -f "$SMOKE_PY" ]; then
  if python3 "$SMOKE_PY" > "$EVIDENCE_DIR/A2_smoke.log" 2>&1; then
    echo "[A2] 冒烟通过"
  else
    echo "[A2][FAIL] 冒烟失败，详见 $EVIDENCE_DIR/A2_smoke.log"
    exit 2
  fi
else
  echo "[A2][SKIP] 冒烟脚本不存在（$SMOKE_PY），QC3-01 时再补"
fi

echo "[场景A 完成] 健康 / register / heartbeat 落点齐备"
exit 0
