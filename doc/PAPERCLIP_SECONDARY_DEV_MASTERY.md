# 纸夹二次开发操作手册与主控规则

**文档定位**：本文档面向纸夹二次开发团队，用于规范任务派发、执行、验收全流程。确保主控（Owner）与Agent之间高效协作，收敛噪声，保障交付质量。

**适用范围**：纸夹系统自身的功能迭代、bug修复、性能优化。

**关联文档**：
- `GOAL.md` — 项目愿景与架构原则
- `PRODUCT.md` — 产品定义与设计目标
- `SPEC-implementation.md` — V1实现规范
- `DEVELOPING.md` — 本地开发与部署指南
- `PAPERCLIP_SELF_OPTIMIZATION_RUNBOOK.md` — 纸夹自优化团队操作手册

---

## 一、核心原则（三条红线）

1. **不直接改库** — 排查可用只读查询，写入必须通过纸夹接口（curl/API）
2. **带完整授权** — 写入必须带 `Authorization: Bearer TOKEN` 和 `X-Paperclip-Run-Id`
3. **不让任务空转** — 卡住、无产出、无进展的任务要主动补上下文、拆任务或重新分派

---

## 二、如何派活（标准流程）

### 2.1 派活前自查清单

| 检查项 | 要求 |
|--------|------|
| 目标对齐 | 确认任务服务于当前活跃目标（Goal）|
| 范围可控 | 单任务控制在1-2天可完成 |
| 验收标准 | 描述中必须包含完成标准 |
| 责任人 | 明确分配到具体Agent |

### 2.2 任务创建模板

```bash
# 基础变量
BASE='http://127.0.0.1:3101/api'
CID='07e2cdb9-6afc-4b01-a088-003073052e26'
AID='智能体编号'
RUN_ID="${PAPERCLIP_RUN_ID:-手动运行编号}"
TOKEN="$PAPERCLIP_API_KEY"
AUTH=(-H "Authorization: Bearer $TOKEN")
WRITE_HEADERS=(
  -H "Authorization: Bearer $TOKEN"
  -H "X-Paperclip-Run-Id: $RUN_ID"
  -H 'Content-Type: application/json'
)

# 创建任务
curl -s -X POST "$BASE/companies/$CID/issues" \
  "${WRITE_HEADERS[@]}" \
  -d '{
    "title":"【模块-编号】任务标题",
    "description":"# 背景\n\n# 范围\n- 文件A\n- 文件B\n\n# 完成标准\n- [ ] 标准1\n- [ ] 标准2\n\n# 验证命令\n```bash\n验证步骤\n```",
    "priority":"medium",
    "status":"todo",
    "assigneeAgentId":"智能体编号",
    "goalId":"目标编号"
  }' | python3 -m json.tool
```

### 2.3 任务分配后动作

1. **评论说明期望**：在任务下评论预期产出
2. **唤醒Agent**：调用唤醒接口
3. **设定检查点**：预估检查时间

```bash
# 评论
curl -s -X POST "$BASE/issues/任务编号/comments" \
  "${WRITE_HEADERS[@]}" \
  -d '{"body":"期望产出：\n- 改动文件清单\n- 验证命令\n- 风险点评估"}'

# 唤醒
curl -s -X POST "$BASE/agents/智能体编号/wakeup" \
  "${WRITE_HEADERS[@]}" \
  -d '{"reason":"新任务分配","issueId":"任务编号"}'
```

---

## 三、如何判断有效产出

### 3.1 有效产出的五个特征

| 特征 | 判定标准 |
|------|----------|
| **文件落地** | 有真实文件改动（新增/修改/删除）|
| **可验证** | 有明确的验证命令或步骤 |
| **可追溯** | 评论中记录了改动摘要 |
| **可复用** | 产物能服务于下游任务 |
| **有结论** | 问题有明确结论或下一步 |

### 3.2 无效产出的六个信号

1. 只有状态变更，无文件改动
2. 验证命令缺失或无法运行
3. 评论只有"已完成"，无具体内容
4. 任务反复挂起/恢复无进展
5. 运行日志显示循环空转
6. 产出与任务目标偏离

### 3.3 产出检查命令

