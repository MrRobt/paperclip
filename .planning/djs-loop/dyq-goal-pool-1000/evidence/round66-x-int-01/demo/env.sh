#!/usr/bin/env bash
# demo/env.sh — X-INT-01 公共环境变量
# 不修改任何仓库代码；只声明跨端调用的公共变量与路径。
# 使用：source env.sh
set -u

# ===== 云端 =====
export DYQ_BASE_URL="${DYQ_BASE_URL:-http://127.0.0.1:48080}"
export DYQ_HEALTH_PATH="${DYQ_HEALTH_PATH:-/admin-api/actuator/health}"
export TENANT_ID="${TENANT_ID:-1}"

# ===== 端侧仓库路径 =====
export POKECLAW_HOME="${POKECLAW_HOME:-/mnt/e/code/PokeClaw}"
export WEFLOW_HOME="${WEFLOW_HOME:-/mnt/d/work/code/WeFlow}"
export SOCIAL_HOME="${SOCIAL_HOME:-/mnt/d/work/code/social-media-web-automation}"
export WEB_ADMIN_HOME="${WEB_ADMIN_HOME:-/mnt/e/code/ai-ui-admin-vue3aa}"
export DYQ_HOME="${DYQ_HOME:-/mnt/e/code/dyq}"

# ===== 证据输出 =====
export EVIDENCE_ROOT="${EVIDENCE_ROOT:-$HERMES_KANBAN_WORKSPACE/.planning/djs-loop/dyq-goal-pool-1000/evidence/round66-x-int-01}"
export EVIDENCE_DIR="${EVIDENCE_DIR:-$EVIDENCE_ROOT/demo-runs/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$EVIDENCE_DIR"

# ===== 演示脚本所在目录 =====
export DEMO_HOME="${DEMO_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

echo "[env] DYQ_BASE_URL=$DYQ_BASE_URL"
echo "[env] TENANT_ID=$TENANT_ID"
echo "[env] EVIDENCE_DIR=$EVIDENCE_DIR"
echo "[env] DEMO_HOME=$DEMO_HOME"
