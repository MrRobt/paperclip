## 第39轮证据｜2026-06-07 04:42 +0800｜Web 目标池可视化与三端入口

- 目标：Web 管理后台新增三主线（Claw/PokeClaw/WeFlow + 自动化赚钱场景）目标池可视化卡片与三端入口
- 改动文件：
  - `/mnt/e/code/ai-ui-admin-vue3aa/src/api/claw/goalPool.ts` (485 行)：新增 75 目标池数据契约、`getGoalPool`/`getGoalPoolSnapshot`/`loadGoalPool` 容错装载、`normalizeGoalPool` 归一化
  - `/mnt/e/code/ai-ui-admin-vue3aa/src/api/claw/goalPool.test.ts` (224 行)：13 个 vitest 用例
  - `/mnt/e/code/ai-ui-admin-vue3aa/src/views/claw/home/components/GoalPoolOverview.vue` (449 行)：三端入口子目标状态卡组件
  - `/mnt/e/code/ai-ui-admin-vue3aa/src/views/claw/goals/index.vue`：独立 `/claw/goals` 页面
  - `/mnt/e/code/ai-ui-admin-vue3aa/src/router/modules/base.ts`：新增 hidden `canTo` 兜底路由 `/claw/goals`
  - `/mnt/e/code/ai-ui-admin-vue3aa/src/views/claw/home/index.vue`：在 `MainlineOverview` 之后接入 `GoalPoolOverview`

- 业务产出：管理后台首页 `/claw/home` 和独立页面 `/claw/goals` 可直接看到 4 主线汇总（子目标总数/进行中/待启动/阻塞）、16 个子目标状态卡（Claw C1-C4、PokeClaw P1-P4、WeFlow W1-W4、S1-S4）、每个子目标都绑定端入口（Claw 中枢/管理后台/设备节点/指挥台）和待办/阻塞点摘要

- 验证命令与结果：
  - `pnpm test:run src/api/claw/goalPool.test.ts src/api/claw/overview.test.ts`：13 + 9 = 22 个用例通过
  - `pnpm test:run src/api/claw/`：3 个测试文件 28 个用例全过（goalPool 13 + overview 9 + commercialEvidence 6）
  - `pnpm ts:check` (vue-tsc --noEmit)：200 秒内完成，退出码 0，无类型错误
  - `git -c core.whitespace=trailing-space,cr-at-eol diff --check -- <改动文件>`：通过，无空白警告

- DYQ 健康：48080 `/admin-api/actuator/health` HTTP 200
- 软阻塞：Vite dev server 在 WSL/NTF 冷启动 60 秒后仍未监听 5189 端口（与第32/34/36/38轮相同）；不阻塞本轮契约和测试，可由下一轮用真实浏览器验收 `http://127.0.0.1:5189/#/claw/goals`
- 安全判定：未触碰任何设备/微信/真实资金链路，纯前端可视化与跳转入口
