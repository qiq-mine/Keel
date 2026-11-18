import { keelError } from '../errors.js'

export type ReportRunKind = 'scheduled' | 'catch-up' | 'manual'

export interface ReportWeek {
  F: string
  weekTitle: string
  windowStart: number
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const F_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

// Asia/Shanghai 固定 UTC+8 且无夏令时，平移 8 小时后按 UTC 读日历字段。
function shifted(instant: number): Date {
  return new Date(instant + SHANGHAI_OFFSET_MS)
}

function calendarDate(instant: number): { year: number, month: number, day: number, weekday: number, time: { hour: number, minute: number, second: number } } {
  const date = shifted(instant)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    time: { hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds() },
  }
}

function fromShanghai(year: number, month: number, day: number, hour: number): number {
  return Date.UTC(year, month - 1, day, hour) - SHANGHAI_OFFSET_MS
}

function parseF(F: string): { year: number, month: number, day: number } {
  if (!F_PATTERN.test(F)) throw keelError('keel/invalid-input')
  const [year, month, day] = F.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) throw keelError('keel/invalid-input')
  return { year, month, day }
}

function formatF(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

export function weekOf(now: number): ReportWeek {
  const { year, month, day, weekday } = calendarDate(now)
  const daysSinceMonday = (weekday + 6) % 7
  const friday = new Date(Date.UTC(year, month - 1, day - daysSinceMonday + 4))
  const F = formatF(friday.getUTCFullYear(), friday.getUTCMonth() + 1, friday.getUTCDate())
  return {
    F,
    weekTitle: `周报 ${F}`,
    windowStart: fromShanghai(friday.getUTCFullYear(), friday.getUTCMonth() + 1, friday.getUTCDate() - 4, 0),
  }
}

function fridayTenOclock(F: string): number {
  const { year, month, day } = parseF(F)
  return fromShanghai(year, month, day, 10)
}

export function windowEnd(now: number, kind: ReportRunKind): number {
  const capped = fridayTenOclock(weekOf(now).F)
  return kind === 'manual' ? Math.min(now, capped) : capped
}

export function isLastFriday(F: string): boolean {
  const { year, month, day } = parseF(F)
  return new Date(Date.UTC(year, month - 1, day + 7)).getUTCMonth() !== month - 1
}

export function monthTitle(F: string): string {
  const { year, month } = parseF(F)
  return `月报 ${year}-${pad(month)}`
}

export function nextScheduled(now: number): number {
  const candidate = fridayTenOclock(weekOf(now).F)
  return candidate > now ? candidate : candidate + 7 * DAY_MS
}

// L 是不晚于 now 的最近一个周五 10:00:00.000。now 早于 L 之后那个周一的 10:00:00.000 时返回 L，否则返回 null。
export function catchUpTarget(now: number): number | null {
  const thisFriday = fridayTenOclock(weekOf(now).F)
  const L = thisFriday > now ? thisFriday - 7 * DAY_MS : thisFriday
  return now < L + 3 * DAY_MS ? L : null
}

export function formatShanghai(instant: number): string {
  const { year, month, day, time } = calendarDate(instant)
  return `${year}-${pad(month)}-${pad(day)} ${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`
}
