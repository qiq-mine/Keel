import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { comparableText, countsOf, normalizeTitle, renderSection } from '../src/report/render.js'
import type { ReportData, HighRiskEvent } from '../src/report/collect.js'
import type { ReportIssue } from '../src/gitlab/api.js'

const HOUR_MS = 60 * 60 * 1000

function at(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute, second) - 8 * HOUR_MS
}

function issue(iid: number, title: string, assignees: { id: number, name: string }[], createdAt: number): ReportIssue {
  return {
    projectId: 7,
    projectPath: 'acme/app',
    iid,
    title,
    confidential: false,
    webUrl: `https://gitlab.example.com/acme/app/-/issues/${iid}`,
    assignees,
    createdAt: new Date(createdAt).toISOString(),
    closedAt: null,
  }
}

const zhangsan = { id: 1, name: '张三' }
const wangwu = { id: 2, name: '王五' }

function sampleData(): ReportData {
  const i12 = issue(12, '登录失败', [zhangsan], at(2026, 11, 17, 9))
  const i9 = issue(9, '导出超时', [wangwu], at(2026, 10, 30, 8))
  const i4 = issue(4, '支付重试', [wangwu], at(2026, 11, 10, 15))
  const i7 = issue(7, '权限页改版', [zhangsan], at(2026, 11, 15, 11))
  return {
    projectId: 7,
    projectPath: 'acme/app',
    columnMode: 'status',
    weekTitle: '周报 2026-11-20',
    windowStart: at(2026, 11, 16),
    windowEnd: at(2026, 11, 20, 10),
    generatedAt: at(2026, 11, 20, 10),
    created: { issues: [i12], truncated: false },
    closed: { issues: [], truncated: false },
    overdue: { issues: [i9], truncated: false },
    highRisk: {
      events: [{ issue: i4, at: new Date(at(2026, 11, 18, 14, 2, 11)).toISOString(), action: 'add' }],
      truncated: false,
    },
    doing: { issues: [i4, i7], truncated: false },
    blocked: { issues: [i9], truncated: false },
    highRiskNow: { issues: [i4], truncated: false },
  }
}

test('renderSection 与样例输出逐字一致', () => {
  const expected = readFileSync('tests/fixtures/report/expected-section-status.txt', 'utf8').replace(/\n$/, '')
  assert.equal(renderSection(sampleData()), expected)
})

function stateData(): ReportData {
  const data = sampleData()
  data.columnMode = 'state'
  data.doing = null
  data.blocked = null
  return data
}

test('renderSection 开关模式与样例输出逐字一致', () => {
  const expected = readFileSync('tests/fixtures/report/expected-section-state.txt', 'utf8').replace(/\n$/, '')
  assert.equal(renderSection(stateData()), expected)
})

test('countsOf 开关模式下进行中和阻塞为 null', () => {
  assert.deepEqual(countsOf(stateData()), {
    created: 1,
    closed: 0,
    overdue: 1,
    highRiskEvents: 1,
    doing: null,
    blocked: null,
    highRiskNow: 1,
  })
})

test('remove 事件输出「去掉 risk::high」', () => {
  const data = sampleData()
  data.highRisk = {
    events: [{ issue: issue(4, '支付重试', [wangwu], at(2026, 11, 10, 15)), at: new Date(at(2026, 11, 18, 14, 2, 11)).toISOString(), action: 'remove' }],
    truncated: false,
  }
  const text = renderSection(data)
  assert.ok(text.includes('  2026-11-18 14:02:11 去掉 risk::high'))
})

test('assignees 为空的议题计入「未分配」且排在最后', () => {
  const data = sampleData()
  data.created = {
    issues: [issue(12, '登录失败', [zhangsan], at(2026, 11, 17, 9)), issue(20, '无负责人议题', [], at(2026, 11, 17, 10))],
    truncated: false,
  }
  const text = renderSection(data)
  const start = text.indexOf('按负责人\n')
  const section = text.slice(start).split('\n\n')[0]
  assert.equal(section, [
    '按负责人',
    '- 张三：新建 1 关闭 0 逾期 0 进行中 1 阻塞 0 高风险 0',
    '- 王五：新建 0 关闭 0 逾期 1 进行中 1 阻塞 1 高风险 1',
    '- 未分配：新建 1 关闭 0 逾期 0 进行中 0 阻塞 0 高风险 0',
  ].join('\n'))
})

