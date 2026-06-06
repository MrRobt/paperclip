# 实施计划

STATUS: IN_PROGRESS

## 状态机

当前状态：BUILDING
当前轮次：21 / 1000

## 阶段计划

1. 摸底目标池、项目上下文、仓库状态。
2. 建立 C1/P1/W1/S1 的最小闭环任务列表。
3. 优先推进 C1 主后端 48080、register、heartbeat 证据。
4. 推进 PokeClaw 端侧注册和心跳链路。
5. 推进 WeFlow 微信托管安全回复链路。
6. 推进自动化赚钱场景的最小可验收闭环。
7. 扩展到其余 active/planned 目标。

## 下一轮候选

- C1.1：已完成 dev 主后端 48080 健康误判修复；第 4 轮补齐连续稳定证据第 3 次，健康端点保持 `UP`，register/heartbeat 保持通过；后续只需按需做冷重启证据。
- C1.3/P1.2/P1.3：下一轮优先摸底 PokeClaw 端侧真实调用路径和设备元数据字段，把当前模拟元数据替换为端侧可复用契约。
- W1.3：复用 register/heartbeat 设备节点契约，摸底 WeFlow 作为设备节点注册所需字段。
- 第5轮（2026-06-06 18:58）：P1/PokeClaw Mock 端云闭环复核通过；真实 48080 健康业务码 500，C1 仍阻塞真实端云。
- 第6轮（2026-06-06 19:07）：修复 PokeClaw 冒烟脚本对真实后端 pending 为空时的崩溃误判；真实 48080 已通过健康、register、heartbeat、pending HTTP/业务码，阻塞收敛为云端暂无待执行 task uuid，需下一轮创建/分配真实任务种子。

- 第7轮（2026-06-06 19:21）：PokeClaw 冒烟脚本补齐真实任务种子与 result 签名能力；Mock 全链路通过，真实 48080 仍停在无待执行任务 uuid。下一轮若有管理后台密码，执行 `ADMIN_SEED_TASK=1` 完成真实任务下发到 result 回传闭环；若无密码，则转向后端只读摸底任务创建接口契约。
- 第8轮（2026-06-06 19:35）：P1/PokeClaw 真实 48080 端云闭环已打通；脚本补齐管理后台 `tenant-id`、真实任务种子下发、result 签名、HTTP 401 鉴权兼容。Mock 与真实 48080 均通过，任务 `289afa762d324a04881290283e4a504a` 完成 pending 拉取与 result 回传。下一轮转向 W1.3，摸底 WeFlow 作为 DYQ 设备节点注册字段并复用 register/heartbeat 契约。
- 第9轮（2026-06-06 19:47）：W1.3 已完成最小真实推进；修正 WeFlow 设备节点脚本的 DYQ 主后端地址、健康路径、pending/result 真实端点示例，并用真实 48080 完成 WeFlow 设备 register/heartbeat 冒烟。下一轮继续补 WeFlow 任务领取到安全草稿回执的最小闭环。
- 第10轮（2026-06-06 19:57）：W1.3/W2.1 最小安全回执推进；WeFlow 已新增 DYQ pending task → 微信安全草稿回执转换函数与单元测试，send_text 任务强制降级为人工确认草稿，不执行真实发送。下一轮可把 pending-tasks 真实领取结果接入该转换，并补 result 签名回传。
- 第11轮（2026-06-06 20:07）：W1.3/W2.1 继续推进；WeFlow 已补 `extract_first_pending_task` 和 `build_signed_result_request`，可把 DYQ pending-tasks 响应抽取为安全草稿，并按 PokeClaw 已验证规则生成 `X-Claw-Timestamp/X-Claw-Nonce/X-Claw-Signature` 结果回传请求。本地提交 `05b751f`。下一轮可接入真实注册令牌后的 pending/result HTTP 调用封装，或转向 W2.2 GUI 安全发送前置运行标记/退出键验收。
- 第12轮（2026-06-06 20:17）：W2.2 最小前置门禁推进；WeFlow 新增 `/dyq/device-node/runtime-safety`，可被云端/验收脚本查询运行标记、托管模式、连接对象、退出快捷键和安全停止动作，并明确真实外部发送 `externalSendAllowed=false`。下一轮接入真实桌面标记/退出键执行层并补截图或桌面验收证据。
- 第13轮（2026-06-06 20:27）：W2.2 真实退出键执行层推进；WeFlow Windows Agent 实际监听从旧 `Ctrl+1` 统一为运行安全接口声明的 `Ctrl+Alt+Q`，Listener 停止原因改为 `hotkey:ctrl+alt+q`，并保留旧类名兼容别名。本地提交 `770d852`。下一轮补桌面运行标记可视化截图/说明，或接入真实 pending/result HTTP 调用封装。

