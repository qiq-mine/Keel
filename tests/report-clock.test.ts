import assert from 'node:assert/strict'
import test from 'node:test'
import { catchUpTarget, formatShanghai, isLastFriday, monthTitle, nextScheduled, weekOf, windowEnd } from '../src/report/clock.js'

const at = (value: string) => Date.parse(value)

test('matches every row of the design section 7 example table', () => {
  const rows = [
    {
      now: at('2026-11-20T10:00:00+08:00'),
      kind: 'scheduled',
      F: '2026-11-20',
      windowStart: at('2026-11-16T00:00:00+08:00'),
      windowEnd: at('2026-11-20T10:00:00+08:00'),
      monthly: false,
    },
    {
      now: at('2026-11-18T15:00:30+08:00'),
      kind: 'manual',
      F: '2026-11-20',
      windowStart: at('2026-11-16T00:00:00+08:00'),
      windowEnd: at('2026-11-18T15:00:30+08:00'),
      monthly: false,
    },
    {
      now: at('2026-11-21T12:00:00+08:00'),
      kind: 'manual',
      F: '2026-11-20',
      windowStart: at('2026-11-16T00:00:00+08:00'),
      windowEnd: at('2026-11-20T10:00:00+08:00'),
      monthly: false,
    },
    {
      now: at('2026-11-27T10:00:00+08:00'),
      kind: 'scheduled',
      F: '2026-11-27',
      windowStart: at('2026-11-23T00:00:00+08:00'),
      windowEnd: at('2026-11-27T10:00:00+08:00'),
      monthly: true,
    },
    {
      now: at('2026-11-28T09:00:00+08:00'),
      kind: 'manual',
      F: '2026-11-27',
      windowStart: at('2026-11-23T00:00:00+08:00'),
      windowEnd: at('2026-11-27T10:00:00+08:00'),
      monthly: true,
    },
    {
      now: at('2026-12-04T10:00:00+08:00'),
      kind: 'scheduled',
      F: '2026-12-04',
      windowStart: at('2026-11-30T00:00:00+08:00'),
      windowEnd: at('2026-12-04T10:00:00+08:00'),
      monthly: false,
    },
  ] as const
  for (const row of rows) {
    const week = weekOf(row.now)
    assert.equal(week.F, row.F, `F for ${row.now}`)
    assert.equal(week.weekTitle, `周报 ${row.F}`, `week title for ${row.now}`)
    assert.equal(week.windowStart, row.windowStart, `window start for ${row.now}`)
    assert.equal(windowEnd(row.now, row.kind), row.windowEnd, `window end for ${row.now}`)
    assert.equal(isLastFriday(row.F), row.monthly, `monthly due for ${row.F}`)
  }
})

test('manual window end at exactly Friday 10:00 and for catch-up matches the scheduled cap', () => {
  const fridayTen = at('2026-11-20T10:00:00+08:00')
  assert.equal(windowEnd(fridayTen, 'manual'), fridayTen)
  const weekend = at('2026-11-21T08:00:00+08:00')
  assert.equal(windowEnd(weekend, 'catch-up'), fridayTen)
  assert.equal(windowEnd(weekend, 'catch-up'), windowEnd(weekend, 'scheduled'))
})

test('window is a closed interval: Monday 00:00:00.000 counts in, one millisecond before does not', () => {
  const now = at('2026-11-20T10:00:00+08:00')
  const week = weekOf(now)
  const end = windowEnd(now, 'scheduled')
  const inWindow = (t: number) => t >= week.windowStart && t <= end
  const monday = at('2026-11-16T00:00:00.000+08:00')
  assert.equal(inWindow(monday), true)
  assert.equal(inWindow(monday - 1), false)
  const previous = weekOf(monday - 1)
  assert.equal(previous.F, '2026-11-13')
  assert.equal(previous.windowStart, at('2026-11-09T00:00:00+08:00'))
})

test('window is a closed interval: Friday 10:00:00.000 counts in, one millisecond after does not', () => {
  const now = at('2026-11-20T10:00:00+08:00')
  const week = weekOf(now)
  const end = windowEnd(now, 'scheduled')
  const inWindow = (t: number) => t >= week.windowStart && t <= end
  const fridayTen = at('2026-11-20T10:00:00.000+08:00')
  assert.equal(inWindow(fridayTen), true)
  assert.equal(inWindow(fridayTen + 1), false)
})

test('Saturday and Sunday belong to the Friday that just passed', () => {
  assert.equal(weekOf(at('2026-11-21T12:00:00+08:00')).F, '2026-11-20')
  assert.equal(weekOf(at('2026-11-22T23:59:59+08:00')).F, '2026-11-20')
})

test('a week that crosses a month or year boundary keeps Monday to Friday together', () => {
  const week = weekOf(at('2027-01-01T10:00:00+08:00'))
  assert.equal(week.F, '2027-01-01')
  assert.equal(week.weekTitle, '周报 2027-01-01')
  assert.equal(week.windowStart, at('2026-12-28T00:00:00+08:00'))
})

