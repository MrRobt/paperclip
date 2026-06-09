#!/usr/bin/env python3
"""
DYQ Ralph Loop 永久自主循环 Daemon
==================================
- 永久后台运行，每次循环读取目标树 → 选最小闭环 → 执行 → 验证 → 提交 → 复盘
- 状态持久化到 JSON，重启后可恢复轮次
- 用 hermes chat CLI 驱动，不依赖纸夹/Paperclip
- 日志轮转，自动告警阻塞

依赖：hermes CLI, git, curl, python3
运行：nohup python3 dyq_ralph_daemon.py > /tmp/dyq_ralph_daemon.log 2>&1 &
"""

import os
import sys
import json
import time
import subprocess
import hashlib
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

# ========== 配置 ==========
ROOT = Path("/mnt/e/code/dyq")
GIT_WORK = os.environ.get("GIT_WORK_DIR", str(ROOT))
STATE_FILE = Path("/root/.hermes/profiles/my-profile/scripts/dyq_ralph_state.json")
LOG_FILE = Path("/tmp/dyq_ralph_daemon.log")
MAX_ROUNDS_PER_CYCLE = 3          # 每次 daemon 唤醒最多跑几轮
CYCLE_INTERVAL = 15 * 60          # 循环间隔（秒），默认15分钟
HERMES_TIMEOUT = 8 * 60           # 每次 hermes chat 超时（秒）
MAX_LOG_LINES = 5000              # 日志轮转上限

# AGENTS 规则路径（用于注入上下文）
AGENTS_MD = ROOT / "AGENTS.md"

# 登录凭证（只读查找，不明文暴露，调用时注入 prompt）
TENANT_NAME = "yisheng"
ADMIN_USER = "admin"
# 密码从环境变量读取，防明文
ADMIN_PASS = os.environ.get("DYQ_ADMIN_PASSWORD", "")


# ========== 日志 ==========
def log(msg: str, level: str = "INFO"):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [{level}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass
    _rotate_log()


def _rotate_log():
    try:
        if LOG_FILE.exists() and LOG_FILE.stat().st_size > 20 * 1024 * 1024:
            bak = LOG_FILE.with_suffix(".log.bak")
            if bak.exists():
                bak.unlink()
            LOG_FILE.rename(bak)
    except Exception:
        pass


def log_error(msg: str):
    log(msg, "ERROR")


def log_warn(msg: str):
    log(msg, "WARN")


# ========== 状态读写 ==========
def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "total_rounds": 0,
        "cycle_rounds": 0,
        "last_commit": "",
        "last_error": "",
        "last_run": None,
        "blocked_rounds": 0,
        "session_id": None,
    }


def save_state(state: dict):
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(STATE_FILE, "w") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
    except Exception as e:
        log_error(f"保存状态失败: {e}")


