import { keelError } from '../errors.js';
import { parseRisk } from '../risk.js';
import { parseStatus } from '../status.js';
export function mapIssue(raw, projects, overdue, includeDescription = false) {
    const issue = asRecord(raw);
    const projectId = asNumber(issue.project_id, 'project_id');
    const iid = asNumber(issue.iid, 'iid');
    const state = issue.state === 'opened' || issue.state === 'closed' ? issue.state : null;
    if (state === null)
        throw keelError('keel/invalid-input');
    const labels = mapLabels(issue.labels);
    const risk = parseRisk(labels);
    const status = parseStatus(labels);
    const reference = typeof issue.references === 'object' && issue.references !== null
        ? asRecord(issue.references).full
        : undefined;
    const fromReference = typeof reference === 'string' ? reference.split('#')[0] ?? '' : '';
    const milestone = typeof issue.milestone === 'object' && issue.milestone !== null
        ? asRecord(issue.milestone).title
        : undefined;
    const mapped = {
        projectId,
        projectPath: projects.get(projectId) || fromReference || `project/${projectId}`,
        iid,
        title: asString(issue.title, 'title'),
        state,
        status: status.status,
        statusConflict: status.statusConflict,
        issueType: typeof issue.issue_type === 'string' && issue.issue_type !== '' ? issue.issue_type : 'issue',
        confidential: issue.confidential === true,
        dueDate: typeof issue.due_date === 'string' && issue.due_date !== '' ? issue.due_date : null,
        overdue: state === 'opened' && overdue,
        risk: risk.risk,
        riskConflict: risk.riskConflict,
        labels,
        assignees: mapAssignees(issue.assignees),
        milestoneTitle: typeof milestone === 'string' && milestone !== '' ? milestone : null,
        commentCount: typeof issue.user_notes_count === 'number' ? issue.user_notes_count : 0,
        webUrl: asString(issue.web_url, 'web_url'),
        updatedAt: asString(issue.updated_at, 'updated_at'),
    };
    if (includeDescription)
        mapped.description = typeof issue.description === 'string' ? issue.description : '';
    return mapped;
}
export function mapNote(raw) {
    const note = asRecord(raw);
    const author = typeof note.author === 'object' && note.author !== null ? asRecord(note.author) : {};
    return {
        id: asNumber(note.id, 'id'),
        system: note.system === true,
        body: typeof note.body === 'string' ? note.body : '',
        authorName: typeof author.name === 'string' ? author.name : '',
        createdAt: asString(note.created_at, 'created_at'),
    };
}
function mapLabels(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap(item => {
        if (typeof item === 'string')
            return [{ name: item, color: null }];
        if (typeof item !== 'object' || item === null)
            return [];
        const record = asRecord(item);
        if (typeof record.name !== 'string')
            return [];
        return [{ name: record.name, color: typeof record.color === 'string' ? record.color : null }];
    });
}
function mapAssignees(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap(item => {
        if (typeof item !== 'object' || item === null)
            return [];
        const record = asRecord(item);
        if (typeof record.id !== 'number' || typeof record.username !== 'string' || typeof record.name !== 'string')
            return [];
        return [{ id: record.id, username: record.username, name: record.name }];
    });
}
function asRecord(value) {
    if (typeof value !== 'object' || value === null)
        throw keelError('keel/invalid-input');
    return value;
}
function asNumber(value, _field) {
    if (typeof value !== 'number' || !Number.isInteger(value))
        throw keelError('keel/invalid-input');
    return value;
}
function asString(value, _field) {
    if (typeof value !== 'string')
        throw keelError('keel/invalid-input');
    return value;
}
