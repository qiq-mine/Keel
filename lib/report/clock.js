import { keelError } from '../errors.js';
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const F_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function pad(value) {
    return String(value).padStart(2, '0');
}
// Asia/Shanghai 固定 UTC+8 且无夏令时，平移 8 小时后按 UTC 读日历字段。
function shifted(instant) {
    return new Date(instant + SHANGHAI_OFFSET_MS);
}
function calendarDate(instant) {
    const date = shifted(instant);
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        weekday: date.getUTCDay(),
        time: { hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds() },
    };
}
function fromShanghai(year, month, day, hour) {
    return Date.UTC(year, month - 1, day, hour) - SHANGHAI_OFFSET_MS;
}
function parseF(F) {
    if (!F_PATTERN.test(F))
        throw keelError('keel/invalid-input');
    const [year, month, day] = F.split('-').map(Number);
    if (year === undefined || month === undefined || day === undefined)
        throw keelError('keel/invalid-input');
    return { year, month, day };
}
function formatF(year, month, day) {
    return `${year}-${pad(month)}-${pad(day)}`;
}
export function weekOf(now) {
    const { year, month, day, weekday } = calendarDate(now);
    const daysSinceMonday = (weekday + 6) % 7;
    const friday = new Date(Date.UTC(year, month - 1, day - daysSinceMonday + 4));
    const F = formatF(friday.getUTCFullYear(), friday.getUTCMonth() + 1, friday.getUTCDate());
    return {
        F,
        weekTitle: `周报 ${F}`,
        windowStart: fromShanghai(friday.getUTCFullYear(), friday.getUTCMonth() + 1, friday.getUTCDate() - 4, 0),
    };
}
function fridayTenOclock(F) {
    const { year, month, day } = parseF(F);
    return fromShanghai(year, month, day, 10);
}
export function windowEnd(now, kind) {
    const capped = fridayTenOclock(weekOf(now).F);
    return kind === 'manual' ? Math.min(now, capped) : capped;
}
export function isLastFriday(F) {
    const { year, month, day } = parseF(F);
    return new Date(Date.UTC(year, month - 1, day + 7)).getUTCMonth() !== month - 1;
}
export function monthTitle(F) {
    const { year, month } = parseF(F);
    return `月报 ${year}-${pad(month)}`;
}
export function nextScheduled(now) {
    const candidate = fridayTenOclock(weekOf(now).F);
    return candidate > now ? candidate : candidate + 7 * DAY_MS;
}
// L 是不晚于 now 的最近一个周五 10:00:00.000。now 早于 L 之后那个周一的 10:00:00.000 时返回 L，否则返回 null。
export function catchUpTarget(now) {
    const thisFriday = fridayTenOclock(weekOf(now).F);
    const L = thisFriday > now ? thisFriday - 7 * DAY_MS : thisFriday;
    return now < L + 3 * DAY_MS ? L : null;
}
export function formatShanghai(instant) {
    const { year, month, day, time } = calendarDate(instant);
    return `${year}-${pad(month)}-${pad(day)} ${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`;
}