# ========== Git 操作 ==========
def git_run(*args, cwd: str = GIT_WORK, timeout: int = 30) -> tuple[int, str]:
    try:
        result = subprocess.run(
            ["git"] + list(args),
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.returncode, (result.stdout + result.stderr).strip()
    except subprocess.TimeoutExpired:
        return 124, "git command timeout"
    except Exception as e:
        return 1, str(e)


def git_status_short(cwd: str = GIT_WORK) -> tuple[int, str, str]:
    """返回 (exit_code, stat_short, last_commit)"""
    rc1, stat = git_run("status", "--short", cwd=cwd, timeout=30)
    rc2, log_line = git_run(
        "log", "-1", "--format=%H %s", cwd=cwd, timeout=30
    )
    commit = log_line.split(" ", 1)[1] if " " in log_line else log_line
    return rc1, stat, commit


def git_stash_list(cwd: str = GIT_WORK) -> str:
    _, out = git_run("stash", "list", cwd=cwd, timeout=15)
    return out


def git_add_and_commit(
    files: list[str], msg: str, cwd: str = GIT_WORK
) -> tuple[bool, str]:
    """选择性 add + commit"""
    try:
        # 先 dry-run 确认文件存在
        for f in files:
            fp = Path(cwd) / f
            if not fp.exists() and not Path(f).is_absolute():
                # 可能是 glob
                import glob as g
                matches = g.glob(f, root_dir=cwd)
                if not matches:
                    log_warn(f"文件不存在，跳过: {f}")
                    files.remove(f)
        if not files:
            return False, "无有效文件"
        add_cmd = ["git", "-C", cwd, "add", "--"] + files
        r1 = subprocess.run(add_cmd, capture_output=True, text=True, timeout=30)
        if r1.returncode != 0:
            return False, f"git add 失败: {r1.stderr}"
        commit_cmd = ["git", "-C", cwd, "commit", "-m", msg]
        r2 = subprocess.run(
            commit_cmd, capture_output=True, text=True, timeout=45
        )
        if r2.returncode != 0:
            return False, f"git commit 失败: {r2.stderr}"
        return True, r2.stdout + r2.stderr
    except subprocess.TimeoutExpired:
        return False, "git commit timeout"
    except Exception as e:
        return False, str(e)


# ========== Hermes CLI ==========
def hermes_chat(prompt: str, timeout: int = HERMES_TIMEOUT) -> tuple[int, str]:
    """
    调用 hermes chat 执行 Ralph Loop 步骤。
    返回 (exit_code, output)
    """
    env = os.environ.copy()
    env["HERMES_NO_ASCII"] = "1"
    try:
        proc = subprocess.Popen(
            [
                sys.executable, "-m", "hermes_cli.main", "chat",
                "--profile", "my-profile",
                "--yolo",
                "--model", "glm-5.1",
                "--skills", "ralph-loop",
                "--quiet",
                "-q", prompt,
            ],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        out, _ = proc.communicate(timeout=timeout)
        return proc.returncode, out
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        return 124, "hermes chat timeout"
    except Exception as e:
        return 1, str(e)


# ========== Ralph Loop 单轮执行 ==========
def read_goal_tree() -> Optional[str]:
    """读取目标树，返回前3个待办目标"""
    goal_files = [
        ROOT / "AGENTS.md",
        ROOT / "目标树.md",
        ROOT / "DYQ-目标池.md",
        ROOT / ".planning" / "目标树.md",
    ]
    content = ""
    for gf in goal_files:
        if gf.exists():
            try:
                text = gf.read_text(encoding="utf-8", errors="ignore")
                # 取前 200 行作为上下文
                content += f"\n\n=== {gf.name} ===\n" + "\n".join(text.splitlines()[:200])
            except Exception:
                pass
    if not content:
        return None
    return content[:3000]  # 限制 token


def build_ralph_prompt(goal_context: str, state: dict) -> str:
    """构建 Ralph Loop 单轮 prompt"""
    return f"""
你是小黑，DYQ 项目（多源奇/豆有趣）的自主执行助手。

【当前规则必须遵守】
- 参考 {AGENTS_MD} 的登录凭证：租户=yisheng，账号=admin（密码从环境变量 DYQ_ADMIN_PASSWORD 读取，不要明文写）
- 登录必须先 GET /admin-api/system/tenant/get-id-by-name?name=yisheng 取 tenant-id，再带 header tenant-id 登录
- 后端端口 48080，前端 5173
- 提交格式：feat/fix/docs(中文描述): 中文详情
- 目标池节点：C1/C2/P1/P2/W1/W2/S1-S4

【当前状态】
- 累计轮次: {state.get('total_rounds', 0)}
- 本次循环轮次: {state.get('cycle_rounds', 0)}
- 上次提交: {state.get('last_commit', '无')}
- 上次错误: {state.get('last_error', '无')}

【目标树上下文】
{goal_context or '（未找到目标树，按最小业务闭环自主选择功能点）'}

【本次任务】
1. 用 git 四件套确认真实状态（git log -1 --stat && git status --short && git stash list && git worktree list）
2. 从目标树选一个最小功能闭环（必须有真实代码产出）
3. 实现 → 验证 → 记录证据 → 本地提交
4. 完成后输出：
   - 变更文件清单
   - 本地提交号（如果无法提交写清原因）
   - 验证命令和结果
   - 证据目录
   - 下一轮最小功能点

禁止：只补文档/计划/评论，无真实代码产出不得完成。
"""


def run_ralph_round(state: dict) -> dict:
    """执行单轮 Ralph Loop，返回结果 dict"""
    result = {
        "ok": False,
        "commit": "",
        "files": [],
        "error": "",
        "evidence": "",
    }

    goal = read_goal_tree()
    prompt = build_ralph_prompt(goal, state)

    log(f"开始第 {state['total_rounds'] + 1} 轮...")
    code, out = hermes_chat(prompt)

    if code != 0:
        result["error"] = f"hermes exit {code}: {out[:500]}"
        log_error(result["error"])
        return result

    # 解析输出提取提交号
    import re as re_module
    commit_m = re_module.search(r"(?:commit|commit SHA|提交)[：:\s]+([a-f0-9]{{7,40}}|[a-f0-9]{{7}})", out, re_module.I)
    files_m = re_module.findall(r"[-+*]\s+(\S+\.(?:java|vue|ts|tsx|js|sql|sh|py|md))", out)
    evidence_m = re_module.search(r"证据[：:]\s*(.+?)(?:\n|$)", out, re_module.I)
    error_m = re_module.search(r"(?:错误|失败|Exception|Error)[:\s]+(.+?)(?:\n|$)", out, re_module.I | re_module.S)

    if commit_m:
        result["commit"] = commit_m.group(1)
    if files_m:
        result["files"] = files_m[:10]
    if evidence_m:
        result["evidence"] = evidence_m.group(1).strip()
    if error_m:
        result["error"] = error_m.group(1).strip()[:300]

    # 验证提交是否真实落地
    if result["commit"]:
        rc, log_out = git_run("log", "-1", "--format=%H %s", cwd=GIT_WORK)
        if result["commit"][:7] in log_out:
            result["ok"] = True
            log(f"✅ 提交成功: {result['commit'][:8]} — {result['files']}")
        else:
            result["error"] = f"提交号 {result['commit']} 未在 git log 中确认"
            log_warn(result["error"])

    # 记录输出摘要到日志
    with open(LOG_FILE.with_suffix(".rounds.log"), "a") as f:
        ts = datetime.now().isoformat()
        f.write(f"\n{'='*60}\n")
        f.write(f"[{ts}] Round {state['total_rounds'] + 1} | code={code}\n")
        f.write(f"commit={result['commit']} files={result['files']}\n")
        f.write(f"error={result['error'][:200]}\n")
        f.write(f"output_snippet={out[:1000]}\n")

    return result


# ========== 主循环 ==========
def main():
    log("=" * 60)
    log(f"DYQ Ralph Loop Daemon 启动 | PID={os.getpid()}")
    log(f"工作目录: {GIT_WORK}")
    log(f"状态文件: {STATE_FILE}")
    log(f"循环间隔: {CYCLE_INTERVAL}s")

    if not ROOT.exists():
        log_error(f"工作目录不存在: {ROOT}")
        sys.exit(1)

    if not ADMIN_PASS:
        log_warn("DYQ_ADMIN_PASSWORD 环境变量未设置，登录类任务可能受限")

    # 初始 git 状态
    rc, stat, last_commit = git_status_short()
    log(f"初始 git 状态: {stat[:200]} | last={last_commit[:60]}")

    while True:
        state = load_state()
        state["last_run"] = datetime.now().isoformat()

        # ---- 自检：git 状态是否干净，stash 是否有遗漏 ----
        _, stat, _ = git_status_short()
        stash = git_stash_list()
        if stat.strip() or stash.strip():
            log_warn(f"工作树非空或存在 stash，继续执行时会处理")

        # ---- Ralph Loop 执行 ----
        round_ok = False
        for i in range(MAX_ROUNDS_PER_CYCLE):
            state["cycle_rounds"] = i + 1
            state["total_rounds"] += 1

            result = run_ralph_round(state)

            if result["ok"]:
                state["last_commit"] = result["commit"]
                state["last_error"] = ""
                state["blocked_rounds"] = 0
                round_ok = True
            else:
                state["last_error"] = result["error"]
                state["blocked_rounds"] += 1

            save_state(state)

            # 如果本轮无产出，且有错误，缩短等待时间
            if not result["ok"] and result["error"]:
                log_warn(f"轮次失败: {result['error'][:150]}")
                break  # 不连续空转

            time.sleep(5)  # 轮次间短暂停顿

        # ---- 循环后汇报 ----
        now = datetime.now().strftime("%H:%M")
        summary = (
            f"轮次 done={state['cycle_rounds']} "
            f"total={state['total_rounds']} "
            f"blocked={state['blocked_rounds']} "
            f"last_commit={state.get('last_commit', '无')[:8]}"
        )
        log(f"【{now}】循环结束 | {summary}")

        # 连续 3 轮阻塞 → 告警
        if state["blocked_rounds"] >= 3:
            log_error(f"⚠️ 连续 {state['blocked_rounds']} 轮阻塞，上次错误: {state.get('last_error', '')[:200]}")
            state["blocked_rounds"] = 0  # 重置计数

        time.sleep(CYCLE_INTERVAL)


if __name__ == "__main__":
    # 信号处理：优雅退出
    import signal

    def handle_sigterm(sig, frame):
        log(f"收到 SIGTERM，保存状态并退出...")
        save_state(load_state())
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_sigterm)
    signal.signal(signal.SIGINT, handle_sigterm)

    main()
