import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BoardView,
  type BoardViewProps,
  reportButtonState,
  formatLastReport,
} from '../src/client/view.js'
import { BoardApp } from '../src/client/index.js'
import { DEFAULT_FILTER } from '../src/board/model.js'

function props(over: Partial<BoardViewProps> = {}): BoardViewProps {
  return {
    configured: false,
    status: '未配置',
    groupFullPath: null,
    tokenMasked: null,
    tokenConfigured: false,
    allowSelfSigned: false,
    showState: true,
    showStatus: false,
    modeTruncated: false,
    todo: [],
    doing: [],
    blocked: [],
    done: [],
    unscoped: [],
    statusTruncated: false,
    summary: null,
    view: 'board',
    list: [],
    helpOpen: false,
    drawer: { kind: 'none' },
    mineName: null,
    refreshedAt: null,
    loading: false,
    connectionError: null,
    connectError: null,
    filter: DEFAULT_FILTER,
    members: [],
    memberError: null,
    labels: [],
    labelError: null,
    projects: [],
    projectError: null,
    opened: [],
    closed: [],
    openedTruncated: false,
    closedTruncated: false,
    closedHasMore: false,
    overduePartial: false,
    reportButton: { disabled: true, title: '尚未配置 GitLab 连接' },
    lastReportText: null,
    report: { kind: 'closed' },
    onRefresh() {},
    onFilter() {},
    onDueDate() {},
    onRisk() {},
    onMove() {},
    onRetry() {},
    onLoadClosed() {},
    onConnect() {},
    onClearToken() {},
    onSummary() {},
    onView() {},
    onSearch() {},
    onOnlyMine() {},
    onCreate() {},
    onOpen() {},
    onCloseDrawer() {},
    onHelp() {},
    onStatus() {},
    onReport() {},
    onReportWrite() {},
    onReportClose() {},
    ...over,
  }
}

test('an unconfigured board shows the connection form and not empty columns', () => {
  const html = renderToStaticMarkup(createElement(BoardView, props()))
  assert.match(html, /保存并连接/)
  assert.match(html, /尚未保存令牌/)
  assert.equal(html.includes('data-keel="column-opened"'), false)
  assert.equal(html.includes('没有议题'), false)
})

test('a configured board shows the two columns', () => {
  const html = renderToStaticMarkup(createElement(BoardView, props({
    configured: true,
    status: '已连接',
    groupFullPath: 'acme/platform',
  })))
  assert.match(html, /打开/)
  assert.match(html, /已关闭/)
  assert.match(html, /没有议题/)
  assert.match(html, /acme\/platform/)
})

test('reportButtonState computes state for GitLab and WeCom configuration', () => {
  assert.deepEqual(reportButtonState(null), { disabled: true, title: '尚未配置 GitLab 连接' })
  assert.deepEqual(reportButtonState({ configured: false, gitlabHealth: 'ok', wecomConfigured: true }), { disabled: true, title: '尚未配置 GitLab 连接' })
  assert.deepEqual(reportButtonState({ configured: true, gitlabHealth: 'error', wecomConfigured: true }), { disabled: true, title: '尚未配置 GitLab 连接' })
  assert.deepEqual(reportButtonState({ configured: true, gitlabHealth: 'ok', wecomConfigured: false }), { disabled: true, title: '尚未配置企业微信' })
  assert.deepEqual(reportButtonState({ configured: true, gitlabHealth: 'ok', wecomConfigured: true }), { disabled: false, title: '预览并写入本周周报' })
})

test('formatLastReport formats last report time in Asia/Shanghai or returns null', () => {
  assert.equal(formatLastReport(null), null)
  assert.equal(
    formatLastReport({ at: '2026-11-20T02:00:00.000Z', written: 3, skipped: 1, failed: 0 }),
    '上次周报：11-20 10:00 写入 3 跳过 1 失败 0'
  )
})