- 第14轮（2026-06-06 20:38）：W1.3/W2.1 真实HTTP封装推进；WeFlow 已新增真实 pending 领取、安全草稿生成、签名 result 回传封装，并用 DYQ 48080 验证 register/pending HTTP 通路。下一轮创建真实微信草稿任务种子后跑通 pending→safeDraft→result 全闭环。
- 第15轮（2026-06-06 20:49）：W1.3/W2.1 真实微信安全草稿任务闭环已打通；WeFlow 可解析管理后台 execute 通用 command 为安全草稿字段，并用真实 48080 完成 register→heartbeat→admin execute→pending→safeDraft→signed result。下一轮转向 W2.2 桌面运行标记可视化证据，或推进 W1.4 微信事件上报云端最小接口封装。
- 第16轮（2026-06-06 21:01）：W1.4 最小事件上报推进；WeFlow 新增微信监听事件→云端只读事件结果封装，可复用已验证的签名 result 通道上报 `wechat.message.receive`，并明确 `sendActionExecuted=false/cloudReportOnly=true`。下一轮可把该事件上报结果接入真实 `/dyq/device-node/events` 拉取结果，或补 W2.2 桌面运行标记可视化证据。
- 第17轮（2026-06-06 21:12）：W1.4 事件上报签名回传推进；WeFlow 新增 `submit_wechat_event_report`，把本地微信监听事件封装为云端只读结果后按设备令牌签名 POST 到 DYQ result 通道，单测覆盖 HTTP 200/业务码 0 回传路径，且继续保证 `sendActionExecuted=false/cloudReportOnly=true`。下一轮可补 W2.2 桌面运行标记可视化证据，或转向 S1 自动化赚钱场景最小可验收闭环摸底。

- 第18轮（2026-06-06 21:22）：W2.2 桌面运行标记契约推进；WeFlow runtime-safety 接口补齐可渲染桌面标记文案、截图证据要求和四项可视化验收清单，继续保持 externalSendAllowed=false。下一轮可转 S1 自动化赚钱场景最小闭环摸底，或接入真实桌面浮层进程/截图证据。

- 第19轮（2026-06-06 21:34）：S2.2 自动化截流获客最小闭环推进；社媒自动化仓库新增 `buildDyqWeFlowTaskSeed`，可把高意向私信线索转换为 DYQ 管理后台可下发给 WeFlow 的 `wechat.message.prepare_text` 安全草稿任务种子，安全边界继续保持 `externalActionAllowed=false/requiresHumanConfirmation=true`。下一轮可用真实 DYQ admin execute 下发该种子给 WeFlow，验证 pending→safeDraft→result 端到端闭环。

- 第20轮（2026-06-06 21:48）：S2.2→W1/W2 真实端到端闭环通过；社媒高意向线索种子已通过真实 DYQ 48080 管理后台 execute 下发给 WeFlow 设备节点，WeFlow pending 领取后生成安全草稿并按设备令牌签名回传 result。关键安全边界：`requiresHumanConfirmation=true`、`externalActionAllowed=false`、`sendActionExecuted=false`、`manualTakeoverRequired=true`。下一轮可把该能力固化到社媒控制台人工确认队列/可视化证据，或推进 S1 直播间截流脚本到同一任务种子接口。

- 第21轮（2026-06-06 22:00）：S2.2 社媒控制台可视化队列推进；只读总览新增人工确认草稿统计字段与面板行，可直接展示待确认发布/评论/私信数量和低/中/高风险分布，服务于“线索→WeFlow安全草稿→人工确认队列”的运营验收。验证：`npm test -- --test-name-pattern='控制台只读总览'` 通过 108 项；`npm run typecheck` 通过。下一轮可把 S1 直播间/热点线索同样接入该确认队列统计，或补真实控制台截图证据。

- [x] 第 1 轮：完成 C1/P1 最小可验证推进，打通 48080 设备注册/心跳/待处理任务运行态冒烟，并修复 PokeClaw mock 鉴权头脚本。
- [ ] 第 2 轮：基于真实 48080 注册成功，补管理后台可触达设备入口或前端页面真实浏览器验证。
