# 证据记录

## 启动证据

- 时间：2026-06-06 17:54:47 +0800
- 定时任务编号：a28d79eaccef
- 目标池文件已存在：/root/paperclip-work/paperclip/doc/plans/2026-06-06-dyq-paperclip-goals-hermes-takeover.md
- 中央状态目录：/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/

## 待填证据

- C1：48080 启动、健康检查、register、heartbeat。
- P1：PokeClaw 端侧接入验证。
- W1：WeFlow 微信托管安全回复验证。
- S1-S4：自动化赚钱场景最小闭环验证。

## 第 1 轮证据：C1/P1 Claw 设备注册与心跳冒烟

- 时间：2026-06-06 18:03:11 +0800
- 脚本：`.planning/djs-loop/dyq-goal-pool-1000/scripts/c1_claw_device_smoke.py`
- 输出：`.planning/djs-loop/dyq-goal-pool-1000/c1_claw_device_smoke.latest.json`
- 命令：`python3 .planning/djs-loop/dyq-goal-pool-1000/scripts/c1_claw_device_smoke.py`
- 结果：通过，`passed=true`。
- 关键证据：
  - 主后端 48080 有 Java 进程监听，PID `1357683`。
  - `/admin-api/actuator/health`：HTTP 503，整体 `DOWN`；`db=UP`、`redis=UP`、`rabbit=UP`、`nacosConfig=DOWN`。
  - `/api/claw-device/register`：HTTP 200，业务 `code=0`，返回设备令牌，令牌长度 190，`expiresIn=604800`。
  - `/api/claw-device/heartbeat`：HTTP 200，业务 `code=0`，返回 `pendingTaskCount=0`、`skillVersion=0`、`serverTime`。
- 判定：C1.3 register/heartbeat 最小链路可用；C1.1 健康基线仍因 `nacosConfig=DOWN` 未完全达标。

## 第 2 轮证据：C1.1 主后端 48080 健康误判修复

- 时间：2026-06-06 18:20:47 +0800
- 改动文件：`/mnt/e/code/dyq/dyq-server/src/main/resources/application-dev.yaml`
- 后端提交：`b94ef4afd fix(健康检查): 修复开发环境主后端健康误判`
- 修复点：dev 环境主后端不依赖配置中心，禁用 Nacos 健康指标，避免 `nacosConfig=DOWN` 把整体健康误判为 `DOWN`。
- 验证命令与结果：
  - `python3 - <<'PY' ... yaml.safe_load_all(application-dev.yaml) ... PY`：通过。
  - `mvn -pl dyq-server -DskipTests compile -o -q`：通过。
  - 停旧 48080 Java 进程后重启 dyq-server：新后台进程会话 `proc_12a0f5ae453b`，应用 Java 进程 `1476277`。
  - `curl http://127.0.0.1:48080/admin-api/actuator/health`：HTTP 200，`status=UP`，`db=UP`、`redis=UP`、`rabbit=UP`、`sandbox=UP`，`nacosConfig` 组件已消失。
  - `python3 .planning/djs-loop/dyq-goal-pool-1000/scripts/c1_claw_device_smoke.py`：`passed=true`；register `code=0`；heartbeat `code=0`。
- 判定：C1.1 主后端 48080 健康基线由 DOWN 推进到 UP；C1.3/P1 register/heartbeat 冒烟仍通过。

## 第 3 轮证据：C1.1/C1.3 连续稳定证据第 2 次

- 时间：2026-06-06 18:34:31 +0800
- 证据目录：`/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round3-20260606-183431/`
- 关键文件：
  - `meta.txt`：分支、已跟踪状态、48080 监听进程。
  - `health.txt`：`/admin-api/actuator/health` 原始响应。
  - `smoke.stdout.txt`：冒烟脚本标准输出。
  - `smoke.json`：冒烟脚本结构化输出。
  - `summary.json`：本轮验证摘要。