test('header report button states and last report text', () => {
  const disabledHtml = renderToStaticMarkup(createElement(BoardView, props({
    reportButton: { disabled: true, title: '尚未配置企业微信' },
  })))
  assert.match(disabledHtml, /<button type="button" disabled(?:="")? title="尚未配置企业微信">立即生成本周周报<\/button>/)

  const enabledHtml = renderToStaticMarkup(createElement(BoardView, props({
    reportButton: { disabled: false, title: '预览并写入本周周报' },
    report: { kind: 'closed' },
  })))
  assert.match(enabledHtml, /<button type="button" title="预览并写入本周周报">立即生成本周周报<\/button>/)

  const textHtml = renderToStaticMarkup(createElement(BoardView, props({
    lastReportText: '上次周报：11-20 10:00 写入 3 跳过 1 失败 0',
  })))
  assert.match(textHtml, /<span class="keel-last-report">上次周报：11-20 10:00 写入 3 跳过 1 失败 0<\/span>/)

  const loadingHtml = renderToStaticMarkup(createElement(BoardView, props({
    reportButton: { disabled: false, title: '预览并写入本周周报' },
    report: { kind: 'loading', progress: { done: 0, total: 3 } },
  })))
  assert.match(loadingHtml, /<button type="button" disabled(?:="")? title="预览并写入本周周报">立即生成本周周报<\/button>/)
})

test('closed report dialog renders no dialog in markup', () => {
  const html = renderToStaticMarkup(createElement(BoardView, props({
    report: { kind: 'closed' },
  })))
  assert.equal(html.includes('role="dialog"'), false)
})

test('loading report dialog renders progress', () => {
  const html = renderToStaticMarkup(createElement(BoardView, props({
    report: { kind: 'loading', progress: { done: 0, total: 3 } },
  })))
  assert.match(html, /正在生成预览…/)
  assert.match(html, /已完成 0 \/ 3 个仓库/)
})

test('preview report dialog renders escaped text, titles, failed projects, and active write button', () => {
  const preview = {
    asOf: '2026-11-20T10:00:00.000Z',
    weekTitle: '2026 年第 47 周周报',
    windowStart: '2026-11-13 18:00',
    windowEnd: '2026-11-20 18:00',
    generatedAt: '2026-11-20 18:01',
    monthlyDue: true,
    monthlyTitle: '2026 年 11 月月报',
    projects: [
      {
        projectId: 1,
        projectPath: 'acme/platform',
        text: '重点事项：<b>高风险</b>',
        counts: { created: 1, closed: 0, overdue: 0, highRiskEvents: 1, doing: null, blocked: null, highRiskNow: 1 },
        truncated: false,
      },
    ],
    failed: [
      {
        projectId: 2,
        projectPath: 'acme/frontend',
        message: 'GitLab 访问受限',
      },
    ],
  }
  const html = renderToStaticMarkup(createElement(BoardView, props({
    report: { kind: 'preview', preview },
  })))
  assert.match(html, /&lt;b&gt;高风险&lt;\/b&gt;/)
  assert.equal(html.includes('<b>高风险</b>'), false)
  assert.match(html, /2026 年第 47 周周报/)
  assert.match(html, /生成于：2026-11-20 18:01/)
  assert.match(html, /acme\/frontend：GitLab 访问受限/)
  assert.match(html, /本次同时写入 2026 年 11 月月报/)
  assert.match(html, /<button type="button">写入企业微信<\/button>/)
})

test('writing report dialog disables write and close buttons and shows progress', () => {
  const preview = {
    asOf: '2026-11-20T10:00:00.000Z',
    weekTitle: '2026 年第 47 周周报',
    windowStart: '2026-11-13 18:00',
    windowEnd: '2026-11-20 18:00',
    generatedAt: '2026-11-20 18:01',
    monthlyDue: false,
    monthlyTitle: null,
    projects: [],
    failed: [],
  }
  const html = renderToStaticMarkup(createElement(BoardView, props({
    report: { kind: 'writing', preview, progress: { done: 2, total: 5 } },
  })))
  assert.match(html, /<button type="button" disabled(?:="")?>写入企业微信<\/button>/)
  assert.match(html, /<button type="button" disabled(?:="")?>关闭<\/button>/)
  assert.match(html, /已完成 2 \/ 5 个仓库/)
})

