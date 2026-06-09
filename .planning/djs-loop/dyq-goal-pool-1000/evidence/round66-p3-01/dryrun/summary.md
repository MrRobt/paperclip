# P3-01 端侧任务领取/执行/证据回传 — 证据汇总

- 时间: 20260607-133319
- 设备: pokeclaw-p3p01-20260607-133319
- 模式: USE_MOCK_BACKEND=True  PUSH_REAL_RESULT=False
- BASE_URL: http://127.0.0.1:18221
- 任务: fbeb0052-225b-4f18-8495-dc97f8b4af63
- 指令: 打开设置查看电量
- Android JVM 单测: **skipped**
- 门禁失败数: 0

## 端云链路 (4 步)
1. 设备注册 -> token=mock-device-token-...
2. 拉取任务 -> taskUuid=fbeb0052-225b-4f18-8495-dc97f8b4af63
3. 模拟执行（不真操作手机）-> 状态 RECEIVED->RUNNING->SUCCEEDED
4. 上报结果 + 经验 -> HTTP_STATUS:200-DRY-RUN

## 产物清单
- 状态流: evidence/status_reports.json
- 最终回执: evidence/receipt.json
- 模拟云端载荷: evidence/mock_cloud_payload.json
- 经验上报载荷: evidence/experience_payload.json
- 真实上报 body (dry-run): evidence/result_payload.json
- 真实上报 body (real):    responses/04_submit_result.body
- 模拟截图: screenshots/state_evidence.txt
- 任务原始: task_flow/claimed_task.json

## 禁止事项自检
- [x] 未真实发短信 / 打电话 / 启动第三方 App
- [x] 未真实外发微信 / 私信 / Email
- [x] 状态机在本地推进，状态流转可被 receipts 复盘
- [x] 模拟截图与执行证据成对存在