```bash
# 检查任务评论（应有进展记录）
curl -s "${AUTH[@]}" "$BASE/issues/任务编号/comments" | \
  python3 -c "import sys,json; cs=json.load(sys.stdin); print(f'评论数: {len(cs)}'); [print(f'  - {c[\"createdAt\"]}: {c[\"body\"][:50]}...') for c in cs[-3:]]"

# 检查运行日志（应有实质执行）
curl -s "${AUTH[@]}" "$BASE/issues/任务编号/runs" | \
  python3 -c "import sys,json; rs=json.load(sys.stdin); print(f'运行数: {len(rs)}'); [print(f'  - {r[\"status\"]}: {r.get(\"finishedAt\",\"进行中\")}') for r in rs[-3:]]"

# 检查产物（work products）
curl -s "${AUTH[@]}" "$BASE/issues/任务编号/work-products" | \
  python3 -m json.tool
```

---

## 四、如何收敛噪声

### 4.1 噪声来源识别

| 类型 | 表现 | 处理策略 |
|------|------|----------|
| **恢复链空转** | 任务反复进入恢复状态无实质进展 | 人工介入，重置或取消 |
| **运行/评论噪声** | 大量运行记录但无文件产出 | 检查Agent配置，补充上下文 |
| **重复任务** | 多个任务描述相似或目标重叠 | 合并或取消重复项 |
| **僵尸任务** | 长期in_progress但无进展 | 强制取消或转派 |

### 4.2 收敛操作命令

```bash
# 1. 查看公司活跃任务概览（排除已完成/已取消）
curl -s "${AUTH[@]}" "$BASE/companies/$CID/issues" | \
  python3 -c "import sys,json; isu=json.load(sys.stdin); \
    active=[i for i in isu if i['status'] not in ('done','cancelled')]; \
    print(f'活跃任务: {len(active)}'); \
    [print(f'  {i[\"identifier\"]} {i[\"status\"]:>12} {i[\"assigneeAgentId\"] or \"未分配\"} {i[\"title\"][:40]}') for i in active]"

# 2. 取消重复/错误任务
curl -s -X PATCH "$BASE/issues/任务编号" \
  "${WRITE_HEADERS[@]}" \
  -d '{"status":"cancelled"}'

# 3. 评论补充上下文（纠偏）
curl -s -X POST "$BASE/issues/任务编号/comments" \
  "${WRITE_HEADERS[@]}" \
  -d '{"body":"纠偏说明：\n- 当前问题：……\n- 建议方向：……\n- 参考：文件/链接"}'

# 4. 取消卡死的运行
curl -s -X POST "$BASE/heartbeat-runs/运行编号/cancel" \
  "${WRITE_HEADERS[@]}" \
  -d '{"reason":"卡死/重复运行"}'
```

### 4.3 收敛决策树

```
任务有进展？
  ├─ 是 → 检查是否符合预期方向
  │        ├─ 是 → 继续跟踪
  │        └─ 否 → 评论纠偏
  └─ 否 → 检查运行日志
           ├─ 有错误 → 评论补充上下文/重置
           ├─ 空转 → 取消运行，重新唤醒
           └─ 无运行 → 手动唤醒Agent
```

---

## 五、如何接管长期阻塞

### 5.1 阻塞定义

| 状态 | 判定条件 |
|------|----------|
| **短期阻塞** | < 4小时，有明确等待原因 |
| **中期阻塞** | 4-24小时，需关注 |
| **长期阻塞** | > 24小时，必须人工介入 |

### 5.2 接管流程

```bash
# 1. 识别长期阻塞任务（in_progress超过24小时）
curl -s "${AUTH[@]}" "$BASE/companies/$CID/issues?status=in_progress" | \
  python3 -c "
import sys,json,datetime
isu=json.load(sys.stdin)
now=datetime.datetime.now(datetime.timezone.utc)
for i in isu:
    started=i.get('startedAt')
    if started:
        hours=(now-datetime.datetime.fromisoformat(started.replace('Z','+00:00'))).total_seconds()/3600
        if hours>24:
            print(f'{i[\"identifier\"]} {hours:.1f}h {i[\"title\"][:40]}')
"

# 2. 查看详细运行状态
curl -s "${AUTH[@]}" "$BASE/issues/任务编号/active-run" | python3 -m json.tool

# 3. 读取Agent运行态
curl -s "${AUTH[@]}" "$BASE/agents/智能体编号/runtime-state" | python3 -m json.tool
```

