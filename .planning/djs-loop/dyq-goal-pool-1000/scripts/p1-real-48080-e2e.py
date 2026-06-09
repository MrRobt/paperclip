#!/usr/bin/env python3
"""P1 端云通信建立端到端真实验证 v3 - 带 HMAC 签名
用真实 48080，注册设备，心跳，admin 下发任务，端侧领取，结果回传（含签名）"""
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import sys
import time
from pathlib import Path

OUT = Path("/mnt/e/code/PokeClaw/artifacts/dyq40-r40-real-e2e")
OUT.mkdir(parents=True, exist_ok=True)

BASE = "http://127.0.0.1:48080"
DEV_ID = f"dyq-r40-pokeclaw-real-{int(time.time())}"
(OUT / "device_id.txt").write_text(DEV_ID)
print(f"deviceId={DEV_ID}")


def curl(method, path, headers=None, body=None, outfile=None, label=""):
    cmd = ["curl", "-sS", "-X", method, f"{BASE}{path}"]
    if headers:
        for k, v in headers.items():
            cmd += ["-H", f"{k}: {v}"]
    if body is not None:
        cmd += ["-d", json.dumps(body) if isinstance(body, (dict, list)) else body]
    if outfile:
        cmd += ["-o", outfile, "-w", f"{label}_http=%{{http_code}}\\n"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.stdout, res.stderr, res.returncode


def sign_request(token, ts, nonce, method, path, body_str):
    """Generate HMAC-SHA256 signature per spec v1.1.0.
    signing_string = X-Claw-Timestamp + "\n" + X-Claw-Nonce + "\n" + path + "\n" + sha256_hex(body)
    signature = hex(HMAC-SHA256(deviceToken, signing_string))"""
    body_hash = hashlib.sha256(body_str.encode("utf-8")).hexdigest()
    signing_string = f"{ts}\n{nonce}\n{path}\n{body_hash}"
    sig = hmac.new(token.encode("utf-8"), signing_string.encode("utf-8"),
                   hashlib.sha256).hexdigest()
    return sig


# 1. Admin login
print("\n=== Step 1: Admin login ===")
out, _, _ = curl(
    "POST", "/admin-api/system/auth/login",
    headers={"Content-Type": "application/json", "tenant-id": "1"},
    body={"username": "admin", "password": "ZIBsXPIaZPiPjZH", "tenantName": "yisheng"},
    outfile=str(OUT / "admin-login.json"), label="admin_login"
)
print(out.strip())
admin_data = json.loads((OUT / "admin-login.json").read_text())
admin_token = admin_data["data"]["accessToken"]
(OUT / "admin_token.txt").write_text(admin_token)
print(f"admin_token_len={len(admin_token)}")

# 2. Device register
print("\n=== Step 2: Device register ===")
out, _, _ = curl(
    "POST", "/api/claw-device/register",
    headers={"Content-Type": "application/json"},
    body={"deviceId": DEV_ID, "deviceModel": "ReDroid-Pixel-Test",
          "androidVersion": "14", "appVersion": "1.0.0"},
    outfile=str(OUT / "register.json"), label="register"
)
print(out.strip())
reg_data = json.loads((OUT / "register.json").read_text())
print(json.dumps(reg_data, ensure_ascii=False, indent=2))
dev_token = reg_data["data"]["deviceToken"]
(OUT / "dev_token.txt").write_text(dev_token)
print(f"dev_token_len={len(dev_token)}")

# 3. Heartbeat
print("\n=== Step 3: Heartbeat with token (P1.3) ===")
out, _, _ = curl(
    "POST", "/api/claw-device/heartbeat",
    headers={"Content-Type": "application/json", "tenant-id": "1",
             "Authorization": f"Bearer {dev_token}"},
    body={"deviceId": DEV_ID, "batteryLevel": 85, "networkType": "WIFI", "isOnline": True},
    outfile=str(OUT / "heartbeat.json"), label="heartbeat"
)
print(out.strip())
print((OUT / "heartbeat.json").read_text())

# 4. Admin create task
print("\n=== Step 4: Admin create task for device (P1.4 execute) ===")
out, _, _ = curl(
    "POST", f"/admin-api/claw/device/{DEV_ID}/execute",
    headers={"Content-Type": "application/json", "tenant-id": "1",
             "Authorization": f"Bearer {admin_token}"},
    body={"command": "P1-test/2026-06-07-r40/device-heartbeat",
          "mode": "interactive", "priority": "normal"},
    outfile=str(OUT / "execute.json"), label="execute"
)
print(out.strip())
print((OUT / "execute.json").read_text())

# 5. Device fetch pending
print("\n=== Step 5: Device fetch pending tasks (P1.4 pending) ===")
out, _, _ = curl(
    "GET", f"/api/claw-device/devices/{DEV_ID}/pending-tasks",
    headers={"Content-Type": "application/json", "tenant-id": "1",
             "Authorization": f"Bearer {dev_token}"},
    outfile=str(OUT / "pending.json"), label="pending"
)
print(out.strip())
print((OUT / "pending.json").read_text())

# 6. Submit signed result
pending = json.loads((OUT / "pending.json").read_text())
arr = pending.get("data", []) or []
if arr:
    task_uuid = arr[0].get("taskUuid", "")
    (OUT / "task_uuid.txt").write_text(task_uuid)
    print(f"\n=== Step 6: Submit signed result for taskUuid={task_uuid} (P1.4 result) ===")
    result_body = {
        "taskUuid": task_uuid,
        "status": "SUCCESS",
        "result": "P1-r40-real-48080 closed loop OK",
        "executionTimeMs": 432
    }
    result_path = f"/api/claw-device/tasks/{task_uuid}/result"
    result_body_str = json.dumps(result_body, separators=(",", ":"), ensure_ascii=False)
    ts = str(int(time.time() * 1000))
    nonce = secrets.token_hex(8)
    sig = sign_request(dev_token, ts, nonce, "POST", result_path, result_body_str)
    headers = {
        "Content-Type": "application/json",
        "tenant-id": "1",
        "Authorization": f"Bearer {dev_token}",
        "X-Claw-Timestamp": ts,
        "X-Claw-Nonce": nonce,
        "X-Claw-Signature": sig,
    }
    out, _, _ = curl("POST", result_path, headers=headers, body=result_body_str,
                     outfile=str(OUT / "result.json"), label="result")
    print(out.strip())
    print((OUT / "result.json").read_text())
else:
    print("\n=== Step 6: No pending task to submit result for ===")
    (OUT / "result.json").write_text(json.dumps({"skipped": "no pending task"}, indent=2))

print("\nDONE")
