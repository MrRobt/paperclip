# demo 目录（X-INT-01 最小演示脚本入口）

本目录是 r66 阶段「商业化闭环二阶段集成设计」沉淀的**最小演示入口脚手架**。
四张执行卡（C3-01 / P3-01 / W3-01 / WEB3-01）按本目录结构各自实现并回填证据；
QC3-01 阶段由 `run_all_scenarios.sh` 串联 4 场景、汇总端到端证据。

## 文件清单

| 文件 | 作用 | 关联场景 |
| --- | --- | --- |
| `env.sh` | 公共变量（端口/租户/路径/证据目录） | — |
| `run_all_scenarios.sh` | 顺序串联 A/B/C/D 四场景并写 `summary.json` | A + B + C + D |
| `scenario_a_health.sh` | 云端冒烟（健康 / register / heartbeat） | 场景 A |
| `scenario_b_endcloud.sh` | PokeClaw 端云契约（Mock + 真实 48080） | 场景 B |
| `scenario_c_weflow_safe.sh` | WeFlow 设备节点 + 安全草稿 | 场景 C |
| `scenario_d_social_to_weflow.sh` | 社媒线索 → WeFlow 安全草稿 | 场景 D |
| `README.md` | 本文件 | — |

## 调用方法

```bash
# 1. 进入 demo 目录
cd /root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round66-x-int-01/demo

# 2. 加载公共变量
source env.sh

# 3. 单跑一个场景
bash scenario_a_health.sh
bash scenario_b_endcloud.sh
bash scenario_c_weflow_safe.sh
bash scenario_d_social_to_weflow.sh

# 4. 或一键串联 4 场景
bash run_all_scenarios.sh
```

## 期望产物

每个场景在 `$EVIDENCE_DIR`（默认
`$HERMES_KANBAN_WORKSPACE/.planning/djs-loop/dyq-goal-pool-1000/evidence/round66-x-int-01/demo-runs/<时间戳>/`）
下输出：

- `summary.json` — 4 场景总体结果（仅 `run_all_scenarios.sh` 输出）
- `A1_health.json` / `A2_smoke.log` — 场景 A 子证据
- `B1_mock.log` / `B1_mock/` / `B2_real.log` / `B2_real/` — 场景 B 子证据
- `C1_register.log` / `C2_safe_draft.log` / `C3_integration.log` / `C4_runtime_safety.json` — 场景 C 子证据
- `D1_weflow_lead.log` / `D2_live_room.log` / `D3_placeholder.json` / `D4_console.log` — 场景 D 子证据

## 安全约束（硬红线）

- **不真实外发**：WeFlow 任何回执禁止写入真实微信原文 / 真实账号密码 / 真实手机号。
- **不强推**：不 push、不发远端 PR；本目录只读 + 写本地 `$EVIDENCE_DIR`。
- **不修改任何仓库代码**：本目录是脚手架，落点由后续执行卡各自实现并提交。
- **人工确认优先**：所有 `wechat.message.send_text` / S1/S2 草稿必须经过人工确认队列，
  **禁止**直接 `success` 落库。

## 状态

- 本轮 r66-x-int-01：脚手架完成，未执行。
- C3-01 / P3-01 / W3-01 / WEB3-01：各自回填本目录的执行结果。
- QC3-01：执行 `run_all_scenarios.sh` 汇总端到端证据。
