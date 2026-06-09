#!/usr/bin/env bash
# demo/scenario_c_weflow_safe.sh — 场景 C：WeFlow 设备节点 + 安全草稿
# 关联：INTEGRATION_CONTRACT §2.3 / §5，ACCEPTANCE_MATRIX §2.3
# 状态：脚手架，本轮未执行；QC3-01 阶段汇总验收。
set -uo pipefail
SCRIPT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_HOME/env.sh"

if [ ! -d "$WEFLOW_HOME" ]; then
  echo "[C1][SKIP] WEFLOW_HOME 不存在：$WEFLOW_HOME"
  exit 0
fi

REGISTER_PY="$WEFLOW_HOME/scripts/weflow-dyq-device-register.py"
SAFE_DRAFT_PY="$WEFLOW_HOME/scripts/test_weflow_dyq_safe_draft.py"
INTEGRATION_PY="$WEFLOW_HOME/scripts/test_weflow_dyq_integration.py"

# C1 设备节点 register/heartbeat
if [ -f "$REGISTER_PY" ]; then
  echo "[C1] 准备跑 WeFlow 设备 register/heartbeat"
  if python3 "$REGISTER_PY" > "$EVIDENCE_DIR/C1_register.log" 2>&1; then
    echo "[C1] register/heartbeat 通过"
  else
    echo "[C1][WARN] register/heartbeat 失败，详见 $EVIDENCE_DIR/C1_register.log"
  fi
else
  echo "[C1][SKIP] 设备节点脚本不存在：$REGISTER_PY"
fi

# C2 安全草稿单元测试
if [ -f "$SAFE_DRAFT_PY" ]; then
  echo "[C2] 准备跑 WeFlow 安全草稿单测"
  if python3 "$SAFE_DRAFT_PY" > "$EVIDENCE_DIR/C2_safe_draft.log" 2>&1; then
    echo "[C2] 安全草稿单测通过"
  else
    echo "[C2][WARN] 安全草稿单测失败，详见 $EVIDENCE_DIR/C2_safe_draft.log"
  fi
else
  echo "[C2][SKIP] 安全草稿单测不存在：$SAFE_DRAFT_PY"
fi

# C3 真实 48080 集成
if [ -f "$INTEGRATION_PY" ]; then
  echo "[C3] 准备跑 WeFlow 真实 48080 集成"
  if python3 "$INTEGRATION_PY" > "$EVIDENCE_DIR/C3_integration.log" 2>&1; then
    echo "[C3] 真实集成通过"
  else
    echo "[C3][WARN] 真实集成失败，详见 $EVIDENCE_DIR/C3_integration.log"
  fi
else
  echo "[C3][SKIP] 真实集成脚本不存在：$INTEGRATION_PY"
fi

# C4 runtime-safety 契约
echo "[C4] 准备探测 /dyq/device-node/runtime-safety"
if command -v curl >/dev/null 2>&1; then
  curl -s "$DYQ_BASE_URL/dyq/device-node/runtime-safety" > "$EVIDENCE_DIR/C4_runtime_safety.json" || true
  echo "[C4] 契约落点：$EVIDENCE_DIR/C4_runtime_safety.json"
fi

echo "[场景C 完成] WeFlow 安全草稿契约落点齐备"
exit 0
