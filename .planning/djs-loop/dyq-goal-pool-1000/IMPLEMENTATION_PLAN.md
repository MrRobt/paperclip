# 实施计划

STATUS: IN_PROGRESS

## 状态机

当前状态：IN_PROGRESS
当前轮次：31 / 1000

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

- 本次会话第2轮/累计第22轮（2026-06-06 22:23）：PokeClaw 修复端云冒烟脚本令牌头真实请求，Mock 与真实 48080 管理后台下发→pending→result 签名回传均通过；WeFlow 控制契约复核通过。下一轮转 S1 直播间/热点线索任务种子或补控制台/桌面可视化证据。

- 本次会话第3轮/累计第23轮（2026-06-06 22:40）：S2/S1 场景归类可视化推进；社媒控制台人工确认草稿新增业务场景字段和只读总览场景统计，S2 高意向私信线索默认归入 `S2截流获客`，运营可区分自动化赚钱场景来源且仍无外部发送入口。本地提交 `094bda0`。下一轮优先把 S1 直播间/热点线索接入同一归类，或补真实控制台截图证据。

- 本次会话第4轮/累计第24轮（2026-06-06 22:45）：S1 直播间/热点线索接入人工确认队列；社媒仓库新增 `buildLiveRoomLeadConfirmationDraft` 与批量入队函数，把高意向直播间观察结果转为 `S1直播间截流` 评论草稿，低意向直接拒绝，继续保持不自动评论/私信/关注/点赞。本地提交 `9658a71`。下一轮可把真实小红书只读提取结果接入该 S1 草稿生成器，补控制台真实面板/截图证据。

- 本次会话第5轮/累计第25轮（2026-06-06 23:03）：S1 小红书只读详情结果已接入人工确认队列；社媒仓库新增 `enqueueXiaohongshuLiveLeadDetailsToConfirmationQueue`，可批量接收 CDP 只读详情提取结果，自动跳过登录/验证码/风控项，把高意向详情生成 `S1直播间截流` 评论草稿并进入只读控制台人工确认队列。本地提交 `b77ab9b`。下一轮可接真实 CDP 小红书只读搜索输出，或把 S1 草稿下发到 DYQ→WeFlow 安全草稿闭环。
- 本次会话第6轮/累计第26轮（2026-06-06 23:15）：S1 草稿已真实下发到 DYQ→WeFlow 安全草稿闭环；社媒 S1 小红书只读详情草稿生成后，经 DYQ 48080 管理后台 execute 下发给 WeFlow 设备节点，WeFlow pending 领取并签名回传安全草稿 result，任务 `7365f8dc4def4af8a6baa99d6d8e841a` 完成。安全边界：`externalActionAllowed=false`、`requiresHumanConfirmation=true`、`sendActionExecuted=false`。下一轮可接真实 CDP 小红书搜索输出并复用本轮闭环脚本，或补控制台/桌面截图证据。


### 第28轮完成项
- [x] P1/P2：新增 PokeClaw 端侧本地闭环证据入口，避免真机/云端短期不可用时只能空巡检。
- [x] P1/P2：新增证据格式测试，覆盖六类端侧执行结果。
- [x] P1/P2：更新 QA_CHECKLIST 的 DYQ-28/P1-P2 记录与 Z8-4 验收项。
- [x] 集成：PokeClaw 已本地提交；Paperclip 状态文档记录本轮证据。
- [ ] 下一轮：若 ADB 真机上线，运行同入口并补真机安装/界面或日志截图证据；否则转 W1/W2 微信安全草稿或 S1 自动化赚钱最小闭环。


### 第29轮完成项
- [x] S1：新增小红书只读搜索结果到人工确认评论草稿的可操作预览入口。
- [x] S1：预览输出包含面板和结构化摘要，可直接作为运营验收证据。
- [x] A泳道：DYQ 48080 健康复核通过，可继续承接后续任务下发。
- [x] B/C联动：WeFlow 安全草稿回归通过，确认下游安全边界未破坏。
- [x] 集成：社媒仓库已本地提交；Paperclip 状态文档记录本轮证据。
- [ ] 下一轮：主人打开小红书或已有标签后，用 CDP 只读搜索输出喂给 `npm run s1:xhs-search-preview -- <json>`，再接 DYQ→WeFlow 安全草稿闭环。


### 第30轮完成项
- [x] B泳道/P1-P2：PokeClaw 本地闭环证据包新增运营可读看板 `operator-dashboard.md`。
- [x] B泳道/P1-P2：看板覆盖成功执行、可重试失败、不可重试失败、执行超时、权限缺失、离线缓存六类端侧结果，并给出运营含义和下一步动作。
- [x] A泳道：复核 DYQ 48080 健康端点 HTTP 200/status UP，确认云端中枢仍可承接后续任务。
- [x] 集成：PokeClaw 已本地提交；Paperclip 状态文档与证据目录已更新。
- [ ] 下一轮：若 ADB 真机上线，补真机安装/运行标记/截图证据；否则继续推进 PokeClaw 真实接口调用或 S1 真实 CDP 输出到 DYQ→WeFlow 闭环。

- 第31轮（2026-06-07 00:45）：P1/P2 PokeClaw 新增机器可读 `operator-status.json`，本地闭环证据可被云端主控/看板直接消费；PokeClaw 提交 `c177e4b`。下一轮优先 A泳道，把该状态接入 Claw 概览/设备治理入口，形成云端可见设备状态卡。
