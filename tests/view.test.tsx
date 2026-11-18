import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BoardView, type BoardViewProps } from '../src/client/view.js'
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
