import test from 'node:test'
import assert from 'node:assert/strict'
import { parseWeeks, renderMonthly } from '../src/report/monthly.js'

test('renderMonthly matches design sample for full monthly document', () => {
  const doc = [
    'Keel 周报',
    'acme/app',
    '',
    '周报 2026-10-30',
    '新建：5',
    '关闭：5',
    '逾期：0',
    '高风险变动：2',
    '当前快照',
    '进行中：2',
    '阻塞：1',
    '当前高风险：1',
    '按负责人',
    '- 张三：新建 1 关闭 0 逾期 0 进行中 1 阻塞 0 高风险 0',
    '',
    '月报 2026-11',
    '旧月报内容',
    '',
    '周报 2026-11-06',
    '新建：1',
    '关闭：0',
    '逾期：0',
    '高风险变动：1',
    '当前快照',
    '进行中：2',
    '阻塞：1',
    '当前高风险：1',
    '按负责人',
    '- 张三：新建 1 关闭 0 逾期 0 进行中 1 阻塞 0 高风险 0',
    '',
    '周报 2026-11-13',
    '新建：0',
    '关闭：1',
    '逾期：1',
    '高风险变动：0',
    '当前快照',
    '进行中：2',
    '阻塞：1',
    '当前高风险：1',
    '按负责人',
    '- 张三：新建 1 关闭 0 逾期 0 进行中 1 阻塞 0 高风险 0',
    '',
    '周报 2026-11-20',
    '新建：1',
    '关闭：0',
    '逾期：1',
    '高风险变动：1',
    '当前快照',
    '进行中：2',
    '阻塞：1',
    '当前高风险：1',
    '按负责人',
    '- 张三：新建 1 关闭 0 逾期 0 进行中 1 阻塞 0 高风险 0',
    '',
    '周报 2026-11-27',
    '新建：1',
    '关闭：1',
    '逾期：2',
    '高风险变动：3',
    '当前快照',
    '进行中：2',
    '阻塞：1',
    '当前高风险：1',
    '按负责人',
    '- 张三：新建 1 关闭 0 逾期 0 进行中 1 阻塞 0 高风险 0'
  ].join('\n')

  const weeks = parseWeeks(doc, '2026-11')
  assert.equal(weeks.length, 4)
  assert.deepEqual(
    weeks.map((w) => w.missing),
    [false, false, false, false]
  )

  const expected = [
    '月报 2026-11',
    '来源：本文档中标题日期属于 2026-11 的周报',
    '周次：4',
    '新建合计：3',
    '关闭合计：2',
    '高风险变动合计：5',
    '月末逾期：2',
    '说明：新建合计与关闭合计是各周次数相加。高风险变动合计也是各周次数相加，同一议题跨周会重复计入。月末逾期取该月最后一份周报的逾期数，不是各周相加。',
    '',
    '周报 2026-11-06  新建 1  关闭 0  逾期 0  高风险变动 1',
    '周报 2026-11-13  新建 0  关闭 1  逾期 1  高风险变动 0',
    '周报 2026-11-20  新建 1  关闭 0  逾期 1  高风险变动 1',
    '周报 2026-11-27  新建 1  关闭 1  逾期 2  高风险变动 3'
  ].join('\n')

  assert.equal(renderMonthly('2026-11', weeks), expected)
})

test('snapshot and per-assignee lines do not change counts', () => {
  const doc = [
    '周报 2026-11-06',
    '新建：1',
    '关闭：0',
    '逾期：0',
    '高风险变动：1',
    '当前快照',
    '进行中：9',
    '阻塞：1',
    '当前高风险：9',
    '按负责人',
    '- 张三：新建 9 关闭 9 逾期 9 进行中 9 阻塞 9 高风险 9'
  ].join('\n')

  const weeks = parseWeeks(doc, '2026-11')
  assert.equal(weeks.length, 1)
  assert.equal(weeks[0].created, 1)
  assert.equal(weeks[0].closed, 0)
  assert.equal(weeks[0].overdue, 0)
  assert.equal(weeks[0].highRisk, 1)
  assert.equal(weeks[0].missing, false)
})

test('section missing overdue sets overdue to 0, missing to true, and appends to note', () => {
  const doc = [
    '周报 2026-11-13',
    '新建：0',
    '关闭：1',
    '高风险变动：0'
  ].join('\n')

  const weeks = parseWeeks(doc, '2026-11')
  assert.equal(weeks.length, 1)
  assert.equal(weeks[0].overdue, 0)
  assert.equal(weeks[0].missing, true)

  const rendered = renderMonthly('2026-11', weeks)
  const lines = rendered.split('\n')
  const noteLine = lines[7]
  assert.ok(noteLine.endsWith('周报 2026-11-13 缺少计数，按 0。'))
})

test('month filter excludes weeks outside specified month', () => {
  const doc = [
    '周报 2026-11-27',
    '新建：1',
    '关闭：1',
    '逾期：2',
    '高风险变动：3',
    '周报 2026-12-04',
    '新建：2',
    '关闭：2',
    '逾期：1',
    '高风险变动：1'
  ].join('\n')

  const weeks = parseWeeks(doc, '2026-11')
  assert.equal(weeks.length, 1)
  assert.equal(weeks[0].date, '2026-11-27')
})

test('duplicate title keeps only the first section', () => {
  const doc = [
    '周报 2026-11-06',
    '新建：1',
    '关闭：0',
    '逾期：0',
    '高风险变动：1',
    '周报 2026-11-06',
    '新建：9',
    '关闭：9',
    '逾期：9',
    '高风险变动：9'
  ].join('\n')

  const weeks = parseWeeks(doc, '2026-11')
  assert.equal(weeks.length, 1)
  assert.equal(weeks[0].created, 1)
})

test('title with trailing space is not recognized as title', () => {
  const doc = [
    '周报 2026-11-20 ',
    '新建：1',
    '关闭：0',
    '逾期：0',
    '高风险变动：1'
  ].join('\n')

  const weeks = parseWeeks(doc, '2026-11')
  assert.equal(weeks.length, 0)
})

test('zero weeks renders header with zeros and ends with note line', () => {
  const rendered = renderMonthly('2026-11', [])
  const expected = [
    '月报 2026-11',
    '来源：本文档中标题日期属于 2026-11 的周报',
    '周次：0',
    '新建合计：0',
    '关闭合计：0',
    '高风险变动合计：0',
    '月末逾期：0',
    '说明：新建合计与关闭合计是各周次数相加。高风险变动合计也是各周次数相加，同一议题跨周会重复计入。月末逾期取该月最后一份周报的逾期数，不是各周相加。'
  ].join('\n')

  assert.equal(rendered, expected)
})
