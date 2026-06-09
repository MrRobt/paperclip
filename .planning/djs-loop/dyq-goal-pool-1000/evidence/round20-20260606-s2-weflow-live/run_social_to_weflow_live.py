#!/usr/bin/env python3
"""第20轮：社媒高意向线索 -> DYQ admin execute -> WeFlow 安全草稿 -> 签名 result 真实闭环探针。
输出脱敏证据：不打印管理后台令牌、设备令牌或密码。
"""
import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path

BASE = os.environ.get('DYQ_BASE_URL', 'http://127.0.0.1:48080').rstrip('/')
TENANT_ID = os.environ.get('ADMIN_TENANT_ID', '1')
TENANT_NAME = os.environ.get('ADMIN_TENANT_NAME', 'yisheng')
USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
PASSWORD = os.environ.get('ADMIN_PASSWORD')
OUT_DIR = Path(__file__).resolve().parent
SOCIAL_REPO = Path('/mnt/d/work/code/social-media-web-automation')
WEFLOW_SCRIPT = Path('/mnt/d/work/code/WeFlow/scripts/weflow-dyq-device-register.py')


def fail(msg, code=2):
    print(json.dumps({'passed': False, 'error': msg}, ensure_ascii=False, indent=2))
    return code


def load_weflow_module():
    spec = importlib.util.spec_from_file_location('weflow_dyq_device_register', WEFLOW_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'无法加载 WeFlow 脚本: {WEFLOW_SCRIPT}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_seed():
    ts_code = r'''
import { buildDyqWeFlowTaskSeed } from './src/operations/weflow-lead-handoff.ts';
const seed = buildDyqWeFlowTaskSeed({
  sourcePlatform: 'xiaohongshu',
  sourceUserId: 'round20-live-lead',
  displayName: '第20轮高意向客户',
  profileUrl: 'https://www.xiaohongshu.com/user/profile/round20-live-lead',
  sourceNoteUrl: 'https://www.xiaohongshu.com/explore/round20-live-note',
  lastMessage: '想了解数字人直播代运营和报价',
  intentTags: ['数字人直播', '代运营', '询价'],
  intentScore: 0.92,
  suggestedReply: '你好，我先把你的数字人直播代运营需求整理成方案草稿，稍后由人工确认后再回复你。',
  collectedAt: '2026-06-06T21:45:00+08:00',
});
console.log(JSON.stringify(seed));
'''
    proc = subprocess.run(
        ['npx', 'tsx', '-e', ts_code],
        cwd=SOCIAL_REPO,
        text=True,
        capture_output=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(f'生成社媒种子失败: {proc.stderr[-800:]}')
    seed = json.loads(proc.stdout)
    (OUT_DIR / 'dyq-weflow-task-seed.safe.json').write_text(json.dumps(seed, ensure_ascii=False, indent=2), encoding='utf-8')
    return seed


def main():
    if not PASSWORD:
        return fail('缺少 ADMIN_PASSWORD，不能执行管理后台真实下发')
    module = load_weflow_module()
    seed = build_seed()
    device_id = f'weflow-round20-s2-{int(time.time())}'
    register_payload = {
        'deviceId': device_id,
        'deviceName': 'WeFlow 第20轮社媒线索承接节点',
        'deviceType': 'WEFLOW_PC',
        'platform': 'WeFlow',
        'version': '0.0.1',
        'capabilities': ['wechat.message.prepare_text', 'wechat.message.receive'],
    }
    reg = module._http_json_request('POST', f'{BASE}/api/claw-device/register', body=register_payload)
    token = (reg.get('body') or {}).get('data', {}).get('deviceToken')
    if reg.get('httpStatus') != 200 or (reg.get('body') or {}).get('code') not in (0, '0', None) or not token:
        return fail(f'设备注册失败: http={reg.get("httpStatus")} code={(reg.get("body") or {}).get("code")}')

    heartbeat = module._http_json_request(
        'POST',
        f'{BASE}/api/claw-device/heartbeat',
        headers={'Authorization': f'Bearer {token}'},
        body={'timestamp': int(time.time() * 1000), 'batteryLevel': 100, 'isCharging': True, 'networkType': 'lan'},
    )
    if heartbeat.get('httpStatus') != 200 or (heartbeat.get('body') or {}).get('code') not in (0, '0', None):
        return fail(f'心跳失败: http={heartbeat.get("httpStatus")} code={(heartbeat.get("body") or {}).get("code")}')

    login = module._http_json_request(
        'POST',
        f'{BASE}/admin-api/system/auth/login',
        headers={'tenant-id': TENANT_ID},
        body={'tenantName': TENANT_NAME, 'username': USERNAME, 'password': PASSWORD},
    )
    admin_token = (login.get('body') or {}).get('data', {}).get('accessToken')
    if login.get('httpStatus') != 200 or (login.get('body') or {}).get('code') not in (0, '0', None) or not admin_token:
        return fail(f'管理后台登录失败: http={login.get("httpStatus")} code={(login.get("body") or {}).get("code")}')

    execute = module._http_json_request(
        'POST',
        f'{BASE}/admin-api/claw/device/{device_id}/execute',
        headers={'tenant-id': TENANT_ID, 'Authorization': f'Bearer {admin_token}'},
        body={'command': seed['command'], 'mode': seed['mode'], 'payload': seed['payload']},
    )
    task_uuid = (execute.get('body') or {}).get('data')
    if execute.get('httpStatus') != 200 or (execute.get('body') or {}).get('code') not in (0, '0', None) or not task_uuid:
        return fail(f'管理后台下发失败: http={execute.get("httpStatus")} code={(execute.get("body") or {}).get("code")}')

    result = module.process_one_pending_task(BASE, device_id, token)
    safe = result.get('safeDraft', {})
    submit = result.get('submitResponse', {})
    summary = {
        'passed': submit.get('httpStatus') == 200 and (submit.get('body') or {}).get('code') in (0, '0', None),
        'base': BASE,
        'deviceId': device_id,
        'seed': {
            'taskType': seed.get('taskType'),
            'mode': seed.get('mode'),
            'sourcePlatform': seed.get('payload', {}).get('sourcePlatform'),
            'sourceUserId': seed.get('payload', {}).get('sourceUserId'),
            'requiresHumanConfirmation': seed.get('safety', {}).get('requiresHumanConfirmation'),
            'externalActionAllowed': seed.get('safety', {}).get('externalActionAllowed'),
        },
        'checks': {
            'register': {'httpStatus': reg.get('httpStatus'), 'code': (reg.get('body') or {}).get('code'), 'hasDeviceToken': bool(token), 'tokenLength': len(token)},
            'heartbeat': {'httpStatus': heartbeat.get('httpStatus'), 'code': (heartbeat.get('body') or {}).get('code')},
            'adminLogin': {'httpStatus': login.get('httpStatus'), 'code': (login.get('body') or {}).get('code'), 'hasAccessToken': bool(admin_token)},
            'adminExecute': {'httpStatus': execute.get('httpStatus'), 'code': (execute.get('body') or {}).get('code'), 'taskUuid': task_uuid},
            'pendingToSafeDraftResult': {'httpStatus': submit.get('httpStatus'), 'code': (submit.get('body') or {}).get('code')},
        },
        'safeDraft': {
            'status': safe.get('status'),
            'commandType': safe.get('commandType'),
            'sessionName': safe.get('sessionName'),
            'draftTextLength': len((safe.get('draft') or {}).get('text') or ''),
            'requiresHumanConfirmation': (safe.get('draft') or {}).get('requiresHumanConfirmation'),
            'sendActionExecuted': (safe.get('evidence') or {}).get('sendActionExecuted'),
            'manualTakeoverRequired': (safe.get('evidence') or {}).get('manualTakeoverRequired'),
        },
    }
    (OUT_DIR / 'live-summary.safe.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary['passed'] else 3


if __name__ == '__main__':
    raise SystemExit(main())