- 验证命令与结果：
  - `curl http://127.0.0.1:48080/admin-api/actuator/health`：HTTP 200，`status=UP`，未出现 `nacosConfig`。
  - `python3 .planning/djs-loop/dyq-goal-pool-1000/scripts/c1_claw_device_smoke.py`：`passed=true`。
  - `summary.json` 断言：`health_http=200`、`health_status=UP`、`has_nacos_config=false`、`register_code=0`、`heartbeat_code=0`、`pendingTaskCount=0`。
- 判定：C1.1 主后端健康基线连续稳定；C1.3/P1 register + heartbeat 链路连续可用。


## 第 4 轮证据：C1.1/C1.3 连续稳定证据第 3 次

- 时间：2026-06-06 18:46:43 +0800
- 证据目录：`/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round4-20260606-184515`
- 关键文件：`meta.txt`、`health.txt`、`smoke.stdout.txt`、`smoke.json`、`summary.json`。
- 验证命令与结果：
  - `curl http://127.0.0.1:48080/admin-api/actuator/health`：HTTP 200，`status=UP`，未出现 `nacosConfig`。
  - `python3 .planning/djs-loop/dyq-goal-pool-1000/scripts/c1_claw_device_smoke.py`：`passed=true`。
  - `summary.json` 断言：`health_http=200`、`health_status=UP`、`has_nacos_config=false`、`register_code=0`、`heartbeat_code=0`、`pendingTaskCount=0`。
- 判定：C1.1 主后端健康基线已形成三次连续稳定证据；C1.3/P1 register + heartbeat 链路连续可用，下一轮可转向 PokeClaw 真实端侧接入字段/调用路径。


## 第5轮证据｜2026-06-06 18:58 +0800
- PokeClaw 规则读取：`/mnt/e/code/PokeClaw/CLAUDE.md`、`/mnt/e/code/PokeClaw/README.md`。
- 仓库状态：PokeClaw 分支 dev 且工作区干净；DYQ 分支 dev 且 `git status --short -uno` 干净；Paperclip 为既有可解释未提交改动。
- Mock 冒烟命令：`MOCK_PORT=18405 USE_MOCK_BACKEND=1 bash scripts/dyq3-endcloud-smoke.sh artifacts/dyq3-smoke/20260606-round5-auth-header-fix-mock`。
- Mock 结果：通过；证据文件 `/mnt/e/code/PokeClaw/artifacts/dyq3-smoke/20260606-round5-auth-header-fix-mock/summary.md`；任务号 `a24d0066-0a35-4ccb-bee7-d42f88310f5a`；无令牌/坏令牌均返回业务码 401；断网 curl_exit=7。
- 真实后端命令：`USE_MOCK_BACKEND=0 DYQ_BASE_URL=http://127.0.0.1:48080 HEALTH_PATH=/actuator/health bash scripts/dyq3-endcloud-smoke.sh artifacts/dyq3-smoke/20260606-round5-real-48080-probe`。
- 真实后端结果：失败；`/mnt/e/code/PokeClaw/artifacts/dyq3-smoke/20260606-round5-real-48080-probe/responses/health_check.json` 内容为 `{"code":500,"data":null,"msg":"系统异常"}`。

## 第6轮证据｜2026-06-06 19:07 +0800
- 改动文件：`/mnt/e/code/PokeClaw/scripts/dyq3-endcloud-smoke.sh`。
- PokeClaw 提交：`6b09f7c fix(端云冒烟): 记录真实后端无待办任务阻塞`。
- 语法验证：`bash -n scripts/dyq3-endcloud-smoke.sh`，结果通过。
- Mock 验证命令：`MOCK_PORT=18406 USE_MOCK_BACKEND=1 bash scripts/dyq3-endcloud-smoke.sh artifacts/dyq3-smoke/20260606-round6-script-blocker-handling-mock`。
- Mock 结果：通过；`register/heartbeat/pending/result` 均 HTTP 200，`pendingTaskCount=1`，任务 `9c15aabc-defd-4c73-bc67-5dd8b9b24fa6` 已回传；证据 `/mnt/e/code/PokeClaw/artifacts/dyq3-smoke/20260606-round6-script-blocker-handling-mock/summary.md`。
- 真实后端验证命令：`USE_MOCK_BACKEND=0 DYQ_BASE_URL=http://127.0.0.1:48080 HEALTH_PATH=/admin-api/actuator/health bash scripts/dyq3-endcloud-smoke.sh artifacts/dyq3-smoke/20260606-round6-script-blocker-handling-real`。
- 真实后端结果：退出码 2（预期阻塞码）；健康检查通过，`register HTTP=200`，`heartbeat HTTP=200`，`pending HTTP=200`，`pendingTaskCount=0`；阻塞点为云端没有返回待执行任务 uuid；证据 `/mnt/e/code/PokeClaw/artifacts/dyq3-smoke/20260606-round6-script-blocker-handling-real/summary.md`。


