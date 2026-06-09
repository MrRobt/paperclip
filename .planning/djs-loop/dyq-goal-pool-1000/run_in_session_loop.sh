#!/usr/bin/env bash
set -u
BASE="/root/paperclip-work/paperclip"
STATE="$BASE/.planning/djs-loop/dyq-goal-pool-1000"
LOG="$STATE/in_session_loop.log"
mkdir -p "$STATE"
cd "$BASE"

echo "===== djs-loop 会话内循环启动 $(date '+%Y-%m-%d %H:%M:%S %z') =====" >> "$LOG"

i=$(python3 - <<'PY'
import re
from pathlib import Path
p=Path('/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/RUN_LOG.md')
nums=[]
if p.exists():
    text=p.read_text(errors='ignore')
    nums += [int(x) for x in re.findall(r'累计第\s*(\d+)\s*轮', text)]
    nums += [int(x) for x in re.findall(r'^##\s*第\s*(\d+)\s*轮', text, re.M)]
print((max(nums) + 1) if nums else 1)
PY
)
while [ "$i" -le 1000 ]; do
  echo "\n===== 第 ${i}/1000 轮开始 $(date '+%Y-%m-%d %H:%M:%S %z') =====" | tee -a "$LOG"
  hermes chat --skills djs-loop -q "你是 djs-loop 主控。现在执行 DYQ 目标池 1000 轮会话内连续迭代的第 ${i} 轮。禁止空巡检，必须做一个最小可验证推进动作；如果强阻塞，写清证据并转向下一个可推进目标。

【总目标】实现目标池所有目标：75 个目标、393 个问题；活跃目标 30，planned 45。主线：C1/C2 Claw 云端中枢、P1/P2 PokeClaw 端侧、W1/W2 WeFlow 微信端侧、S1-S4 自动化赚钱场景。

【目标池】/root/paperclip-work/paperclip/doc/plans/2026-06-06-dyq-paperclip-goals-hermes-takeover.md

【项目路径】
- 后端：/mnt/e/code/dyq，分支 dev
- Web：/mnt/e/code/ai-ui-admin-vue3aa，分支 dev
- PokeClaw：/mnt/e/code/PokeClaw，分支 dev
- WeFlow：/mnt/d/work/code/WeFlow，分支 main
- 社媒：/mnt/d/work/code/social-media-web-automation，分支 main
- Paperclip：/root/paperclip-work/paperclip，分支 dev

【状态目录】/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/
必须维护 GOAL.md、REQUIREMENTS.md、DESIGN.md、IMPLEMENTATION_PLAN.md、RUN_LOG.md、EVIDENCE.md。

【强制规则】
1. 每轮先检查相关仓库 git status --short，不覆盖或删除他人改动。
2. 每轮先读相关仓库 .claude/CLAUDE.md 和 .claude/rules；没有则读 CLAUDE.md、AGENTS.md、README.md、.planning/。
   - DYQ 管理后台测试登录凭证必须显式读取：/mnt/e/code/dyq/.claude/rules/testing-credentials.md。
   - 使用凭证时只能用于开发/测试接口验证，不要把密码、令牌完整写入日志、提交、证据文件或汇报；证据中只写凭证来源文件和脱敏结果。
3. 优先级：C1 主后端 48080 稳定启动与 Claw register/heartbeat → P1/P2 PokeClaw 端侧接入 → W1/W2 WeFlow 微信端侧安全回复 → S1-S4 自动化赚钱场景 → 其它 active/planned。
4. 默认测试先行，但测试不是交付物本身；每轮必须优先产出一个用户/业务可感知能力（接口、页面、脚本真实调用、桌面运行标记、端云闭环、可操作入口等），测试只作为验证证据。若本轮只能写测试，必须说明对应实质能力和下一轮落地动作。
5. 从第18轮开始，优先从“契约/封装/单测”转向“可见可用产出”：桌面运行标记可视化、真实接口调用接入、管理后台可触达入口、前端/桌面截图证据、S1自动化赚钱场景最小闭环；避免连续多轮只扩展测试用例。
6. 多项目并行强制规则：除非存在强依赖或冲突，每轮至少覆盖两个不同仓库；优先按三条泳道并行推进并汇总验收：A 后端/Web（/mnt/e/code/dyq + /mnt/e/code/ai-ui-admin-vue3aa），B PokeClaw（/mnt/e/code/PokeClaw），C WeFlow/社媒（/mnt/d/work/code/WeFlow + /mnt/d/work/code/social-media-web-automation）。连续两轮不得只改 WeFlow；若上一轮主要改 WeFlow，本轮必须优先 DYQ 后端/Web 或 PokeClaw。
7. 并发/串行执行边界：采用“泳道并发、泳道内串行、集成串行”。派发前必须标注任务类型：并发可跑 / 泳道内串行 / 全局串行锁。不同泳道只能改各自仓库文件；先 git status，不能覆盖他人改动；弱依赖并发，强依赖串行；同一文件、公共契约、锁文件、数据库迁移、权限菜单、提交合并必须全局串行；每条泳道至少返回产出、验证、提交/未提交原因。
8. 后端主服务默认 dyq-server:48080；启动新 Java 进程前必须先停旧 Java 进程。
9. 前端问题必须尽量用真实浏览器验证。
10. 可本地提交，提交信息必须中文格式：feat/fix/docs(中文描述): 中文详情；不要强推。
11. 涉及真实资金、生产数据删除、大规模外呼触达、删除远端修改或重大架构变更，停止该动作并汇报。

【本轮输出】只用中文短报：结论、真实产出、验证、目标进度、阻塞、下一步。" 2>&1 | tee -a "$LOG"
  code=${PIPESTATUS[0]}
  echo "===== 第 ${i}/1000 轮结束，退出码 ${code} $(date '+%Y-%m-%d %H:%M:%S %z') =====" | tee -a "$LOG"
  if [ "$code" -ne 0 ]; then
    echo "第 ${i} 轮失败，休眠 60 秒后继续下一轮。" | tee -a "$LOG"
    sleep 60
  else
    sleep 300
  fi
  i=$((i+1))
done

echo "===== djs-loop 会话内循环完成 $(date '+%Y-%m-%d %H:%M:%S %z') =====" >> "$LOG"