test('webUrl 为 null 时列表行不带链接', () => {
  const data = sampleData()
  const noLink = { ...issue(21, '没有链接的议题', [zhangsan], at(2026, 11, 17, 9)), webUrl: null }
  data.created = { issues: [noLink], truncated: false }
  const text = renderSection(data)
  assert.ok(text.includes('\n- acme/app#21 没有链接的议题\n'))
  assert.ok(!text.includes('https://gitlab.example.com/acme/app/-/issues/21'))
})

test('一个议题有两个负责人时两人各计一次', () => {
  const data = sampleData()
  data.created = { issues: [issue(12, '登录失败', [zhangsan, wangwu], at(2026, 11, 17, 9))], truncated: false }
  const text = renderSection(data)
  assert.ok(text.includes('- 张三：新建 1 关闭 0 逾期 0 进行中 1 阻塞 0 高风险 0'))
  assert.ok(text.includes('- 王五：新建 1 关闭 0 逾期 1 进行中 1 阻塞 1 高风险 1'))
})

test('countsOf 统计各段数量', () => {
  assert.deepEqual(countsOf(sampleData()), {
    created: 1,
    closed: 0,
    overdue: 1,
    highRiskEvents: 1,
    doing: 2,
    blocked: 1,
    highRiskNow: 1,
  })
})

test('comparableText 去掉生成于一行', () => {
  const text = renderSection(sampleData())
  assert.equal(comparableText(text), text.split('\n').filter(line => !line.startsWith('生成于：')).join('\n'))
  assert.equal(comparableText('a\n生成于：2026-11-20 10:00:00\nb'), 'a\nb')
})

test('高风险事件里的保密议题：正文不显示，计数与已省略仍包含', () => {
  const secret = { ...issue(88, '涉密安全事件', [zhangsan], at(2026, 11, 18, 10)), confidential: true }
  const data = sampleData()
  data.highRisk = {
    events: [{ issue: secret, at: new Date(at(2026, 11, 18, 14, 2, 11)).toISOString(), action: 'add' }],
    truncated: false,
  }
  const text = renderSection(data)
  assert.ok(!text.includes('涉密安全事件'))
  assert.ok(!text.includes('#88'))
  assert.ok(text.includes('高风险变动\n（无）'))
  assert.ok(text.includes('高风险变动：1'))
  assert.ok(text.includes('已省略保密议题：1'))
})

test('新建里的保密议题：负责人计数包含，正文不显示', () => {
  const secret = { ...issue(66, '薪酬调整', [zhangsan], at(2026, 11, 16, 9)), confidential: true }
  const data = sampleData()
  data.created = {
    issues: [issue(12, '登录失败', [zhangsan], at(2026, 11, 17, 9)), secret],
    truncated: false,
  }
  const text = renderSection(data)
  assert.ok(!text.includes('薪酬调整'))
  assert.ok(!text.includes('#66'))
  assert.ok(text.includes('已省略保密议题：1'))
  assert.ok(text.includes('- 张三：新建 2 关闭 0 逾期 0 进行中 1 阻塞 0 高风险 0'))
})

test('normalizeTitle 把换行改成一个空格并去首尾空白', () => {
  assert.equal(normalizeTitle('第一行\r\n第二行\n第三行\r第四行'), '第一行 第二行 第三行 第四行')
  assert.equal(normalizeTitle('  前后空白  '), '前后空白')
})

test('normalizeTitle 按码点截断：121 个截成 120 个加 …，恰好 120 个不加', () => {
  assert.equal(normalizeTitle('长'.repeat(120)), '长'.repeat(120))
  assert.equal(normalizeTitle('长'.repeat(121)), `${'长'.repeat(120)}…`)
  // 代理对按码点计：120 个码点时结尾的 emoji 原样保留，121 个时整体去掉再加 …
  assert.equal(normalizeTitle('a'.repeat(119) + '😀'), 'a'.repeat(119) + '😀')
  assert.equal(normalizeTitle('a'.repeat(120) + '😀'), `${'a'.repeat(120)}…`)
})