## 第7轮证据｜2026-06-06 19:21 +0800
- 改动文件：`/mnt/e/code/PokeClaw/scripts/dyq3-endcloud-smoke.sh`。
- 语法与空白验证：`bash -n scripts/dyq3-endcloud-smoke.sh && git diff --check`，结果通过。
- 解析验证：Python 小样例验证 pending 返回的 `list.taskUuid`、`dict.tasks.taskUuid`、`dict.list.uuid` 均可解析出任务号。
- Mock 验证命令：`MOCK_PORT=18407 USE_MOCK_BACKEND=1 bash scripts/dyq3-endcloud-smoke.sh artifacts/dyq3-smoke/20260606-round7-task-seed-signature-mock`。
- Mock 结果：通过；证据 `/mnt/e/code/PokeClaw/artifacts/dyq3-smoke/20260606-round7-task-seed-signature-mock/summary.md`；任务号 `1c8ff74c-986a-45d6-a5aa-0e3fd2982001`；注册、心跳、任务拉取、结果回传、无令牌/坏令牌、断网异常均覆盖。
- 真实后端验证命令：`USE_MOCK_BACKEND=0 DYQ_BASE_URL=http://127.0.0.1:48080 HEALTH_PATH=/admin-api/actuator/health bash scripts/dyq3-endcloud-smoke.sh artifacts/dyq3-smoke/20260606-round7-task-seed-signature-real`。
- 真实后端结果：退出码 2（预期阻塞码）；健康检查通过，`register HTTP=200`，`heartbeat HTTP=200`，`pending HTTP=200`，业务码均通过；阻塞点仍为云端无待执行任务 uuid；证据 `/mnt/e/code/PokeClaw/artifacts/dyq3-smoke/20260606-round7-task-seed-signature-real/summary.md`。


## 第8轮证据｜2026-06-06 19:35 +0800
- 改动文件：`/mnt/e/code/PokeClaw/scripts/dyq3-endcloud-smoke.sh`、`/mnt/e/code/PokeClaw/QA_CHECKLIST.md`。
- 语法与空白验证：`bash -n scripts/dyq3-endcloud-smoke.sh && git diff --check -- scripts/dyq3-endcloud-smoke.sh`，结果通过。
- Mock 验证命令：`MOCK_PORT=18410 USE_MOCK_BACKEND=1 bash scripts/dyq3-endcloud-smoke.sh artifacts/dyq3-smoke/20260606-round8-http401-compatible-mock`。
- Mock 结果：通过；证据 `/mnt/e/code/PokeClaw/artifacts/dyq3-smoke/20260606-round8-http401-compatible-mock/summary.md`；任务号 `6c12970c-66c1-4625-965d-b5d47f19a8d5`；注册、心跳、任务拉取、结果回传、无令牌/坏令牌、断网异常均覆盖。
- 真实后端验证命令：通过脚本读取项目测试密码后执行 `ADMIN_SEED_TASK=1 USE_MOCK_BACKEND=0 DYQ_BASE_URL=http://127.0.0.1:48080 HEALTH_PATH=/admin-api/actuator/health DEVICE_ID=pokeclaw-round8-real-seed-v3 bash scripts/dyq3-endcloud-smoke.sh artifacts/dyq3-smoke/20260606-round8-real-seed-v3`。
- 真实后端结果：通过；健康检查、register、heartbeat、admin_login、admin_execute、pending、result 均通过；无令牌/坏令牌真实返回 HTTP 401 且业务码 401；断网异常触发；任务号 `289afa762d324a04881290283e4a504a` 已回传。
- 判定：P1.2/P1.3/P1.4 从模拟闭环推进为真实 48080 任务下发到结果回传闭环；C1 register/heartbeat/result 契约可作为 WeFlow 设备节点接入基线。

