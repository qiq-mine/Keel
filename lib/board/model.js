import { issueKey } from '../model.js';
export const DEFAULT_FILTER = {
    assigneeId: 'all',
    labels: [],
    projectId: 'all',
    risk: 'all',
    search: '',
    onlyMine: false,
    summary: null,
    view: 'board',
};
export const BOARD_PAGE_SIZE = 100;
export function toListQuery(filter, scope, page, perPage = BOARD_PAGE_SIZE, status, mineId) {
    const assigneeId = filter.onlyMine && mineId !== undefined
        ? mineId
        : filter.assigneeId === 'all' ? undefined : filter.assigneeId;
    return {
        scope,
        page,
        perPage,
        ...(status === undefined ? {} : { status }),
        ...(assigneeId === undefined ? {} : { assigneeId }),
        ...(filter.labels.length > 0 ? { labels: [...filter.labels] } : {}),
        ...(filter.projectId === 'all' ? {} : { projectId: filter.projectId }),
        ...(filter.risk === 'all' ? {} : { risk: filter.risk }),
        ...(filter.search.trim() === '' ? {} : { search: filter.search.trim() }),
        ...(filter.summary === null ? {} : { summary: filter.summary }),
    };
}
export function beginSave(cards, key, field, attempted) {
    return cards.map(card => issueKey(card.issue) === key
        ? { issue: card.issue, pending: { field, attempted, previous: card.issue } }
        : card);
}
export function finishSave(cards, key, result) {
    return cards.map(card => {
        if (issueKey(card.issue) !== key)
            return card;
        const field = card.pending?.field;
        const issue = field === 'risk' || field === 'status'
            ? { ...result, overdue: card.pending?.previous.overdue ?? card.issue.overdue }
            : result;
        return { issue };
    });
}
export function failSave(cards, key, message) {
    return cards.map(card => {
        if (issueKey(card.issue) !== key || card.pending === undefined)
            return card;
        return {
            issue: card.pending.previous,
            error: { field: card.pending.field, attempted: card.pending.attempted, message },
        };
    });
}
export function mergeColumn(previous, incoming) {
    const incomingKeys = new Set(incoming.map(issueKey));
    const merged = incoming.map(issue => {
        const prior = previous.find(card => issueKey(card.issue) === issueKey(issue));
        if (prior?.pending !== undefined)
            return prior;
        return { issue };
    });
    const held = previous.filter(card => card.pending !== undefined && !incomingKeys.has(issueKey(card.issue)));
    return [...merged, ...held];
}
export function shouldMove(from, to) {
    return from !== to;
}
export function droppedIssue(opened, closed, key, target) {
    const card = [...opened, ...closed].find(item => issueKey(item.issue) === key);
    if (card === undefined || !shouldMove(card.issue.state, target))
        return null;
    return card.issue;
}
export function cardStatus(card) {
    return card.pending === undefined ? 'idle' : 'saving';
}
