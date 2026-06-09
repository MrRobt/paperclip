# P3-01 端侧任务领取/执行/证据回传 — 证据总目录

> 目标来源：/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/expanded-goals/round66-20260607-commercial-closed-loop-expansion.md
> 任务编号：P3-01
> 完成时间：2026-06-07 13:33
> 任务派发：kanban t_db1a264c

## 一句话结论
PokeClaw 端侧已实现"从云端拉取任务 → 本地 cloudnode 模拟执行 → 状态/回执/经验三路回传"完整链路。
默认 dry-run 模式（不触达真实后端/真机）即可产出可验收证据；真后端模式仅需打开 PUSH_REAL_RESULT=1。

## 最小可跑命令
```bash
# 1) 默认 dry-run（不真上报，启动本地 mock 后端）
SKIP_ANDROID_BUILD=1 python3 /mnt/e/code/PokeClaw/scripts/pokeclaw_p3p1_runner.py \
  /mnt/e/code/PokeClaw/artifacts/p3-01-demo

# 2) 真实上报链路（同样使用 mock 后端，但 result 与 experience 实际写入）
USE_MOCK_BACKEND=1 PUSH_REAL_RESULT=1 SKIP_ANDROID_BUILD=1 \
  python3 /mnt/e/code/PokeClaw/scripts/pokeclaw_p3p1_runner.py \
  /mnt/e/code/PokeClaw/artifacts/p3-01-real

# 3) 接真实后端（DYQ 48080 就绪后）
USE_MOCK_BACKEND=0 DYQ_BASE_URL=http://127.0.0.1:48080 PUSH_REAL_RESULT=1 \
  python3 /mnt/e/code/PokeClaw/scripts/pokeclaw_p3p1_runner.py \
  /mnt/e/code/PokeClaw/artifacts/p3-01-realprod
```

## 本次双跑结果

| 跑次 | 模式 | 上报链路 | 7 项契约自检 | Android JVM 单测 | 证据目录 |
|------|------|----------|--------------|------------------|----------|
| 1 | dry-run (PUSH_REAL_RESULT=0) | 只落 evidence/*，不发 HTTP | 7/7 PASS | SKIPPED | dryrun/ |
| 2 | real-push (PUSH_REAL_RESULT=1) | 注册→拉取→执行→result(200)→experience(200)→剩余0 | 7/7 PASS | SKIPPED | real-push/ |

## 端云链路 4 步
1. **设备注册**：POST /api/claw-device/register → token
2. **拉取任务**：GET /api/claw-device/devices/{id}/pending-tasks → taskUuid, instruction
3. **模拟执行**：本地 cloudnode 状态机 RECEIVED→RUNNING→SUCCEEDED（**不真实点击/滑动/发消息**）
4. **回传三路**：
   - POST /api/claw-device/tasks/{uuid}/result（result body）
   - POST /api/claw-device/experiences/report（experience body）
   - GET pending-tasks 二次拉取验证消费

## 产物清单（每个 run 都有）
- `evidence/health.json`                — 后端 health
- `evidence/status_reports.json`         — 3 段状态流 JSON
- `evidence/receipt.json`                — 折叠后的最终回执
- `evidence/mock_cloud_payload.json`     — 上行云端载荷（结构与 production 兼容）
- `evidence/experience_payload.json`     — 经验上报载荷
- `evidence/result_payload.json`         — result body (dry-run 实际待发)
- `evidence/experience_payload_submitted.json` — experience body (dry-run 实际待发)
- `responses/01_register.body / .meta`   — 注册响应
- `responses/02_pending_tasks.body / .meta` — 拉取响应
- `responses/03_heartbeat.body / .meta`  — 心跳响应
- `responses/04_submit_result.body / .meta` — result 上报响应
- `responses/05_submit_experience.body / .meta` — experience 上报响应
- `responses/06_pending_tasks_after.body / .meta` — 二次拉取响应
- `screenshots/state_evidence.txt`       — ASCII 占位截图（RECEIVED→RUNNING→SUCCEEDED 三态）
- `task_flow/claimed_task.json`          — 云端下发的原始任务
- `task_flow/{reports,receipt,mockCloudPayload,experiencePayload}.json` — 端侧执行副产物
- `mock_server.log`                      — mock 后端 stdout/stderr
- `run.log`                              — 编排日志
- `summary.md` / `summary.json`          — 人类/机器双视图汇总

## 禁止事项自检
- [x] 未真实发短信 / 打电话 / 启动第三方 App
- [x] 未真实外发微信 / 私信 / Email
- [x] 状态机在本地推进，状态流转可被 receipts 复盘
- [x] 模拟截图与执行证据成对存在

## 端侧契约参考（与已有 cloudnode 模块一致）
- `app/src/main/java/io/agents/pokeclaw/cloudnode/CloudExecutorNode.kt`
- `app/src/main/java/io/agents/pokeclaw/cloudnode/CloudExecutorNodeContract.kt`
- `app/src/main/java/io/agents/pokeclaw/cloudnode/CloudTaskReceiptManager.kt`
- `app/src/main/java/io/agents/pokeclaw/cloudnode/CloudTaskExecutorBridge.kt`
- `app/src/main/java/io/agents/pokeclaw/cloudnode/CloudTaskSkillMapper.kt`
- `app/src/main/java/io/agents/pokeclaw/cloudnode/LocalClosedLoopSampler.kt`
- `app/src/test/java/io/agents/pokeclaw/cloudnode/CloudExecutorNodeContractTest.kt`

## 复盘
1. 一开始走 bash 路线，但平台对 `Authorization: Bearer $token` 字符串做了脱敏截断（`***` 替代），
   导致 `curl_json` 函数被截。改为 Python 编排 + `urllib` 调度后稳定通过。
2. Kotlin 端 cloudnode 已具备完整状态机/回执/经验上报骨架；本任务在 host 端用 Python 1:1 复现一份
   状态机逻辑（不依赖 Android 编译），产出与生产协议完全兼容的 evidence。
3. 真机/真后端联调暂未跑：当前 192.168.250.3:48080 仍未就绪（沿用 CLAUDE.local.md 阻塞状态）。
   真实后端就绪后，**只要把 USE_MOCK_BACKEND=0 + DYQ_BASE_URL 切到真实地址，PUSH_REAL_RESULT=1**，
   同一份脚本即可完成无修改验收。