## 第9轮证据｜2026-06-06 19:47 +0800
- 改动文件：`/mnt/d/work/code/WeFlow/scripts/weflow-dyq-device-register.py`。
- WeFlow 提交：`a4dd40b fix(微信端侧): 修正DYQ设备节点探测地址`。
- 语法验证：`python3 -m py_compile scripts/weflow-dyq-device-register.py`，结果通过。
- 契约探测命令：`DYQ_BASE_URL=http://127.0.0.1:48080 DYQ_HEALTH_PATH=/admin-api/actuator/health python3 scripts/weflow-dyq-device-register.py`。
- 契约探测结果：DYQ 主后端健康检查识别为就绪；生成的 WeFlow 注册/心跳/任务领取/结果回传示例已指向本机 48080 真实端点，任务领取为 `GET /api/claw-device/devices/{deviceId}/pending-tasks`，结果回传为 `POST /api/claw-device/tasks/{taskId}/result`。
- 真实 register/heartbeat 验证文件：`/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round9-20260606-1946-weflow/weflow_live_register_heartbeat.json`。
- 真实结果摘要：设备 `weflow-round9-1780746437`，register HTTP 200、业务码 0、返回设备令牌；heartbeat HTTP 200、业务码 0、`pendingTaskCount=0`；`passed=true`。
- 判定：W1.3 从文档/旧示例推进为真实 DYQ 48080 设备节点注册和心跳可用；下一步进入任务领取与微信安全草稿回执闭环。


## 第10轮证据｜2026-06-06 19:57 +0800
- 改动文件：`/mnt/d/work/code/WeFlow/scripts/weflow-dyq-device-register.py`、`/mnt/d/work/code/WeFlow/scripts/test_weflow_dyq_safe_draft.py`。
- RED 证据：首次运行 `python3 scripts/test_weflow_dyq_safe_draft.py` 失败，原因是缺少 `create_safe_draft_result`。
- GREEN 验证：`python3 scripts/test_weflow_dyq_safe_draft.py` 通过 2 个用例，证据文件 `evidence/round10-20260606-weflow-safe-draft/weflow_safe_draft_unittest.txt`。
- 语法与空白验证：`python3 -m py_compile scripts/weflow-dyq-device-register.py scripts/test_weflow_dyq_safe_draft.py && git diff --check -- scripts/weflow-dyq-device-register.py scripts/test_weflow_dyq_safe_draft.py`，结果通过。
- 契约探针：`DYQ_BASE_URL=http://127.0.0.1:48080 DYQ_HEALTH_PATH=/admin-api/actuator/health python3 scripts/weflow-dyq-device-register.py`，结果通过，DYQ 服务器就绪，结果回传示例包含 `draft.requiresHumanConfirmation=true`、`sendActionExecuted=false`、`safetyDecision=HUMAN_CONFIRM_REQUIRED`。
- 证据目录：`/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round10-20260606-weflow-safe-draft/`。
- 提交：WeFlow 本地提交 `6d087a8 fix(微信端侧): 增加DYQ任务安全草稿回执`。
- 判定：W1.3/W2.1 从“注册/心跳可用”推进到“任务领取后可安全生成微信人工确认草稿”，未触发真实微信发送。


