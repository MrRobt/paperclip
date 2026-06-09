# 跨仓库验收矩阵 + 最小演示脚本入口（X-INT-01 / r66）

> 目的：把 `INTEGRATION_CONTRACT.md` 落成的契约，分解为可由各端独立冒烟、并可在
> `QC3-01` 阶段串成端到端验收矩阵的「最小演示脚本入口」。
>
> 硬约束：每一行都是「已有脚本/可一键执行的最小单元」，不是「待开发」。

---

## 1. 验收矩阵总览

四端 × 五条业务链 × 四类风险位 = 80 个验收点。本表只列 r66 阶段**必须跑通**的 16
个核心点；其余 64 点由后续执行卡各自交付。

| 维度 | A：云端冒烟 | B：端云契约 | C：WeFlow 安全草稿 | D：S1/S2 社媒→WeFlow |
| --- | --- | --- | --- | --- |
| 入口脚本 | `scripts/c1_claw_device_smoke.py` | `PokeClaw/scripts/dyq3-endcloud-smoke.sh` | `WeFlow/scripts/weflow-dyq-device-register.py` + `test_weflow_dyq_safe_draft.py` | `social-media-web-automation/tests/weflow-lead-handoff.test.ts` |
| 云端 | `/admin-api/actuator/health` | `/api/claw-device/register` 等 6 个端点 | `/claw/device/{id}/execute` | `/claw/device/{id}/execute` |
| 端侧 | — | `pending-tasks` 拉取 + 签名 result | `runtime-safety` + `prepare-text` | — |
| 安全边界 | 无真实外发 | 端云签名 + 401 兼容 | `externalSendAllowed=false` | 草稿仅入人工确认队列 |
| 证据 | `summary.json` | `artifacts/dyq3-smoke/...` | `wechat-controller/scripts/weflow_message_evidence.json` | `tests/live-room-lead-handoff.test.ts` 断言 |
| 已验轮次 | r1 / r2 / r3 / r4 连续 3 次 UP | r6 / r7 / r8 | r9 / r10 / r11 / r12 / r14 / r15 / r16 / r17 | r19 / r20 / r23 / r24 / r25 / r26 |
| r66 状态 | 已固化契约 | 已固化契约 | 已固化契约 | 已固化契约 |

---

## 2. 核心验收点（16 项）

每项以「端 + 步骤 + 期望 + 已有证据」四列展示，方便 `QC3-01` 直接照表执行。

### 2.1 云端冒烟（场景 A）

| # | 端 | 步骤 | 期望 | 已有证据 |
| --- | --- | --- | --- | --- |
| A1 | 云端 | `curl http://127.0.0.1:48080/admin-api/actuator/health` | HTTP 200, `status=UP` | r1–r4 连续 3 次 |
| A2 | 云端 | `python scripts/c1_claw_device_smoke.py` | `passed=true`, register/heartbeat 业务码 0 | r2 `c1_claw_device_smoke.latest.json` |
| A3 | 云端 | `signature=...` 错误令牌注册 | HTTP 401 业务码 401001 | r8 兼容 mock 与真实 48080 |
| A4 | 云端 | `claw/overview/dashboard` 拉取 | 含 PokeClaw / WeFlow / Claw 云端三主线计数 | r37 / r38 |

### 2.2 端云契约（场景 B）

| # | 端 | 步骤 | 期望 | 已有证据 |
| --- | --- | --- | --- | --- |
| B1 | PokeClaw | `bash scripts/dyq3-endcloud-smoke.sh artifacts/dyq3-smoke/r66-b1-mock` | Mock 全链路通过 | r5 / r6 / r7 / r8 |
| B2 | PokeClaw | `USE_MOCK_BACKEND=0 DYQ_BASE_URL=... scripts/dyq3-endcloud-smoke.sh artifacts/dyq3-smoke/r66-b2-real` | 真实 48080 全链路通过 | r8 任务 `289afa762d324a04881290283e4a504a` |
| B3 | PokeClaw | `ADMIN_SEED_TASK=1 ... scripts/dyq3-endcloud-smoke.sh` | 管理后台任务下发 + pending 拉取 + result 回传 | r7 真实任务种子路径 |
| B4 | PokeClaw | `scripts/device-api-integration-test.sh` | OpenAPI 契约静态校验 | `api-contracts/device.openapi.yaml` |

