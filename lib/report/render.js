import { formatShanghai } from './clock.js';
const UNASSIGNED = '未分配';
const MAX_LISTED = 100;
const TITLE_LIMIT = 120;
const TRUNCATED_NOTE = '（本段已截断，只统计了接口返回的前 2000 条）';
export function countsOf(data) {
    return {
        created: data.created.issues.length,
        closed: data.closed.issues.length,
        overdue: data.overdue.issues.length,
        highRiskEvents: data.highRisk.events.length,
        doing: data.doing === null ? null : data.doing.issues.length,
        blocked: data.blocked === null ? null : data.blocked.issues.length,
        highRiskNow: data.highRiskNow.issues.length,
    };
}
// 比较两节正文是否相同时用：忽略「生成于：」一行。
export function comparableText(text) {
    return text
        .split('\n')
        .filter(line => !line.startsWith('生成于：'))
        .join('\n')
        .replace(/\n$/, '');
}
// 列表行里的标题：换行改成一个空格、去首尾空白；按码点超过 120 个时取前 120 个再加 …。
export function normalizeTitle(title) {
    const flat = title.replace(/\r\n?|\n/g, ' ').trim();
    const chars = Array.from(flat);
    return chars.length > TITLE_LIMIT ? `${chars.slice(0, TITLE_LIMIT).join('')}…` : flat;
}
function issueLine(data, issue) {
    const head = `- ${data.projectPath}#${issue.iid} ${normalizeTitle(issue.title)}`;
    return issue.webUrl === null ? head : `${head} ${issue.webUrl}`;
}
function segmentLines(title, segment, data) {
    const lines = [title];
    if (segment?.truncated)
        lines.push(TRUNCATED_NOTE);
    const issues = (segment?.issues ?? []).filter(issue => !issue.confidential);
    if (issues.length === 0) {
        lines.push('（无）');
    }
    else {
        for (const issue of issues.slice(0, MAX_LISTED))
            lines.push(issueLine(data, issue));
        if (issues.length > MAX_LISTED)
            lines.push(`（另有 ${issues.length - MAX_LISTED} 条未列出）`);
    }
    return lines;
}
function highRiskLines(data) {
    const lines = ['高风险变动'];
    if (data.highRisk.truncated)
        lines.push(TRUNCATED_NOTE);
    // 上限按「议题」计：同一议题的多条事件合并在一行议题下，事件行跟着议题一起列出。
    const groups = new Map();
    for (const event of data.highRisk.events) {
        if (event.issue.confidential === true)
            continue;
        let group = groups.get(event.issue.iid);
        if (group === undefined) {
            group = { issue: event.issue, events: [] };
            groups.set(event.issue.iid, group);
        }
        group.events.push(event);
    }
    const listed = [...groups.values()];
    if (listed.length === 0) {
        lines.push('（无）');
    }
    else {
        for (const group of listed.slice(0, MAX_LISTED)) {
            lines.push(issueLine(data, group.issue));
            for (const event of group.events) {
                const verb = event.action === 'add' ? '加上' : '去掉';
                lines.push(`  ${formatShanghai(Date.parse(event.at))} ${verb} risk::high`);
            }
        }
        if (listed.length > MAX_LISTED)
            lines.push(`（另有 ${listed.length - MAX_LISTED} 条未列出）`);
    }
    return lines;
}
function emptyTally() {
    return { created: 0, closed: 0, overdue: 0, doing: 0, blocked: 0, highRisk: 0 };
}
function tallyIssues(tallies, issues, field) {
    for (const issue of issues) {
        const names = issue.assignees.length === 0 ? [UNASSIGNED] : issue.assignees.map(assignee => assignee.name);
        for (const name of names) {
            let tally = tallies.get(name);
            if (tally === undefined) {
                tally = emptyTally();
                tallies.set(name, tally);
            }
            tally[field] += 1;
        }
    }
}
function assigneeLines(data) {
    const tallies = new Map();
    tallyIssues(tallies, data.created.issues, 'created');
    tallyIssues(tallies, data.closed.issues, 'closed');
    tallyIssues(tallies, data.overdue.issues, 'overdue');
    if (data.doing !== null)
        tallyIssues(tallies, data.doing.issues, 'doing');
    if (data.blocked !== null)
        tallyIssues(tallies, data.blocked.issues, 'blocked');
    tallyIssues(tallies, data.highRiskNow.issues, 'highRisk');
    if (!tallies.has(UNASSIGNED))
        tallies.set(UNASSIGNED, emptyTally());
    const names = [...tallies.keys()].filter(name => name !== UNASSIGNED);
    names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    names.push(UNASSIGNED);
    const lines = ['按负责人'];
    for (const name of names) {
        const tally = tallies.get(name);
        if (tally === undefined)
            continue;
        let line = `- ${name}：新建 ${tally.created} 关闭 ${tally.closed} 逾期 ${tally.overdue}`;
        if (data.columnMode === 'status')
            line += ` 进行中 ${tally.doing} 阻塞 ${tally.blocked}`;
        line += ` 高风险 ${tally.highRisk}`;
        lines.push(line);
    }
    return lines;
}
// 这一节各段里去重后的保密议题数（按 iid）。
function omittedConfidential(data) {
    const seen = new Set();
    const segments = [data.created, data.closed, data.overdue, data.highRiskNow];
    if (data.doing !== null)
        segments.push(data.doing);
    if (data.blocked !== null)
        segments.push(data.blocked);
    for (const segment of segments) {
        for (const issue of segment.issues) {
            if (issue.confidential)
                seen.add(issue.iid);
        }
    }
    for (const event of data.highRisk.events) {
        if (event.issue.confidential)
            seen.add(event.issue.iid);
    }
    return seen.size;
}
export function renderSection(data) {
    const counts = countsOf(data);
    const lines = [
        data.weekTitle,
        `窗口：${formatShanghai(data.windowStart)} 至 ${formatShanghai(data.windowEnd)}（Asia/Shanghai）`,
        `生成于：${formatShanghai(data.generatedAt)}`,
        `新建：${counts.created}`,
        `关闭：${counts.closed}`,
        `逾期：${counts.overdue}`,
        `高风险变动：${counts.highRiskEvents}`,
        '',
        ...segmentLines('新建', data.created, data),
        '',
        ...segmentLines('关闭', data.closed, data),
        '',
        ...segmentLines('逾期', data.overdue, data),
        '',
        ...highRiskLines(data),
        '',
        '当前快照',
        ...(data.columnMode === 'status'
            ? [`进行中：${counts.doing ?? 0}`, `阻塞：${counts.blocked ?? 0}`]
            : ['（该仓库未使用状态标签，不统计进行中和阻塞）']),
        `当前高风险：${counts.highRiskNow}`,
        '',
    ];
    if (data.columnMode === 'status') {
        lines.push(...segmentLines('进行中', data.doing, data), '');
        lines.push(...segmentLines('阻塞', data.blocked, data), '');
    }
    lines.push(...segmentLines('当前高风险', data.highRiskNow, data), '');
    lines.push(...assigneeLines(data), '');
    lines.push(`已省略保密议题：${omittedConfidential(data)}`);
    return lines.join('\n');
}