## 第11轮证据｜2026-06-06 20:07 +0800
- 改动文件：`/mnt/d/work/code/WeFlow/scripts/weflow-dyq-device-register.py`、`/mnt/d/work/code/WeFlow/scripts/test_weflow_dyq_safe_draft.py`。
- RED 证据：首次运行 `python3 scripts/test_weflow_dyq_safe_draft.py` 失败，原因是缺少 `extract_first_pending_task` 与 `build_signed_result_request`；记录见 `evidence/round11-20260606-weflow-result-signature/red-test-output.txt`。
- GREEN 验证：`python3 scripts/test_weflow_dyq_safe_draft.py` 通过 4 个用例，覆盖 pending 响应抽取、安全草稿转换、真实发送降级、结果回传签名可复算。
- 语法与空白验证：`python3 -m py_compile scripts/weflow-dyq-device-register.py scripts/test_weflow_dyq_safe_draft.py && git diff --check -- scripts/weflow-dyq-device-register.py scripts/test_weflow_dyq_safe_draft.py`，结果通过。
- 契约探针：`DYQ_BASE_URL=http://127.0.0.1:48080 DYQ_HEALTH_PATH=/admin-api/actuator/health python3 scripts/weflow-dyq-device-register.py`，结果通过，DYQ 服务器就绪，结果回传示例已指向 `/api/claw-device/tasks/{taskId}/result` 并可生成签名头。
- 证据目录：`/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round11-20260606-weflow-result-signature/`，包含 `red-test-output.txt`、`unit-test-output.txt`、`verification-command-output.txt`、`weflow_contract_probe.txt`、`git-status-diffstat.txt`。
- 提交：WeFlow 本地提交 `05b751f fix(微信端侧): 补齐DYQ安全草稿结果签名`。
- 判定：W1.3/W2.1 从“安全草稿结果体”推进为“pending 领取输出可转草稿 + result 请求可按设备令牌签名回传”，仍未执行真实微信发送。

## 第 12 轮证据：W2.2 WeFlow运行标记与退出快捷键前置门禁

- 时间：2026-06-06 20:17:37 +0800
- 改动文件：
  - `/mnt/d/work/code/WeFlow/wechat-controller/tests/controller/test_dyq_device_node_contract.py`
  - `/mnt/d/work/code/WeFlow/wechat-controller/controller/services/dyq_device_node_contract.py`
  - `/mnt/d/work/code/WeFlow/wechat-controller/controller/app.py`
- RED：`python -m pytest wechat-controller/tests/controller/test_dyq_device_node_contract.py::test_device_node_runtime_safety_status_exposes_marker_and_exit_hotkey_before_external_send -q`，失败原因为接口返回 HTTP 404。
- GREEN：`python -m pytest wechat-controller/tests/controller/test_dyq_device_node_contract.py::test_device_node_runtime_safety_status_exposes_marker_and_exit_hotkey_before_external_send -q`，通过 1 个用例。
- 回归：`python -m pytest wechat-controller/tests/controller/test_dyq_device_node_contract.py -q`，通过 4 个用例。
- 差异检查：`git diff --check` 通过。
- 安全判定：`externalSendAllowed=false`，真实微信发送仍被门禁阻断。
- WeFlow 本地提交：`2f47392 feat(微信端侧): 增加运行安全门禁接口`。

## 第 13 轮证据：W2.2 WeFlow真实退出快捷键执行层统一

- 时间：2026-06-06 20:27:23 +0800
- 改动文件：
  - `/mnt/d/work/code/WeFlow/wechat-controller/windows_agent/services/hotkey.py`
  - `/mnt/d/work/code/WeFlow/wechat-controller/windows_agent/services/listener.py`
  - `/mnt/d/work/code/WeFlow/wechat-controller/windows_agent/app.py`
  - `/mnt/d/work/code/WeFlow/wechat-controller/tests/windows_agent/test_hotkey_monitor.py`
  - `/mnt/d/work/code/WeFlow/wechat-controller/tests/windows_agent/test_listener_hotkey_stop.py`
- 推进点：真实 Windows Agent 监听键位从旧 `Ctrl+1` 统一为安全接口声明的 `Ctrl+Alt+Q`；退出原因同步为 `hotkey:ctrl+alt+q`；保留旧类名兼容别名。
- 验证命令：`python -m pytest wechat-controller/tests/windows_agent/test_hotkey_monitor.py wechat-controller/tests/windows_agent/test_listener_hotkey_stop.py wechat-controller/tests/controller/test_dyq_device_node_contract.py -q`，通过 6 个用例。
- 语法与空白验证：`python -m py_compile ... && git diff --check -- ...`，结果通过。
- 证据文件：`/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round13-20260606-weflow-hotkey-unify/verification.txt`。
- WeFlow 本地提交：`770d852 fix(微信端侧): 统一安全退出快捷键`。
- 安全判定：未执行真实微信发送，`externalSendAllowed=false` 继续生效。

