#!/usr/bin/env python3
"""本次会话第6轮：S1 小红书只读详情草稿 -> DYQ admin execute -> WeFlow 安全草稿 -> 签名 result 真实闭环探针。

安全约束：
- 只读取开发测试凭证文件，不打印密码、管理后台令牌或设备令牌。
- 社媒侧只生成评论/承接草稿，不执行真实评论、私信、关注、点赞。
- WeFlow 只生成微信安全草稿并回传 result，不触发真实微信发送。
"""
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

BASE = os.environ.get('DYQ_BASE_URL', 'http://127.0.0.1:48080').rstrip('/')
TENANT_ID = os.environ.get('ADMIN_TENANT_ID', '1')
TENANT_NAME = os.environ.get('ADMIN_TENANT_NAME', 'yisheng')
USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
CREDENTIALS_FILE = Path('/mnt/e/code/dyq/.claude/rules/testing-credentials.md')
OUT_DIR = Path(__file__).resolve().parent
SOCIAL_REPO = Path('/mnt/d/work/code/social-media-web-automation')
WEFLOW_SCRIPT = Path('/mnt/d/work/code/WeFlow/scripts/weflow-dyq-device-register.py')


def fail(msg, code=2):
    summary = {'passed': False, 'error': msg}
    (OUT_DIR / 'live-summary.safe.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return code


def read_password() -> str:
    env_password = os.environ.get('ADMIN_PASSWORD')
    if env_password:
        return env_password
    text = CREDENTIALS_FILE.read_text(encoding='utf-8')
    match = re.search(r'密码\s*\|\s*`([^`]+)`', text)
    if not match:
        raise RuntimeError('未能从测试凭证文件读取管理后台密码')
    return match.group(1)


def load_weflow_module():
    spec = importlib.util.spec_from_file_location('weflow_dyq_device_register', WEFLOW_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'无法加载 WeFlow 脚本: {WEFLOW_SCRIPT}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_s1_seed():
    ts_code = r'''
import { buildLiveRoomLeadDraftFromXiaohongshuDetail } from './src/operations/live-room-lead-handoff.ts';
const extraction = {
  tabId: 'round26-s1-xhs-tab',
  url: 'https://www.xiaohongshu.com/explore/round26-s1-live-lead',
  requiresHuman: false,
  detail: {
    title: '数字人直播间搭建报价清单',
    desc: '想做本地生活数字人直播间，关注搭建周期、报价和私域转化。',
    author: '第26轮S1线索',
    commentsCount: 3,
    comments: [
      { text: '多少钱可以做一套数字人直播间？' },
      { text: '需要直播间搭建和获客方案。' },
      { text: '可以私信发一下报价吗？' },
    ],
  },
};
const draft = buildLiveRoomLeadDraftFromXiaohongshuDetail(extraction, {
  keywordTags: ['数字人直播', '直播间搭建', '报价'],
  suggestedComment: '我整理过数字人直播间搭建、获客和报价清单，可由人工确认后再回复。',
  collectedAt: '2026-06-06T23:16:00+08:00',
});
const seed = {
  mode: 'auto',
  taskType: 'wechat.message.prepare_text',
  command: [
    'S1直播间截流小红书只读详情转WeFlow安全草稿',
    'taskType=wechat.message.prepare_text',
    `sessionName=${draft.target}`,
    `text=${draft.content}`,
    'sourcePlatform=xiaohongshu',
    `sourceContentId=${draft.taskId}`,
  ].join(' '),
  payload: {
    taskType: 'wechat.message.prepare_text',
    sessionName: draft.target,
    text: draft.content,
    sourcePlatform: draft.platform,
    sourceContentId: draft.taskId,
    businessScenario: draft.businessScenario,
    riskLevel: draft.riskLevel,
    reviewNote: draft.reviewNote,
  },
  safety: {
    externalActionAllowed: false,
    requiresHumanConfirmation: true,
    boundary: 'S1只读线索只生成WeFlow安全草稿，不自动评论、不私信、不关注、不点赞、不绕过登录或风控',
  },
};
console.log(JSON.stringify({ draft, seed }));
'''
    proc = subprocess.run(
        ['npx', 'tsx', '-e', ts_code],
        cwd=SOCIAL_REPO,
        text=True,
        capture_output=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(f'生成 S1 社媒种子失败: {proc.stderr[-1000:]}')
    bundle = json.loads(proc.stdout)
    safe_seed = bundle['seed']
    (OUT_DIR / 's1-dyq-weflow-task-seed.safe.json').write_text(json.dumps(safe_seed, ensure_ascii=False, indent=2), encoding='utf-8')
    (OUT_DIR / 's1-confirmation-draft.safe.json').write_text(json.dumps(bundle['draft'], ensure_ascii=False, indent=2), encoding='utf-8')
    return bundle


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    password = read_password()
    module = load_weflow_module()
    bundle = build_s1_seed()
    seed = bundle['seed']
    draft = bundle['draft']
    device_id = f'weflow-round26-s1-{int(time.time())}'

    health = module._http_json_request('GET', f'{BASE}/admin-api/actuator/health')
    health_status = (health.get('body') or {}).get('status')
    if health.get('httpStatus') != 200 or health_status != 'UP':
        return fail(f'DYQ健康检查失败: http={health.get("httpStatus")} status={health_status}')

    reg = module._http_json_request('POST', f'{BASE}/api/claw-device/register', body={
        'deviceId': device_id,
        'deviceName': 'WeFlow 第26轮S1直播截流承接节点',
        'deviceType': 'WEFLOW_PC',
        'platform': 'WeFlow',
        'version': '0.0.1',
        'capabilities': ['wechat.message.prepare_text', 'wechat.message.receive'],
    })
    token = (reg.get('body') or {}).get('data', {}).get('deviceToken')
    if reg.get('httpStatus') != 200 or (reg.get('body') or {}).get('code') not in (0, '0', None) or not token:
        return fail(f'设备注册失败: http={reg.get("httpStatus")} code={(reg.get("body") or {}).get("code")}')

    heartbeat = module._http_json_request(
        'POST', f'{BASE}/api/claw-device/heartbeat',
        headers={'Authorization': f'Bearer {token}'},
        body={'timestamp': int(time.time() * 1000), 'batteryLevel': 100, 'isCharging': True, 'networkType': 'lan'},
    )
    if heartbeat.get('httpStatus') != 200 or (heartbeat.get('body') or {}).get('code') not in (0, '0', None):
        return fail(f'心跳失败: http={heartbeat.get("httpStatus")} code={(heartbeat.get("body") or {}).get("code")}')

    login = module._http_json_request(
        'POST', f'{BASE}/admin-api/system/auth/login',
        headers={'tenant-id': TENANT_ID},
        body={'tenantName': TENANT_NAME, 'username': USERNAME, 'password': password},
    )
    admin_token = (login.get('body') or {}).get('data', {}).get('accessToken')
    if login.get('httpStatus') != 200 or (login.get('body') or {}).get('code') not in (0, '0', None) or not admin_token:
        return fail(f'管理后台登录失败: http={login.get("httpStatus")} code={(login.get("body") or {}).get("code")}')

    execute = module._http_json_request(
        'POST', f'{BASE}/admin-api/claw/device/{device_id}/execute',
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
        'credentialsSource': str(CREDENTIALS_FILE),
        'deviceId': device_id,
        'checks': {
            'health': {'httpStatus': health.get('httpStatus'), 'status': health_status},
            'register': {'httpStatus': reg.get('httpStatus'), 'code': (reg.get('body') or {}).get('code'), 'hasDeviceToken': bool(token), 'tokenLength': len(token)},
            'heartbeat': {'httpStatus': heartbeat.get('httpStatus'), 'code': (heartbeat.get('body') or {}).get('code')},
            'adminLogin': {'httpStatus': login.get('httpStatus'), 'code': (login.get('body') or {}).get('code'), 'hasAccessToken': bool(admin_token)},
            'adminExecute': {'httpStatus': execute.get('httpStatus'), 'code': (execute.get('body') or {}).get('code'), 'taskUuid': task_uuid},
            'pendingToSafeDraftResult': {'httpStatus': submit.get('httpStatus'), 'code': (submit.get('body') or {}).get('code')},
        },
        's1Draft': {
            'taskId': draft.get('taskId'),
            'platform': draft.get('platform'),
            'businessScenario': draft.get('businessScenario'),
            'riskLevel': draft.get('riskLevel'),
            'target': draft.get('target'),
            'contentLength': len(draft.get('content') or ''),
        },
        'seedSafety': {
            'taskType': seed.get('taskType'),
            'requiresHumanConfirmation': seed.get('safety', {}).get('requiresHumanConfirmation'),
            'externalActionAllowed': seed.get('safety', {}).get('externalActionAllowed'),
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