### 2.3 WeFlow 安全草稿（场景 C）

| # | 端 | 步骤 | 期望 | 已有证据 |
| --- | --- | --- | --- | --- |
| C1 | WeFlow | `python scripts/weflow-dyq-device-register.py` | register/heartbeat HTTP 200 业务码 0 | r9 |
| C2 | WeFlow | `python scripts/test_weflow_dyq_safe_draft.py` | `send_text` 降级为 `prepare_text` | r10 / r11 |
| C3 | WeFlow | `python scripts/test_weflow_dyq_integration.py` | 真实 48080 register/heartbeat/admin execute/pending/safeDraft/signed result | r15 |
| C4 | WeFlow | `GET /dyq/device-node/runtime-safety` | `externalSendAllowed=false` + 退出热键 = `Ctrl+Alt+Q` | r12 / r13 / r18 |

### 2.4 S1/S2 社媒→WeFlow（场景 D）

| # | 端 | 步骤 | 期望 | 已有证据 |
| --- | --- | --- | --- | --- |
| D1 | 社媒 | `npm test -- weflow-lead-handoff` | 高意向线索产出 WeFlow 任务种子 | r19 |
| D2 | 社媒 | `npm test -- live-room-lead-handoff` | 直播间线索归类 `S1直播间截流` | r24 |
| D3 | 社媒+WeFlow | 草稿下发 `claw/device/{id}/execute` 真实链路 | WeFlow pending → safeDraft → result | r20 / r26 任务 `7365f8dc4def4af8a6baa99d6d8e841a` |
| D4 | 社媒 | `npm test -- 控制台只读总览` | 人工确认草稿统计按场景分类 | r21 / r23 |

---

## 3. 最小演示脚本入口（`demo/` 落点）

`/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round66-x-int-01/demo/`
目录下放三个**只读、可一键执行**的最小演示入口：

```
demo/
├── run_all_scenarios.sh          # 顺序跑 A/B/C/D 四场景的最小串联
├── env.sh                        # 公共变量（端口/租户/路径）
├── README.md                     # 调用方法 + 期望产物
├── scenario_a_health.sh          # 云端健康 + register/heartbeat
├── scenario_b_endcloud.sh        # PokeClaw 端云契约（Mock + 真实）
├── scenario_c_weflow_safe.sh     # WeFlow 设备节点 + 安全草稿
└── scenario_d_social_to_weflow.sh# 社媒线索 → WeFlow 安全草稿
```

`run_all_scenarios.sh` 行为约束：

1. **不真实外发**、不强推、不修改任何仓库代码；只读本地 + 调用已存在脚本。
2. 每个场景单独 `exit 0` 才继续；任一失败立即停，输出失败场景 + 证据路径。
3. 末尾汇总 `summary.json` 写到本目录，供 QC3-01 验收。

`env.sh` 约定变量：

```bash
# 公共
export DYQ_BASE_URL="${DYQ_BASE_URL:-http://127.0.0.1:48080}"
export DYQ_HEALTH_PATH="${DYQ_HEALTH_PATH:-/admin-api/actuator/health}"
export TENANT_ID="${TENANT_ID:-1}"
export EVIDENCE_DIR="${EVIDENCE_DIR:-$HERMES_KANBAN_WORKSPACE/.planning/djs-loop/dyq-goal-pool-1000/evidence/round66-x-int-01/demo-runs/$(date +%Y%m%d-%H%M%S)}"

# 端侧路径
export POKECLAW_HOME="${POKECLAW_HOME:-/mnt/e/code/PokeClaw}"
export WEFLOW_HOME="${WEFLOW_HOME:-/mnt/d/work/code/WeFlow}"
export SOCIAL_HOME="${SOCIAL_HOME:-/mnt/d/work/code/social-media-web-automation}"
```

