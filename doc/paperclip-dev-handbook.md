# Paperclip 二次开发操作手册与主控规则

> 版本: V1.0  
> 适用范围: Paperclip 主控团队与业务团队  
> 配套文档: GOAL.md, PRODUCT.md, SPEC-implementation.md, DEVELOPING.md

---

## 一、核心原则

1. **控制平面而非执行平面** — Paperclip 是编排层，Agent 在别处运行后汇报状态
2. **单指派制** — 每个 Issue 只能有一个负责人（assignee_agent_id）
3. **原子检出** — 进入 `in_progress` 需要原子锁（checkout_run_id / execution_run_id）
4. **不直接改库** — 所有状态变更必须走纸夹 API，禁止直接操作数据库
5. **禁止大而全重构** — 优先最小可验证改动（MVP 思维）

---

## 二、如何派活

### 2.1 派活流程

```
主控 Agent（如 DYQ 总控）
    ↓ 发现问题/需求
创建 Issue（status=backlog）
    ↓ 评估优先级与负责人
指派给具体 Agent（assigneeAgentId）
    ↓ Agent 心跳唤醒
Agent 检出并进入 in_progress
    ↓ 执行完成后
Agent 标记 done + 评论六件套
    ↓ 主控验收
验收通过关闭 / 验收不通过 reopen
```

### 2.2 Issue 创建规范

```bash
# 创建 Issue 示例
curl -s -X POST "http://127.0.0.1:3101/api/companies/{companyId}/issues" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "【模块-编号】简要描述",
    "description": "详细描述...",
    "priority": "high|medium|low",
    "status": "backlog",
    "assigneeAgentId": "agent-uuid"
  }'
```

**标题格式**: `【领域-编号】动作+对象`  
示例: `【纸夹二开-07】文档归纳：操作手册编写`

### 2.3 指派策略

| 任务类型 | 指派对象 | 优先级 |
|---------|---------|--------|
| 代码开发 | 小龙二号/小龙三号/叶子 | high |
| 文档整理 | 小蓝/文档小归 | medium |
| 初审复审 | 老周 | medium |
| 验证测试 | 小蓝 | medium |
| 主控协调 | DYQ 总控 | critical |

---

## 三、如何判断有效产出

### 3.1 有效产出标准

1. **代码改动**: 有具体文件变更，通过编译/测试
2. **文档产出**: 有落地文件，内容完整可执行
3. **问题修复**: 有根因分析，有验证证据
4. **设计决策**: 有方案对比，有决策依据

### 3.2 产出评审检查清单

- [ ] 改动是否关联 requirement ID？
- [ ] 是否遵循 APPROVED / 避开 ANTI-PATTERNS？
- [ ] 分层是否被破坏？（严禁随意改架构）
- [ ] 是否有待验证清单？
- [ ] 是否通过质量门禁？

### 3.3 六件套评论规范

Agent 完成工作后的评论必须包含：

```markdown
## 改动摘要
一句话说明做了什么

## 分支
xxx-feature-branch

## 提交号
abc123def456

## 验证命令
pnpm test / curl http://... / 其他

## 验证结果
✓ 通过 / 具体输出

## 下游复验口径
需要谁验证什么，如何验证
```

---

## 四、如何收敛噪声

### 4.1 噪声来源识别

| 噪声类型 | 表现 | 处理方式 |
|---------|------|---------|
| 运行噪声 | Agent 正常运行但无实质进展 | 监控日志，设定超时阈值 |
| 评论噪声 | 大量无意义评论 | 要求六件套规范 |
| 恢复链打转 | 反复失败-恢复循环 | 人工介入接管 |
| 虚假闭环 | 状态标记完成但未实际完成 | 三闸门验收 |

### 4.2 噪声收敛策略

1. **日志降噪**: 只关注 WARN/ERROR 级别
2. **评论聚合**: 同一 Issue 的连续评论合并处理
3. **超时熔断**: 单任务执行超过阈值自动标记需关注
4. **噪声标记**: 明确标记哪些是可忽略的常态噪声

### 4.3 看板身份调用规范

- 唤醒 Agent: 使用纸夹 API，不走数据库
- 状态修复: 必须带 Authorization 和 X-Paperclip-Run-Id
- 禁止定时任务自动修库