### 5.3 接管策略

| 场景 | 操作 |
|------|------|
| Agent空闲但任务in_progress | 检查是否执行锁未释放，必要时重置 |
| Agent运行中但无进展 | 取消当前运行，重新唤醒 |
| 任务过于复杂 | 拆分多个子任务，重新分配 |
| Agent能力不足 | 转派给其他Agent或人工处理 |

```bash
# 强制接管：重置任务状态并重新分配
curl -s -X PATCH "$BASE/issues/任务编号" \
  "${WRITE_HEADERS[@]}" \
  -d '{
    "status":"todo",
    "comment":"长期阻塞接管：重置为待处理，重新分配"
  }'

# 转派
curl -s -X PATCH "$BASE/issues/任务编号" \
  "${WRITE_HEADERS[@]}" \
  -d '{
    "assigneeAgentId":"新智能体编号",
    "comment":"转派原因：……"
  }'
```

---

## 六、三闸门验收

### 6.1 三闸门定义

| 闸门 | 检查内容 | 责任人 |
|------|----------|--------|
| **第一闸：完成度** | 任务目标是否达成 | Agent自检 |
| **第二闸：质量** | 代码/文档质量、验证通过 | Owner抽检 |
| **第三闸：可交付** | 产物可复用、文档完整 | Owner终审 |

### 6.2 每闸检查清单

**第一闸：完成度（Agent自检）**
- [ ] 任务描述中的完成标准全部达成
- [ ] 有真实文件改动
- [ ] 评论包含六件套：改动摘要、分支、提交号、验证命令、验证结果、下游复验口径

**第二闸：质量（Owner抽检）**
- [ ] 验证命令可运行且通过
- [ ] 代码符合项目规范
- [ ] 无明显的性能/安全问题
- [ ] 文档格式正确

**第三闸：可交付（Owner终审）**
- [ ] 产物能被下游任务使用
- [ ] 相关文档已更新
- [ ] 无遗留风险未处理

### 6.3 验收通过命令

```bash
# Agent自检后标记完成
curl -s -X PATCH "$BASE/issues/任务编号" \
  "${WRITE_HEADERS[@]}" \
  -d '{
    "status":"done",
    "comment":"自检完成：\n- 改动：文件A、文件B\n- 验证：`pnpm test` 通过\n- 风险：无\n- 下游：任务XXX可复用本产出"
  }'
```

---

## 七、快速参考卡（简版规则）

### 派活口诀
1. 先查目标 → 2. 拆到1-2天 → 3. 写清标准 → 4. 分人唤醒 → 5. 设检查点

### 验收六件套（评论必填）
```
改动摘要：改了什么文件
分支：xxx
提交号：abc123d
验证命令：pnpm test
验证结果：通过/失败X项
下游复验口径：如何复用
```

### 收敛噪声三步走
1. 查活跃任务列表
2. 识别无进展项
3. 评论纠偏/取消/转派

### 阻塞接管决策
- < 4h：观察
- 4-24h：关注，准备介入
- > 24h：强制接管，重置或转派

### 常用curl速查
```bash
# 基础设置
BASE='http://127.0.0.1:3101/api'; CID='公司编号'
AUTH=(-H "Authorization: Bearer $PAPERCLIP_API_KEY")
WRITE=(-H "Authorization: Bearer $PAPERCLIP_API_KEY" -H "X-Paperclip-Run-Id: $RUN_ID" -H 'Content-Type: application/json')

# 查任务
curl -s "${AUTH[@]}" "$BASE/companies/$CID/issues?assigneeAgentId=AGENT_ID"

# 改状态
curl -s -X PATCH "$BASE/issues/ID" "${WRITE[@]}" -d '{"status":"done"}'

# 加评论
curl -s -X POST "$BASE/issues/ID/comments" "${WRITE[@]}" -d '{"body":"内容"}'

# 唤醒
curl -s -X POST "$BASE/agents/ID/wakeup" "${WRITE[@]}" -d '{"reason":"唤醒原因"}'
```

---

## 八、附录：文档更新记录

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| v1.0 | 2026-06-05 | 初始版本，整合派活、产出判断、噪声收敛、阻塞接管、三闸验收流程 |

---

**文档维护**：本文档由`自家文档小归`维护，如有更新需求请指派任务。