test('only the last Friday of the month writes the monthly report', () => {
  assert.equal(isLastFriday('2026-11-27'), true)
  assert.equal(isLastFriday('2026-11-20'), false)
  assert.equal(isLastFriday('2026-11-06'), false)
  assert.equal(isLastFriday('2026-12-25'), true)
  assert.equal(isLastFriday('2026-12-18'), false)
  assert.equal(isLastFriday('2027-01-29'), true)
  assert.equal(isLastFriday('2027-02-26'), true)
  assert.throws(() => isLastFriday('2026-11-2'), /输入不符合约定格式/)
  assert.throws(() => isLastFriday('20261120'), /输入不符合约定格式/)
})

test('monthly title uses the month of the Friday date', () => {
  assert.equal(monthTitle('2026-11-27'), '月报 2026-11')
  assert.equal(monthTitle('2026-11-20'), '月报 2026-11')
  assert.equal(monthTitle('2026-12-04'), '月报 2026-12')
  assert.equal(monthTitle('2027-01-29'), '月报 2027-01')
  assert.throws(() => monthTitle('2026-11'), /输入不符合约定格式/)
  assert.throws(() => monthTitle(''), /输入不符合约定格式/)
})

test('next scheduled is the first Friday 10:00 strictly after now', () => {
  assert.equal(nextScheduled(at('2026-11-18T15:00:30+08:00')), at('2026-11-20T10:00:00+08:00'))
  assert.equal(nextScheduled(at('2026-11-20T09:00:00+08:00')), at('2026-11-20T10:00:00+08:00'))
  assert.equal(nextScheduled(at('2026-11-20T10:00:00.000+08:00')), at('2026-11-27T10:00:00+08:00'))
  assert.equal(nextScheduled(at('2026-11-20T10:00:00.001+08:00')), at('2026-11-27T10:00:00+08:00'))
  assert.equal(nextScheduled(at('2026-11-22T23:00:00+08:00')), at('2026-11-27T10:00:00+08:00'))
  assert.equal(nextScheduled(at('2026-11-27T10:00:00+08:00')), at('2026-12-04T10:00:00+08:00'))
})

test('catch-up targets the missed Friday 10:00 until the following Monday 10:00:00.000', () => {
  const L = at('2026-11-20T10:00:00+08:00')
  assert.equal(catchUpTarget(at('2026-11-20T10:00:00.000+08:00')), L)
  assert.equal(catchUpTarget(at('2026-11-20T11:00:00+08:00')), L)
  assert.equal(catchUpTarget(at('2026-11-21T08:00:00+08:00')), L)
  assert.equal(catchUpTarget(at('2026-11-22T23:59:59.999+08:00')), L)
  assert.equal(catchUpTarget(at('2026-11-23T09:59:59.999+08:00')), L)
  assert.equal(catchUpTarget(at('2026-11-23T10:00:00.000+08:00')), null)
  assert.equal(catchUpTarget(at('2026-11-23T10:00:00.001+08:00')), null)
})

test('no catch-up before the missed Friday or after the window closes', () => {
  assert.equal(catchUpTarget(at('2026-11-19T15:00:00+08:00')), null)
  assert.equal(catchUpTarget(at('2026-11-20T09:59:59.999+08:00')), null)
})

test('early Monday still catches up the Friday of the previous week', () => {
  const target = catchUpTarget(at('2026-11-16T09:59:59.999+08:00'))
  assert.equal(target, at('2026-11-13T10:00:00+08:00'))
  assert.equal(weekOf(target).F, '2026-11-13')
  assert.equal(weekOf(target).windowStart, at('2026-11-09T00:00:00+08:00'))
  assert.equal(windowEnd(target, 'scheduled'), target)
})

test('formatShanghai renders YYYY-MM-DD HH:mm:ss in Asia/Shanghai', () => {
  assert.equal(formatShanghai(at('2026-11-20T10:00:00+08:00')), '2026-11-20 10:00:00')
  assert.equal(formatShanghai(at('2026-11-20T02:00:00Z')), '2026-11-20 10:00:00')
  assert.equal(formatShanghai(at('2026-11-19T16:30:05.500Z')), '2026-11-20 00:30:05')
  assert.equal(formatShanghai(at('2026-11-20T10:00:00.999+08:00')), '2026-11-20 10:00:00')
  assert.equal(formatShanghai(0), '1970-01-01 08:00:00')
})

test('every result follows the argument alone, never the system clock', () => {
  const week = weekOf(at('2000-01-03T10:00:00+08:00'))
  assert.equal(week.F, '2000-01-07')
  assert.equal(week.weekTitle, '周报 2000-01-07')
  assert.equal(week.windowStart, at('2000-01-03T00:00:00+08:00'))
  assert.equal(windowEnd(at('2000-01-03T10:00:00+08:00'), 'scheduled'), at('2000-01-07T10:00:00+08:00'))
})
