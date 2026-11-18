const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
// 同一项目里事件读取最多 4 个并发（第二阶段设计第 5 节）。
const EVENT_CONCURRENCY = 4;
function pad(value, width) {
    return String(value).padStart(width, '0');
}
// GitLab 查询参数用 ISO 8601 带 +08:00 偏移，例如 2026-11-16T00:00:00.000+08:00。
export function isoShanghai(instant) {
    const date = new Date(instant + SHANGHAI_OFFSET_MS);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`
        + `T${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}`
        + `.${pad(date.getUTCMilliseconds(), 3)}+08:00`;
}
export async function collectReport(source, input) {
    const { projectId, columnMode, windowStart, windowEnd, runAt } = input;
    // 窗口是闭区间，比较的是绝对时刻（主设计第 7 节）。
    const inWindow = (value) => {
        const at = Date.parse(value);
        return !Number.isNaN(at) && at >= windowStart && at <= windowEnd;
    };
    const created = await source.reportIssues(projectId, {
        state: 'all',
        created_after: isoShanghai(windowStart),
        created_before: isoShanghai(windowEnd),
    });
    const closed = await source.reportIssues(projectId, {
        state: 'closed',
        updated_after: isoShanghai(windowStart),
        updated_before: isoShanghai(runAt),
    });
    const overdue = await source.reportIssues(projectId, { state: 'opened', due_date: 'overdue' });
    const changed = await source.reportIssues(projectId, {
        state: 'all',
        updated_after: isoShanghai(windowStart),
        updated_before: isoShanghai(runAt),
    });
    let eventsTruncated = false;
    const gathered = await pooled(byIid(changed.issues), EVENT_CONCURRENCY, async (issue) => {
        const result = await source.labelEvents(projectId, issue.iid);
        if (result.truncated)
            eventsTruncated = true;
        const kept = [];
        for (const event of result.events) {
            if (event.labelName !== 'risk::high')
                continue;
            if (event.action !== 'add' && event.action !== 'remove')
                continue;
            if (!inWindow(event.createdAt))
                continue;
            kept.push({ issue, at: event.createdAt, action: event.action });
        }
        return kept;
    });
    const events = gathered.flat().sort((a, b) => {
        const byIssue = a.issue.iid - b.issue.iid;
        return byIssue !== 0 ? byIssue : Date.parse(a.at) - Date.parse(b.at);
    });
    const doing = columnMode === 'status'
        ? await source.reportIssues(projectId, { state: 'opened', labels: 'status::doing' })
        : null;
    const blocked = columnMode === 'status'
        ? await source.reportIssues(projectId, { state: 'opened', labels: 'status::blocked' })
        : null;
    const highRiskNow = await source.reportIssues(projectId, { state: 'opened', labels: 'risk::high' });
    return {
        projectId,
        projectPath: input.projectPath,
        columnMode,
        weekTitle: input.weekTitle,
        windowStart,
        windowEnd,
        generatedAt: runAt,
        created: {
            issues: byIid(created.issues.filter(issue => inWindow(issue.createdAt))),
            truncated: created.truncated,
        },
        closed: {
            issues: byIid(closed.issues.filter(issue => issue.closedAt !== null && inWindow(issue.closedAt))),
            truncated: closed.truncated,
        },
        overdue: { issues: byIid(overdue.issues), truncated: overdue.truncated },
        highRisk: { events, truncated: changed.truncated || eventsTruncated },
        doing: doing === null ? null : { issues: byIid(doing.issues), truncated: doing.truncated },
        blocked: blocked === null ? null : { issues: byIid(blocked.issues), truncated: blocked.truncated },
        highRiskNow: { issues: byIid(highRiskNow.issues), truncated: highRiskNow.truncated },
    };
}
function byIid(issues) {
    return [...issues].sort((a, b) => a.iid - b.iid);
}
// 小并发池：最多 limit 个 worker 同时跑，结果按输入顺序返回。
async function pooled(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runner = async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await worker(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runner()));
    return results;
}