> r66 阶段只提供入口与 README；执行/调用交由 C3/P3/W3/WEB3 各自实现并写本目录。
> QC3-01 时再统一跑 `run_all_scenarios.sh` 输出端到端汇总。

---

## 4. 跨端一致性验收（必跑）

| # | 验收点 | 命令/脚本 | 期望 |
| --- | --- | --- | --- |
| X1 | 签名头三端一致 | grep `X-Claw-Signature` 在 `ClawDeviceSignatureFilter.java` / `dyq3-endcloud-smoke.sh` / `weflow-dyq-device-register.py` | 命名 + 拼接顺序一致 |
| X2 | `taskUuid` 来源唯一 | `ClawDeviceTaskCreateReqVO.taskUuid` 由云端 UUID 生成 | 端侧不重新生成 |
| X3 | DLQ 暴露 | `GET /admin-api/claw/ops/dlq-stats` 或等价端点 | PRM / Outbox ACK DLQ 计数可见 |
| X4 | 人工确认开关 | WeFlow `externalSendAllowed` / 社媒 `requiresHumanConfirmation` | 任意场景均为 `true/false` 严格一致 |
| X5 | 租户隔离 | `claw_device.tenant_id != TENANT_ID` 时 pending 返回 403 | 越权写 `claw_device_audit_log` |

> X1–X5 由 `ACCEPTANCE_MATRIX` 在 QC3-01 阶段汇总为最终证据。

---

## 5. 与既有轮次证据的关联

| 轮次 | 关联 | 引用 |
| --- | --- | --- |
| r1–r4 | A1 / A2 | `evidence/round3-20260606-183431/` `c1_claw_device_smoke.latest.json` |
| r5–r8 | B1 / B2 / B3 | `PokeClaw/artifacts/dyq3-smoke/20260606-round8-*/` |
| r9 | C1 | `WeFlow/scripts/weflow-dyq-device-register.py` 真实 48080 |
| r10–r18 | C2 / C3 / C4 | `WeFlow` 多次提交 `05b751f` / `770d852` 等 |
| r19 | D1 | `social-media-web-automation` `buildDyqWeFlowTaskSeed` |
| r20 / r26 | D3 | 任务 `7365f8dc4def4af8a6baa99d6d8e841a` |
| r21 / r23 | D4 | `InMemoryHumanConfirmationQueue` 统计 |

---

## 6. 失败/降级策略

| 场景 | 失败模式 | 降级 |
| --- | --- | --- |
| A1 健康 DOWN | `nacosConfig=DOWN` 等历史问题 | 关闭该组件健康指标，参考 r2 修复路径 |
| B2 真实 48080 无任务 | `pendingTaskCount=0` | 用 `ADMIN_SEED_TASK=1` 走管理后台下发 |
| C3 WeFlow 端不可用 | 桌面标记/退出热键未实测 | `externalSendAllowed=false` 强制阻断真实外发 |
| D1 社媒 CI 失败 | 类型/单测报错 | 仅在文档中保留契约，代码回退到上一稳定提交 |

---

## 7. 后续卡必填字段

C3-01 / P3-01 / W3-01 / WEB3-01 任一卡完成时，必须回填本文件第 8 节「执行回填」：

| 卡 | 状态 | 真实链路证据路径 | 提交号 | 阻塞 |
| --- | --- | --- | --- | --- |
| C3-01 | — | — | — | — |
| P3-01 | — | — | — | — |
| W3-01 | — | — | — | — |
| WEB3-01 | — | — | — | — |

QC3-01 启动条件：上述 4 张卡全部回填完毕或明确写出「为什么不能跑真实链路」。

---

## 8. 执行回填（占位）

> 由 C3-01 / P3-01 / W3-01 / WEB3-01 各自回填；本轮不填。

---

## 9. 结论

本矩阵把 4 端 × 4 场景的 16 个验收点固化为可被脚本驱动的最小单元；只要任一端
任一场景跑通，跨端集成就可被串成端到端验证。`demo/` 目录提供入口与公共变量，
由各执行卡自填、由 `QC3-01` 汇总。本轮不动业务代码、不动 DDL、不强推。