## 第 14 轮证据：W1.3/W2.1 WeFlow真实HTTP封装

- 时间：2026-06-06 20:38:39 +0800
- 改动文件：
  - `/mnt/d/work/code/WeFlow/scripts/weflow-dyq-device-register.py`
  - `/mnt/d/work/code/WeFlow/scripts/test_weflow_dyq_safe_draft.py`
- RED 证据：首次运行 `python3 scripts/test_weflow_dyq_safe_draft.py` 失败，原因是缺少 `_http_json_request`。
- GREEN 验证：`python3 scripts/test_weflow_dyq_safe_draft.py` 通过 5 个用例，新增覆盖 `process_one_pending_task`：GET pending、生成安全草稿、POST result、签名头存在、`sendActionExecuted=false`。
- 语法与空白验证：`python3 -m py_compile scripts/weflow-dyq-device-register.py scripts/test_weflow_dyq_safe_draft.py` 通过；`git diff --check -- scripts/weflow-dyq-device-register.py scripts/test_weflow_dyq_safe_draft.py` 通过。
- 真实 DYQ 48080 验证：`live-register-pending-output.txt` 显示 register HTTP 200、业务码 0、获得 token；pending HTTP 200、业务码 0、当前待办列表为空。
- 证据目录：`/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round14-20260606-weflow-real-http-wrapper/`。
- WeFlow 本地提交：`586d896 fix(微信端侧): 封装DYQ安全草稿回传调用`。
- 安全判定：未执行真实微信发送，安全草稿回传仍保持 `sendActionExecuted=false`。

## 第15轮证据｜2026-06-06 20:49 +0800
- 改动文件：`/mnt/d/work/code/WeFlow/scripts/weflow-dyq-device-register.py`、`/mnt/d/work/code/WeFlow/scripts/test_weflow_dyq_safe_draft.py`。
- RED 证据：新增 `test_管理后台通用指令可降级为微信安全草稿文本` 后首次运行失败，原因为 admin execute 的通用 `command` 未解析进草稿文本，`draft.text=None`。
- GREEN 验证：`python3 scripts/test_weflow_dyq_safe_draft.py` 通过 6 个用例。
- 语法与空白验证：`python3 -m py_compile scripts/weflow-dyq-device-register.py scripts/test_weflow_dyq_safe_draft.py && git diff --check -- scripts/weflow-dyq-device-register.py scripts/test_weflow_dyq_safe_draft.py`，结果通过。
- 真实闭环证据文件：`/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round15-20260606-weflow-real-safe-draft/real-safe-draft-result.json`。
- 真实闭环摘要：设备 `weflow-round15-1780750190`；register HTTP 200、业务码 0；heartbeat HTTP 200、业务码 0；admin execute HTTP 200、业务码 0，任务 `640d01d67542415f920047c7664e169f`；pending→safeDraft→signed result 成功，result HTTP 200、业务码 0。
- 安全判定：`safeDraftStatus=prepared`，`sessionName=文件传输助手`，`sendActionExecuted=false`，`manualTakeoverRequired=true`；未执行真实微信发送。
- WeFlow 本地提交：`5ad794c fix(微信端侧): 打通云端任务安全草稿闭环`。
- 判定：W1.3/W2.1 从“真实 HTTP 封装可用”推进为“真实 DYQ 云端任务下发到 WeFlow 安全草稿回传闭环可用”。

