import { InMemoryHumanConfirmationQueue } from '/mnt/d/work/code/social-media-web-automation/src/console/human-confirmation-queue.ts';
import { createReadOnlyConsoleSnapshot, formatReadOnlyConsoleSnapshot } from '/mnt/d/work/code/social-media-web-automation/src/console/read-only-dashboard.ts';
import { enqueueXiaohongshuLiveLeadDetailsToConfirmationQueue } from '/mnt/d/work/code/social-media-web-automation/src/operations/live-room-lead-handoff.ts';

const queue = new InMemoryHumanConfirmationQueue();
enqueueXiaohongshuLiveLeadDetailsToConfirmationQueue([
  {
    tabId: 'tab-s1-live',
    url: 'https://www.xiaohongshu.com/explore/s1-live',
    requiresHuman: false,
    reason: 'none',
    actionHint: '只读详情已提取',
    riskKeywords: [],
    snapshot: { url: 'https://www.xiaohongshu.com/explore/s1-live', hasLoginModal: false, hasQr: false, hit: [], iframeCaptcha: [], canvasCount: 0, textPreview: '' },
    detail: {
      detailOpen: true,
      title: '直播间数字人获客复盘',
      desc: '直播间搭建、私域转化和获客报价经验',
      author: '运营同学',
      totalComments: '4',
      comments: [
        { user: '用户甲', text: '数字人直播怎么报价' },
        { user: '用户乙', text: '想要直播间搭建清单' },
      ],
    },
  },
  {
    tabId: 'tab-risk',
    url: 'https://www.xiaohongshu.com/explore/risk',
    requiresHuman: true,
    reason: 'login_or_verification_required',
    actionHint: '需要人工处理验证码',
    riskKeywords: ['验证码'],
    snapshot: { url: 'https://www.xiaohongshu.com/explore/risk', hasLoginModal: false, hasQr: false, hit: ['验证码'], iframeCaptcha: [], canvasCount: 1, textPreview: '验证码' },
  },
], queue, { keywordTags: ['数字人直播'], collectedAt: '2026-06-06T23:00:00.000Z' });

const snapshot = createReadOnlyConsoleSnapshot({
  tasks: [],
  queueItems: [],
  auditEvents: [],
  confirmationDrafts: queue.listPending(),
});
console.log(formatReadOnlyConsoleSnapshot(snapshot));
