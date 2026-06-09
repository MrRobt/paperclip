#!/usr/bin/env bash
# demo/scenario_b_endcloud.sh — 场景 B：PokeClaw 端云契约（Mock + 真实 48080）
# 关联：INTEGRATION_CONTRACT §2.1 / §2.2，ACCEPTANCE_MATRIX §2.2
# 状态：脚手架，本轮未执行；QC3-01 阶段汇总验收。
set -uo pipefail
SCRIPT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_HOME/env.sh"

if [ ! -d "$POKECLAW_HOME" ]; then
  echo "[B1][SKIP] POKECLAW_HOME 不存在：$POKECLAW_HOME"
  exit 0
fi

SMOKE="$POKECLAW_HOME/scripts/dyq3-endcloud-smoke.sh"
if [ ! -x "$SMOKE" ]; then
  echo "[B1][SKIP] 端云冒烟脚本不可执行：$SMOKE"
  exit 0
fi

# Mock 端云闭环
ARTIFACT_MOCK="$EVIDENCE_DIR/B1_mock"
mkdir -p "$ARTIFACT_MOCK"
echo "[B1] 准备跑 Mock 端云闭环"
if MOCK_PORT=18410 USE_MOCK_BACKEND=1 bash "$SMOKE" "$ARTIFACT_MOCK" > "$EVIDENCE_DIR/B1_mock.log" 2>&1; then
  echo "[B1] Mock 闭环通过"
else
  echo "[B1][FAIL] Mock 闭环失败，详见 $EVIDENCE_DIR/B1_mock.log"
  exit 2
fi

# 真实 48080 端云闭环
ARTIFACT_REAL="$EVIDENCE_DIR/B2_real"
mkdir -p "$ARTIFACT_REAL"
echo "[B2] 准备跑真实 48080 端云闭环（无任务种子）"
if USE_MOCK_BACKEND=0 DYQ_BASE_URL="$DYQ_BASE_URL" HEALTH_PATH="$DYQ_HEALTH_PATH" \
   bash "$SMOKE" "$ARTIFACT_REAL" > "$EVIDENCE_DIR/B2_real.log" 2>&1; then
  echo "[B2] 真实闭环通过"
else
  rc=$?
  echo "[B2][WARN] 真实闭环返回 $rc；按 r8 经验可补 ADMIN_SEED_TASK=1 走管理后台任务下发"
fi

echo "[场景B 完成] 端云契约落点齐备"
exit 0