## 第16轮证据｜2026-06-06 21:01 +0800
- 改动文件：`/mnt/d/work/code/WeFlow/scripts/weflow-dyq-device-register.py`、`/mnt/d/work/code/WeFlow/scripts/test_weflow_dyq_safe_draft.py`。
- RED 证据：新增 `test_微信监听事件可封装为云端上报结果且不触发发送` 后首次运行失败，原因是缺少 `create_wechat_event_report_result`。
- GREEN 验证：`python3 scripts/test_weflow_dyq_safe_draft.py` 通过 7 个用例。
- 语法与空白验证：`python3 -m py_compile scripts/weflow-dyq-device-register.py scripts/test_weflow_dyq_safe_draft.py && git diff --check -- scripts/weflow-dyq-device-register.py scripts/test_weflow_dyq_safe_draft.py`，结果通过。
- 契约探针：`event-report-contract-probe.json` 显示云端上报体 `status=reported`、`eventType=wechat.message.receive`、`latestMessage=第16轮微信事件云端上报验证`，签名请求路径为 `/api/claw-device/tasks/task-event-round16/result`，`hasSignature=true`。
- 安全判定：`sendActionExecuted=false`，`cloudReportOnly=true`，未执行真实微信发送。
- 证据目录：`/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round16-20260606-weflow-event-report/`。
- 判定：W1.4 从“本地事件预览”推进为“可复用设备 result 签名通道的微信事件云端上报契约”。

## 第17轮证据｜2026-06-06 21:12 +0800
- 改动文件：`/mnt/d/work/code/WeFlow/scripts/weflow-dyq-device-register.py`、`/mnt/d/work/code/WeFlow/scripts/test_weflow_dyq_safe_draft.py`。
- RED 证据：新增 `test_微信监听事件可按设备签名回传云端` 后首次运行失败，原因是缺少 `submit_wechat_event_report`。
- GREEN 验证：`python3 scripts/test_weflow_dyq_safe_draft.py` 通过 8 个用例。
- 语法与空白验证：`python3 -m py_compile scripts/weflow-dyq-device-register.py scripts/test_weflow_dyq_safe_draft.py && git diff --check -- scripts/weflow-dyq-device-register.py scripts/test_weflow_dyq_safe_draft.py`，结果通过。
- 契约探针：`event-submit-contract-probe.json` 显示云端上报体 `status=reported`、`eventType=wechat.message.receive`、`latestMessage=第17轮微信事件签名回传验证`，签名请求路径为 `/api/claw-device/tasks/task-event-round17/result`，且 `hasSignature=true`。
- 安全判定：`sendActionExecuted=false`，`cloudReportOnly=true`，未执行真实微信发送。
- WeFlow 本地提交：`e84d786 fix(微信端侧): 补齐事件签名回传封装`。
- 判定：W1.4 从“可生成事件上报结果”推进为“可按设备签名规则把微信事件结果回传 DYQ 云端 result 通道”。

## 第18轮证据｜2026-06-06 21:22 +0800
- 改动文件：`/mnt/d/work/code/WeFlow/wechat-controller/controller/services/dyq_device_node_contract.py`、`/mnt/d/work/code/WeFlow/wechat-controller/tests/controller/test_dyq_device_node_contract.py`。
- RED 证据：扩展运行安全测试后首次运行失败，原因是 `runningMarker.displayText` 缺失。
- GREEN 验证：`python -m pytest tests/controller/test_dyq_device_node_contract.py -q` 通过 4 个用例，记录见 `evidence/round18-20260606-weflow-runtime-marker/unit-test-output.txt`。
- 语法与空白验证：`python -m py_compile controller/services/dyq_device_node_contract.py tests/controller/test_dyq_device_node_contract.py` 通过；`git diff --check -- ...` 通过，记录见 `syntax-diffcheck-output.txt`。
- 契约探针：`runtime-safety-contract.json` 显示 HTTP 200，`displayText=WeFlow｜托管｜微信、DYQ后端｜Ctrl+Alt+Q 安全退出｜真实发送前人工确认`，`desktopEvidenceRequired=true`，验收清单包含桌面可见项目名/托管模式/连接对象/退出快捷键。
- 安全判定：`externalSendAllowed=false`，本轮未执行真实微信发送。
- WeFlow 本地提交：`85a4c65 feat(微信端侧): 补齐桌面运行标记契约`。
- 判定：W2.2 从“声明有运行安全接口”推进为“可渲染桌面运行标记文本 + 可验收截图清单”的最小可视化契约。

