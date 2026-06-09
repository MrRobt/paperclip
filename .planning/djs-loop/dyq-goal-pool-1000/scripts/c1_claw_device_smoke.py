#!/usr/bin/env python3
"""
C1/P1 最小冒烟：验证 dyq-server:48080、Claw 设备注册、设备心跳。
只输出脱敏证据，不打印完整令牌。
"""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:48080"
DEVICE_ID = "djs-loop-smoke-001"


def request(method, path, payload=None, headers=None, timeout=10):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(BASE + path, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, body
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def parse_json(label, body):
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{label} 返回非 JSON: {body[:200]}") from exc


def main():
    result = {"base": BASE, "deviceId": DEVICE_ID, "checks": []}

    health_status, health_body = request("GET", "/admin-api/actuator/health", payload=None, headers={})
    health = parse_json("health", health_body)
    result["checks"].append({
        "name": "主后端端口与健康端点",
        "http": health_status,
        "status": health.get("status"),
        "db": health.get("components", {}).get("db", {}).get("status"),
        "redis": health.get("components", {}).get("redis", {}).get("status"),
        "rabbit": health.get("components", {}).get("rabbit", {}).get("status"),
        "nacosConfig": health.get("components", {}).get("nacosConfig", {}).get("status"),
    })

    register_payload = {
        "deviceId": DEVICE_ID,
        "deviceName": "djs-loop冒烟设备",
        "deviceType": "android",
        "platform": "PokeClaw",
        "version": "0.0.1",
    }
    reg_status, reg_body = request("POST", "/api/claw-device/register", register_payload)
    reg = parse_json("register", reg_body)
    token = (reg.get("data") or {}).get("deviceToken")
    result["checks"].append({
        "name": "Claw设备注册",
        "http": reg_status,
        "code": reg.get("code"),
        "hasDeviceToken": bool(token),
        "tokenLength": len(token or ""),
        "expiresIn": (reg.get("data") or {}).get("expiresIn"),
    })
    if reg_status != 200 or reg.get("code") != 0 or not token:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2

    heartbeat_payload = {
        "timestamp": int(time.time() * 1000),
        "batteryLevel": 88,
        "isCharging": False,
        "networkType": "wifi",
    }
    hb_status, hb_body = request(
        "POST",
        "/api/claw-device/heartbeat",
        heartbeat_payload,
        {"Authorization": "Bearer " + token},
    )
    hb = parse_json("heartbeat", hb_body)
    result["checks"].append({
        "name": "Claw设备心跳",
        "http": hb_status,
        "code": hb.get("code"),
        "pendingTaskCount": (hb.get("data") or {}).get("pendingTaskCount"),
        "skillVersion": (hb.get("data") or {}).get("skillVersion"),
        "hasServerTime": bool((hb.get("data") or {}).get("serverTime")),
    })

    ok = reg.get("code") == 0 and hb.get("code") == 0
    result["passed"] = ok
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if ok else 3


if __name__ == "__main__":
    sys.exit(main())