test('列表行里含换行的标题显示为一行', () => {
  const data = sampleData()
  data.created = { issues: [issue(30, '第一行\n第二行', [zhangsan], at(2026, 11, 17, 9))], truncated: false }
  const text = renderSection(data)
  assert.ok(text.includes('- acme/app#30 第一行 第二行 https://gitlab.example.com/acme/app/-/issues/30'))
})

test('新建 101 条可显示议题：列前 100 条并写（另有 1 条未列出），计数仍是全量', () => {
  const data = sampleData()
  const issues: ReportIssue[] = []
  for (let iid = 1001; iid <= 1101; iid += 1) issues.push(issue(iid, `议题 ${iid}`, [zhangsan], at(2026, 11, 17, 9)))
  data.created = { issues, truncated: false }
  const text = renderSection(data)
  assert.ok(text.includes('（另有 1 条未列出）'))
  assert.ok(text.includes('- acme/app#1100 议题 1100'))
  assert.ok(!text.includes('#1101'))
  assert.ok(text.includes('- 张三：新建 101 关闭 0 逾期 0 进行中 1 阻塞 0 高风险 0'))
})

test('新建恰好 100 条可显示议题：不加未列出说明', () => {
  const data = sampleData()
  const issues: ReportIssue[] = []
  for (let iid = 1; iid <= 100; iid += 1) issues.push(issue(iid, `议题 ${iid}`, [zhangsan], at(2026, 11, 17, 9)))
  data.created = { issues, truncated: false }
  const text = renderSection(data)
  assert.ok(!text.includes('未列出'))
})

test('truncated 段在段标题下一行写截断说明，然后才是列表或（无）', () => {
  const data = sampleData()
  data.overdue = { issues: [issue(9, '导出超时', [wangwu], at(2026, 10, 30, 8))], truncated: true }
  data.highRisk = { events: [], truncated: true }
  const text = renderSection(data)
  assert.ok(text.includes('逾期\n（本段已截断，只统计了接口返回的前 2000 条）\n- acme/app#9'))
  assert.ok(text.includes('高风险变动\n（本段已截断，只统计了接口返回的前 2000 条）\n（无）'))
})

test('高风险变动按议题合并：同一议题一行，事件行都跟着这一行', () => {
  const data = sampleData()
  const i4 = issue(4, '支付重试', [wangwu], at(2026, 11, 10, 15))
  data.highRisk = {
    events: [
      { issue: i4, at: new Date(at(2026, 11, 18, 14, 2, 11)).toISOString(), action: 'add' },
      { issue: i4, at: new Date(at(2026, 11, 18, 16, 0, 0)).toISOString(), action: 'remove' },
    ],
    truncated: false,
  }
  const text = renderSection(data)
  const start = text.indexOf('高风险变动\n')
  const end = text.indexOf('\n当前快照')
  const section = text.slice(start, end).replace(/\n$/, '')
  assert.equal(section, [
    '高风险变动',
    '- acme/app#4 支付重试 https://gitlab.example.com/acme/app/-/issues/4',
    '  2026-11-18 14:02:11 加上 risk::high',
    '  2026-11-18 16:00:00 去掉 risk::high',
  ].join('\n'))
})

test('高风险变动按议题计 100 个：多事件的议题只占一个名额', () => {
  const data = sampleData()
  const events: HighRiskEvent[] = []
  for (let iid = 1; iid <= 101; iid += 1) {
    const item = issue(iid, `议题 ${iid}`, [wangwu], at(2026, 11, 10, 15))
    events.push({ issue: item, at: new Date(at(2026, 11, 18, 12, 0, 0)).toISOString(), action: 'add' })
    if (iid === 1) events.push({ issue: item, at: new Date(at(2026, 11, 18, 13, 0, 0)).toISOString(), action: 'remove' })
  }
  data.highRisk = { events, truncated: false }
  const text = renderSection(data)
  const start = text.indexOf('高风险变动\n')
  const end = text.indexOf('\n当前快照')
  const section = text.slice(start, end)
  assert.ok(section.includes('（另有 1 条未列出）'))
  assert.equal(section.split('\n').filter(line => line.startsWith('- acme/app#')).length, 100)
  assert.ok(section.includes('  2026-11-18 12:00:00 加上 risk::high'))
  assert.ok(section.includes('  2026-11-18 13:00:00 去掉 risk::high'))
  assert.ok(!section.includes('#101'))
})