## 第19轮证据｜2026-06-06 21:34 +0800
- 目标：S2.2 私信触达转 WeFlow 承接。
- 改动文件：`/mnt/d/work/code/social-media-web-automation/src/operations/weflow-lead-handoff.ts`、`/mnt/d/work/code/social-media-web-automation/tests/weflow-lead-handoff.test.ts`。
- 社媒提交：`3c7eeb5 feat(线索承接): 生成DYQ安全草稿任务种子`。
- RED证据：新增测试后首次运行 `npm test -- tests/weflow-lead-handoff.test.ts` 失败，错误为 `does not provide an export named buildDyqWeFlowTaskSeed`。
- GREEN验证：`npm test -- tests/weflow-lead-handoff.test.ts` 通过，108 个用例通过。
- 类型验证：`npm run typecheck` 通过。
- 空白验证：`git diff --check -- src/operations/weflow-lead-handoff.ts tests/weflow-lead-handoff.test.ts` 通过。
- 安全判定：只生成 `wechat.message.prepare_text` 安全草稿任务种子，不点击发送、不关注、不点赞、不绕过登录或风控；任务种子显式标记 `externalActionAllowed=false`、`requiresHumanConfirmation=true`。


## 第20轮证据｜2026-06-06 21:48 +0800
- 目标：S2.2 自动化截流获客线索 → DYQ 云端任务下发 → WeFlow 微信安全草稿 → 签名 result 回传。
- 新增证据脚本：`/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round20-20260606-s2-weflow-live/run_social_to_weflow_live.py`。
- 证据输出：`/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round20-20260606-s2-weflow-live/live_probe_output.json`。
- 验证命令：通过项目已存在测试登录口径读取管理后台密码后执行 `python3 run_social_to_weflow_live.py`，脚本不打印令牌或密码。
- 验证结果：`passed=true`；register、heartbeat、adminLogin、adminExecute、pendingToSafeDraftResult 均 HTTP 200 且业务码 0；真实任务号 `daaf83af75044c2bb333cd4ea57197bf`。
- 安全证据：社媒种子 `externalActionAllowed=false/requiresHumanConfirmation=true`；WeFlow 草稿 `status=prepared`、`commandType=wechat.message.prepare_text`、`sendActionExecuted=false`、`manualTakeoverRequired=true`；未触发真实微信发送。
- 判定：S2 截流获客从“线索转种子”推进为“真实云端下发给 WeFlow 并安全回执”的可验收闭环，可作为后续直播间截流/私域承接的共用通道。


## 第21轮证据｜2026-06-06 22:00 +0800
- 目标：S2.2 私信触达转 WeFlow 承接的社媒控制台人工确认队列可视化。
- 改动文件：`/mnt/d/work/code/social-media-web-automation/src/console/read-only-dashboard.ts`、`/mnt/d/work/code/social-media-web-automation/tests/read-only-dashboard.test.ts`。
- 红灯证据：新增测试后首次运行 `npm test -- --test-name-pattern='控制台只读总览'` 失败，错误为 `Cannot read properties of undefined (reading 'total')`，证明快照缺少 `confirmationQueueSummary`。
- 绿灯证据：实现 `ConfirmationQueueSummary`、`summarizeConfirmationQueue` 和面板行 `人工确认概览: 总数 ...` 后，`npm test -- --test-name-pattern='控制台只读总览'` 通过 108 项。
- 类型验证：`npm run typecheck` 通过。
- 空白验证：`git diff --check` 通过。
- 安全边界：只读总览仅展示人工确认草稿统计和内容，不提供自动发送入口；真实外部可见动作仍需人工复制到真实浏览器处理。

## 第 1 轮证据

- C1 主后端 48080 最小闭环：`/mnt/e/code/dyq/.planning/audit/runs/20260606-djs-round1-dyq-claw/summary.md`
  - 健康检查 HTTP 200
  - 设备注册 HTTP 200
  - 设备心跳 HTTP 200
  - 待处理任务 HTTP 200
  - 令牌已脱敏
- P1/P2 PokeClaw 端侧 mock 闭环：`/mnt/e/code/PokeClaw/artifacts/dyq3-smoke/20260606-djs-round1-auth-header-mock/summary.md`
  - 注册/心跳/任务拉取/结果回传均 HTTP 200
  - 无令牌与坏令牌均有可见 401 业务报错
  - 断网异常有原始输出证据
- 语法和格式：`bash -n`、`git diff --check` 均通过。