test('result report dialog displays project results, changed counts notice, doc links, and monthly statuses', () => {
  const baseCounts = { created: 1, closed: 1, overdue: 0, highRiskEvents: 0, doing: null, blocked: null, highRiskNow: 0 }
  const preview = {
    asOf: '2026-11-20T10:00:00.000Z',
    weekTitle: '2026 年第 47 周周报',
    windowStart: '2026-11-13 18:00',
    windowEnd: '2026-11-20 18:00',
    generatedAt: '2026-11-20 18:01',
    monthlyDue: false,
    monthlyTitle: null,
    projects: [
      {
        projectId: 1,
        projectPath: 'acme/p1',
        text: 'p1',
        counts: baseCounts,
        truncated: false,
      },
      {
        projectId: 2,
        projectPath: 'acme/p2',
        text: 'p2',
        counts: baseCounts,
        truncated: false,
      },
      {
        projectId: 3,
        projectPath: 'acme/p3',
        text: 'p3',
        counts: baseCounts,
        truncated: false,
      },
    ],
    failed: [],
  }

  const result = {
    kind: 'manual' as const,
    weekTitle: '2026 年第 47 周周报',
    finishedAt: '2026-11-20 18:02',
    message: null,
    projects: [
      {
        projectId: 1,
        projectPath: 'acme/p1',
        weekly: 'written' as const,
        monthly: 'written' as const,
        message: null,
        docUrl: 'https://doc.weixin.qq.com/doc/p1',
        counts: { ...baseCounts, created: 5 },
      },
      {
        projectId: 2,
        projectPath: 'acme/p2',
        weekly: 'skipped' as const,
        monthly: 'not-due' as const,
        message: null,
        docUrl: null,
        counts: baseCounts,
      },
      {
        projectId: 3,
        projectPath: 'acme/p3',
        weekly: 'failed' as const,
        monthly: 'failed' as const,
        message: '网络连接超时',
        docUrl: null,
        counts: null,
      },
    ],
  }

  const html = renderToStaticMarkup(createElement(BoardView, props({
    report: { kind: 'result', preview, result },
  })))
  assert.match(html, /已写入/)
  assert.match(html, /href="https:\/\/doc\.weixin\.qq\.com\/doc\/p1"/)
  assert.match(html, /打开文档/)
  assert.match(html, /数据在预览后有变化，已按最新数据写入/)
  assert.match(html, /已跳过（内容相同）/)
  assert.match(html, /失败：网络连接超时/)
  assert.match(html, /月报已写入/)
  assert.equal(html.includes('not-due'), false)
  assert.equal(html.includes('月报not-due'), false)
  assert.equal(html.includes('月报已跳过'), false)
})

test('error report dialog shows message with alert role', () => {
  const html = renderToStaticMarkup(createElement(BoardView, props({
    report: { kind: 'error', message: '服务异常，请稍后重试' },
  })))
  assert.match(html, /role="alert"[^>]*>服务异常，请稍后重试/)
})

test('BoardApp renders with report controls and connection', () => {
  const fakeRemote = {
    async listIssues() { return { issues: [], page: 1, perPage: 20, nextPage: null, truncated: false, total: 0 } },
    async connection() {
      return {
        configured: true,
        baseUrl: 'https://gitlab.example.com',
        groupPath: 'acme/platform',
        groupFullPath: 'acme/platform',
        allowSelfSigned: false,
        tokenConfigured: true,
        tokenMasked: 'glpat-***',
        labelsReady: true,
        gitlabHealth: 'ok' as const,
        gitlabHealthDetail: null,
        wecomConfigured: true,
        wecomCorpId: 'corp1',
        wecomSpaceId: 's1',
        wecomFatherId: 'f1',
        wecomSecretConfigured: true,
        wecomSecretMasked: 'sec-***',
        wecomHealth: 'ok' as const,
        wecomHealthDetail: null,
        lastReport: { at: '2026-11-20T02:00:00.000Z', written: 2, skipped: 1, failed: 0 },
      }
    },
    async columnModes() { return { modes: [], truncated: false } },
    async summary() {
      return {
        overdue: { count: 0, complete: true },
        dueThisWeek: { count: 0, complete: true },
        highRisk: { count: 0, complete: true },
        unassessed: { count: 0, complete: true },
      }
    },
    async members() { return [] },
    async labels() { return [] },
    async projects() { return [] },
    async saveConfig() { throw new Error('not implemented') },
    async clearToken() { throw new Error('not implemented') },
    async write() { throw new Error('not implemented') },
    async reportStart() { return { runId: 'run-1' } },
    async reportStatus() {
      return {
        state: 'queued' as const,
        progress: { done: 0, total: 0 },
        preview: null,
        result: null,
        message: null,
      }
    },
  }
  const html = renderToStaticMarkup(createElement(BoardApp, { remote: fakeRemote }))
  assert.match(html, /项目看板/)
})
