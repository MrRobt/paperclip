#!/usr/bin/env bash
# demo/run_all_scenarios.sh — X-INT-01 最小演示入口（顺序串联 A/B/C/D 四场景）
#
# 行为约束：
#   1. 不真实外发、不强推、不修改任何仓库代码；只读 + 调已存在脚本。
#   2. 脚手架行为：4 场景都跑完再汇总；任一失败不立刻停，便于 QC3-01 拿到完整证据。
#   3. 末尾汇总 summary.json 写到 EVIDENCE_DIR，供 QC3-01 阶段验收。
#
# 退出码：
#   0  全部通过
#   非0 任一场景失败（首个失败场景写入 summary.json）
set -uo pipefail

SCRIPT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_HOME/env.sh"

SCENARIOS=(
  "scenario_a_health.sh:A:云端冒烟"
  "scenario_b_endcloud.sh:B:端云契约"
  "scenario_c_weflow_safe.sh:C:WeFlow安全草稿"
  "scenario_d_social_to_weflow.sh:D:社媒→WeFlow"
)

SUMMARY="$EVIDENCE_DIR/summary.json"

overall=0
failed_scenario=""
notes_jsonl="$EVIDENCE_DIR/.notes.jsonl"
: > "$notes_jsonl"

# 脚手架行为：所有 4 场景都跑完，再汇总。
# 这样可以在一轮内收集所有 PASS/WARN/SKIP，QC3-01 阶段才能拿到完整证据。
for entry in "${SCENARIOS[@]}"; do
  script="${entry%%:*}"
  label="${entry#*:}"
  label="${label%%:*}"
  desc="${entry#*:*:}"

  echo
  echo "============================================="
  echo "场景 $label — $desc"
  echo "脚本：$SCRIPT_HOME/$script"
  echo "证据：$EVIDENCE_DIR"
  echo "============================================="

  # 子脚本 exit 0 → PASS；非 0 → FAIL 并记入 notes，但仍继续下一个场景
  set +e
  bash "$SCRIPT_HOME/$script" 2>&1 | tee "$EVIDENCE_DIR/${script%.sh}.log"
  rc=${PIPESTATUS[0]}
  set -e 2>/dev/null || true
  if [ "$rc" -eq 0 ]; then
    printf '{"scenario":"%s","desc":"%s","status":"PASS","log":"%s"}\n' \
      "$label" "$desc" "${script%.sh}.log" >> "$notes_jsonl"
    echo "[OK] 场景 $label 通过"
  else
    printf '{"scenario":"%s","desc":"%s","status":"FAIL","log":"%s","exitCode":%d}\n' \
      "$label" "$desc" "${script%.sh}.log" "$rc" >> "$notes_jsonl"
    overall=$rc
    failed_scenario="$label"
    echo "[FAIL] 场景 $label 失败（exit=$rc）；继续下一个场景以便 QC3-01 拿到完整证据"
  fi
done

# 汇总：用 python 把 jsonl 变成 json 数组
python3 - "$notes_jsonl" "$SUMMARY" "$overall" "$failed_scenario" <<'PY'
import json, os, sys
notes_path, summary_path, overall, failed = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
scenarios = []
with open(notes_path) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            scenarios.append(json.loads(line))
        except Exception:
            pass
final = {
    "overallExitCode": overall,
    "failedScenario": failed or None,
    "scenarios": scenarios,
    "evidenceDir": os.environ.get("EVIDENCE_DIR", ""),
    "tenantId": os.environ.get("TENANT_ID", ""),
    "dyqBaseUrl": os.environ.get("DYQ_BASE_URL", ""),
    "note": "X-INT-01 演示入口串联结果；不真实外发，不强推。",
}
with open(summary_path, "w") as f:
    json.dump(final, f, ensure_ascii=False, indent=2)
PY

echo
echo "============================================="
echo "演示入口汇总：$SUMMARY"
echo "============================================="

if [ "$overall" -eq 0 ]; then
  echo "全部场景通过"
  exit 0
else
  echo "失败场景：$failed_scenario"
  exit $overall
fi
