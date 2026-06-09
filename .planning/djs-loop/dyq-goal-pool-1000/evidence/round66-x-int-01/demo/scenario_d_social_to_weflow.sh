#!/usr/bin/env bash
# demo/scenario_d_social_to_weflow.sh — 场景 D：社媒线索 → WeFlow 安全草稿
# 关联：INTEGRATION_CONTRACT §6 场景 D，ACCEPTANCE_MATRIX §2.4
# 状态：脚手架，本轮未执行；QC3-01 阶段汇总验收。
set -uo pipefail
SCRIPT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_HOME/env.sh"

if [ ! -d "$SOCIAL_HOME" ]; then
  echo "[D1][SKIP] SOCIAL_HOME 不存在：$SOCIAL_HOME"
  exit 0
fi

# D1 高意向线索 → WeFlow 任务种子
echo "[D1] 准备跑 weflow-lead-handoff 单测"
if (cd "$SOCIAL_HOME" && npm test -- weflow-lead-handoff > "$EVIDENCE_DIR/D1_weflow_lead.log" 2>&1); then
  echo "[D1] weflow-lead-handoff 通过"
else
  echo "[D1][WARN] weflow-lead-handoff 失败，详见 $EVIDENCE_DIR/D1_weflow_lead.log"
fi

# D2 直播间线索归类 S1
echo "[D2] 准备跑 live-room-lead-handoff 单测"
if (cd "$SOCIAL_HOME" && npm test -- live-room-lead-handoff > "$EVIDENCE_DIR/D2_live_room.log" 2>&1); then
  echo "[D2] live-room-lead-handoff 通过"
else
  echo "[D2][WARN] live-room-lead-handoff 失败，详见 $EVIDENCE_DIR/D2_live_room.log"
fi

# D3 草稿下发到 DYQ→WeFlow
echo "[D3] 草稿下发到 DYQ→WeFlow 由 C3-01/W3-01 联合执行；本轮仅占位"
echo "{\"scenario\":\"D3\",\"status\":\"placeholder\",\"note\":\"等待 C3-01/W3-01\"}" > "$EVIDENCE_DIR/D3_placeholder.json"

# D4 控制台统计
echo "[D4] 准备跑控制台只读总览单测"
if (cd "$SOCIAL_HOME" && npm test -- 控制台只读总览 > "$EVIDENCE_DIR/D4_console.log" 2>&1); then
  echo "[D4] 控制台只读总览通过"
else
  echo "[D4][WARN] 控制台只读总览失败，详见 $EVIDENCE_DIR/D4_console.log"
fi

echo "[场景D 完成] 社媒→WeFlow 安全草稿落点齐备"
exit 0