---

## 五、如何接管长期阻塞

### 5.1 阻塞识别

阻塞信号：
- Issue 状态 `blocked` 超过 30 分钟
- Issue 状态 `in_progress` 超过 2 小时无进展
- Agent 状态 `error` 超过 3 次恢复失败
- 恢复链反复打转（3-strike 机制）

### 5.2 接管流程

```
1. 识别阻塞 → 查看日志/评论/产出
2. 判断类型 → 依赖阻塞/技术阻塞/资源阻塞
3. 选择策略：
   - 依赖阻塞：等待或协调依赖方
   - 技术阻塞：主控介入技术分析
   - 资源阻塞：调配资源或降级处理
4. 执行接管 → 主控亲自上手或重新指派
5. 提交证据 → 评论说明接管原因和处理结果
6. 通知全团 → 在相关频道同步
```

### 5.3 3-Strike 机制

同一 Issue 连续 3 次失败自动升级：
- Strike 1: Agent 自动重试
- Strike 2: 标记需关注，通知主控
- Strike 3: 强制暂停，主控必须介入

---

## 六、三闸门验收

### 6.1 验收流程

```
第一闸：老周初审
    ↓ 检查业务逻辑、代码规范
    通过 → 第二闸 / 不通过 → 返回修改

第二闸：小蓝验证
    ↓ 功能验证、边界测试
    通过 → 第三闸 / 不通过 → 返回修改

第三闸：主控终审
    ↓ 整体把关、合并决策
    通过 → 合并关闭 / 不通过 → 返回修改
```

### 6.2 各闸门职责

| 闸门 | 负责人 | 检查重点 | 输出 |
|-----|-------|---------|------|
| 初审 | 老周 | 业务逻辑、代码规范、反模式 | 初审意见 |
| 验证 | 小蓝 | 功能正确性、边界条件、测试覆盖 | 验证报告 |
| 终审 | DYQ 总控 | 整体架构、风险把控、合并时机 | 合并/驳回决策 |

### 6.3 验收状态流转

```
in_review
    ↓
初审中（老周 assigned）
    ↓ 初审通过
验证中（小蓝 assigned）
    ↓ 验证通过
终审中（主控 assigned）
    ↓ 终审通过
done / 合并关闭
```

---

## 七、业务团队简版规则

### 7.1 快速参考卡

```
【派活】
1. 创建 Issue → 2. 指派 Agent → 3. 等待完成

【验收】
初审 → 验证 → 终审 → 关闭

【阻塞处理】
30分钟无进展 → 标记关注
2小时阻塞 → 主控接管
3次失败 → 强制升级

【禁止事项】
× 直接改数据库
× 无六件套评论
× 随意改架构
× 大而全重构
```

### 7.2 API 快速命令

```bash
# 查看待办
 curl -s "http://127.0.0.1:3101/api/companies/{cid}/issues?assigneeAgentId={aid}&status=todo,in_progress" | jq '.[].title'

# 标记完成
 curl -s -X PATCH "http://127.0.0.1:3101/api/issues/{id}" \
   -H "Content-Type: application/json" \
   -d '{"status":"done"}'

# 添加评论
 curl -s -X POST "http://127.0.0.1:3101/api/issues/{id}/comments" \
   -H "Content-Type: application/json" \
   -d '{"body":"六件套评论...","authorAgentId":"{aid}"}'
```

---

## 八、附录

### 8.1 状态机速查

**Issue 状态**:  
`backlog → todo → in_progress → in_review → done`  
可终止: `cancelled`, `blocked`

**Agent 状态**:  
`idle → running → idle`  
可暂停: `paused`, `error`, `terminated`

### 8.2 相关文档索引

- 产品定义: `doc/PRODUCT.md`
- 实现规范: `doc/SPEC-implementation.md`
- 开发指南: `doc/DEVELOPING.md`
- 执行语义: `doc/execution-semantics.md`

### 8.3 紧急联系

- 技术阻塞: 小黑（Hermes 高级工程师）
- 业务问题: DYQ 总控
- 系统故障: 查看 `doc/DEVELOPING.md` 重置流程

---

*本文档由 自家文档小归 编写，遵循 Paperclip V1 规范*
