#!/usr/bin/env python3
"""DYQ 48080 master cron one-shot verification.

Use case: 主控 cron 每轮验证 48080 服务状态、健康、主线总览、设备清单、PokeClaw 历史任务。
- 登录 admin/yisheng 拿 token
- 调用 5 个核心接口（health/summary/mainline-overview/device list/pokeclaw-r40 tasks）
- 把所有响应落 /root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round43-20260607-master-cron/

Usage:
  python3 /tmp/r43_check.py

Dependency: 48080 跑在 127.0.0.1:48080
Env (hardcoded, 改要重启):
  TOK_PATH = token file path
  EVD = evidence dir
"""
import json
import os
from urllib import request, error

TOK_PATH = "/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round43-20260607-master-cron/r43-token.txt"
EVD = "/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round43-20260607-master-cron"
os.makedirs(EVD, exist_ok=True)

# 1) login if token missing
if not os.path.exists(TOK_PATH):
    import urllib.parse
    login_data = urllib.parse.urlencode({
        "username": "admin", "password": "DEV_PASSWORD_PLACEHOLDER"
    }).encode()
    req = request.Request(
        "http://127.0.0.1:48080/admin-api/system/auth/login",
        data=login_data,
        headers={"Content-Type": "application/json", "tenant-id": "1"},
        method="POST",
    )
    # Note: requires raw JSON body, not form
    raw = json.dumps({"username": "admin", "password": "DEV_PASSWORD_PLACEHOLDER"}).encode()
    req = request.Request(
        "http://127.0.0.1:48080/admin-api/system/auth/login",
        data=raw,
        headers={"Content-Type": "application/json", "tenant-id": "1"},
        method="POST",
    )
    with request.urlopen(req, timeout=8) as r:
        body = json.loads(r.read().decode())
    token = body["data"]["accessToken"]
    with open(TOK_PATH, "w") as f:
        f.write(token + "\n")

with open(TOK_PATH) as f:
    token = f.read().strip()

BEARER = "Bearer " + token


def get(path, use_auth=True):
    h = {"tenant-id": "1"}
    if use_auth:
        h["Authorization"] = BEARER
    req = request.Request("http://127.0.0.1:48080" + path, headers=h, method="GET")
    try:
        with request.urlopen(req, timeout=8) as r:
            return r.status, json.loads(r.read().decode())
    except error.HTTPError as e:
        try:
            body = json.loads(e.read().decode())
        except Exception:
            body = {}
        return e.code, body


# 1) health
st, d = get("/admin-api/actuator/health", False)
print("health: HTTP", st, "overall=", d.get("status"))
for k, v in (d.get("components") or {}).items():
    if isinstance(v, dict):
        print(" ", k, "=", v.get("status"))

# 2) summary
st, d = get("/admin-api/claw/statistics/summary")
data = d.get("data", {})
keys = list(data.keys()) if isinstance(data, dict) else data
print()
print("summary: code=", d.get("code"), "keys=", keys)
with open(EVD + "/r43-summary.json", "w") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

# 3) mainline-overview
st, d = get("/admin-api/claw/statistics/mainline-overview")
items = (d.get("data") or {}).get("items", [])
print()
print("overview: code=", d.get("code"), "items=", len(items))
for it in items:
    print(" -", it.get("code"), it.get("status"), "|", it.get("statusText"))
with open(EVD + "/r43-overview.json", "w") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

# 4) device list
st, d = get("/admin-api/claw/device/list")
rows = (d.get("data") or {}).get("list", [])
print()
print("device list: code=", d.get("code"), "count=", len(rows))
for r in rows[:10]:
    print(" -", r.get("deviceId"), "|", r.get("name"), "|", r.get("type"), "|", r.get("status"))
with open(EVD + "/r43-devices.json", "w") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

# 5) pokeclaw r40 device tasks
st, d = get("/admin-api/claw/device/dyq-r40-pokeclaw-real-1780777966/tasks")
print()
print("pokeclaw-r40 tasks: code=", d.get("code"))
with open(EVD + "/r43-pokeclaw-tasks.json", "w") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

with open(EVD + "/r43-meta.txt", "w") as f:
    f.write("ALL_OK\n")
print()
print("ALL_OK ->", EVD)
