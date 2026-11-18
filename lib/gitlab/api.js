import { LABEL_CAP_MESSAGE, MEMBER_CAP_MESSAGE, PROJECT_CAP_MESSAGE, keelError, } from '../errors.js';
import { createIssueBody, issueParams, summaryQuery } from '../board/query.js';
import { dueDateUpdate, parseDueInput, RISK_LABELS, RISK_META, riskUpdate, stateUpdate } from '../risk.js';
import { STATUS_LABELS, STATUS_META, statusUpdate } from '../status.js';
import { GitLabHttp, nextPageOf, totalOf } from './http.js';
import { mapIssue, mapNote } from './map.js';
const PAGE_CAP = 20;
const PAGE_SIZE = 100;
export class GitLabApi {
    options;
    http;
    groupId;
    constructor(options) {
        this.options = options;
        this.http = new GitLabHttp(options);
        this.groupId = encodeURIComponent(options.groupPath);
    }
    async group(signal) {
        const body = await this.http.json({ method: 'GET', path: `/groups/${this.groupId}` }, signal);
        return {
            fullPath: typeof body?.full_path === 'string' ? body.full_path : this.options.groupPath,
            name: typeof body?.name === 'string' ? body.name : this.options.groupPath,
        };
    }
    async projects(signal) {
        const rows = await this.collect({
            method: 'GET',
            path: `/groups/${this.groupId}/projects`,
            query: {
                include_subgroups: 'true',
                with_shared: 'false',
                archived: 'false',
                simple: 'true',
                per_page: PAGE_SIZE,
            },
        }, signal, PROJECT_CAP_MESSAGE, 'keel/outside-group');
        const projects = new Map();
        for (const row of rows) {
            if (typeof row.id !== 'number' || typeof row.path_with_namespace !== 'string')
                continue;
            projects.set(row.id, row.path_with_namespace);
        }
        return projects;
    }
    async members(signal) {
        const rows = await this.collect({
            method: 'GET',
            path: `/groups/${this.groupId}/members/all`,
            query: { per_page: PAGE_SIZE },
        }, signal, MEMBER_CAP_MESSAGE, 'keel/invalid-input');
        return rows.flatMap(row => {
            if (typeof row.id !== 'number' || typeof row.username !== 'string' || typeof row.name !== 'string')
                return [];
            return [{ id: row.id, username: row.username, name: row.name }];
        });
    }
    async labels(signal) {
        const rows = await this.collect({
            method: 'GET',
            path: `/groups/${this.groupId}/labels`,
            query: { per_page: PAGE_SIZE },
        }, signal, LABEL_CAP_MESSAGE, 'keel/invalid-input');
        return rows.flatMap(row => typeof row.name === 'string'
            ? [{ name: row.name, color: typeof row.color === 'string' ? row.color : null }]
            : []);
    }
    async ensureRiskLabels(create, signal) {
        const present = await this.riskLabelNames(signal);
        const missing = Object.keys(RISK_LABELS).filter(level => !present.has(RISK_LABELS[level]));
        if (missing.length === 0)
            return true;
        if (!create)
            return false;
        for (const level of missing) {
            const meta = RISK_META[level];
            try {
                await this.http.json({
                    method: 'POST',
                    path: `/groups/${this.groupId}/labels`,
                    body: { name: RISK_LABELS[level], color: meta.color, description: meta.description },
                }, signal);
            }
            catch (error) {
                if (isCode(error, 'keel/forbidden'))
                    return false;
                const again = await this.riskLabelNames(signal);
                if (!again.has(RISK_LABELS[level]))
                    throw error;
            }
        }
        const ready = await this.riskLabelNames(signal);
        return (Object.values(RISK_LABELS)).every(name => ready.has(name));
    }
    async listIssues(query, projects, signal, order = { orderBy: 'updated_at', sort: 'desc' }) {
        assertPage(query.page, query.perPage);
        if (query.projectId !== undefined && !projects.has(query.projectId))
            throw keelError('keel/outside-group');
        const path = query.projectId === undefined
            ? `/groups/${this.groupId}/issues`
            : `/projects/${query.projectId}/issues`;
        const params = issueParams(query, order);
        const response = await this.http.send({
            method: 'GET',
            path,
            query: params,
        }, signal);
        const body = response.text === '' ? [] : JSON.parse(response.text);
        if (!Array.isArray(body))
            throw keelError('keel/invalid-input');
        const nextPage = nextPageOf(response.headers);
        const overdueQuery = params.due_date === 'overdue' || query.summary === 'overdue';
        const issues = body
            .map(item => mapIssue(item, { get: id => projects.get(id) }, overdueQuery))
            .filter(issue => query.projectId !== undefined || projects.has(issue.projectId));
        return {
            issues,
            page: query.page,
            perPage: query.perPage,
            nextPage,
            truncated: query.page === PAGE_CAP && nextPage !== null,
            total: totalOf(response.headers),
        };
    }
    async currentUser(signal) {
        const body = await this.http.json({ method: 'GET', path: '/user' }, signal);
        if (typeof body?.id !== 'number' || typeof body.username !== 'string' || typeof body.name !== 'string') {
            throw keelError('keel/invalid-input');
        }
        return { id: body.id, username: body.username, name: body.name };
    }
    async columnModes(projectId, projects, signal) {
        if (projectId !== undefined) {
            if (!projects.has(projectId))
                throw keelError('keel/outside-group');
            const hits = await this.statusHits(projectId, signal);
            return { modes: [{ projectId, columnMode: hits }], truncated: false };
        }
        const statusProjects = new Set();
        for (const label of Object.values(STATUS_LABELS)) {
            const found = await this.collectProjectIds({
                method: 'GET',
                path: `/groups/${this.groupId}/issues`,
                query: { state: 'all', labels: label, per_page: PAGE_SIZE },
            }, signal);
            if (found.truncated)
                return { modes: [], truncated: true };
            for (const id of found.ids)
                if (projects.has(id))
                    statusProjects.add(id);
        }
        return {
            truncated: false,
            modes: [...projects.keys()].map(id => ({
                projectId: id,
                columnMode: statusProjects.has(id) ? 'status' : 'state',
            })),
        };
    }
    async summary(query, projects, signal) {
        const [overdue, dueThisWeek, highRisk, unassessed] = await Promise.all([
            this.count(summaryQuery(query, 'overdue'), projects, signal),
            this.count(summaryQuery(query, 'due_this_week'), projects, signal),
            this.count(summaryQuery(query, 'high_risk'), projects, signal),
            this.count(summaryQuery(query, 'unassessed'), projects, signal),
        ]);
        return { overdue, dueThisWeek, highRisk, unassessed };
    }
    async getIssue(projectId, iid, projects, signal) {
        const issue = await this.readIssue(projectId, iid, projects, signal, true);
        return { ...issue, overdue: await this.overdue(projectId, iid, issue, signal) };
    }
    async listNotes(projectId, iid, page, projects, signal) {
        if (!projects.has(projectId))
            throw keelError('keel/outside-group');
        assertPage(page, PAGE_SIZE);
        const response = await this.http.send({
            method: 'GET',
            path: `/projects/${projectId}/issues/${iid}/notes`,
            query: { order_by: 'created_at', sort: 'asc', per_page: PAGE_SIZE, page },
        }, signal);
        const body = response.text === '' ? [] : JSON.parse(response.text);
        if (!Array.isArray(body))
            throw keelError('keel/invalid-input');
        const nextPage = nextPageOf(response.headers);
        return {
            notes: body.map(mapNote),
            page,
            nextPage,
            truncated: page === PAGE_CAP && nextPage !== null,
        };
    }
    async createIssue(input, projects, signal) {
        const title = input.title.trim();
        if (title.length < 1 || title.length > 255)
            throw keelError('keel/invalid-input');
        if (!projects.has(input.projectId))
            throw keelError('keel/outside-group');
        if (input.dueDate !== undefined) {
            try {
                parseDueInput(input.dueDate);
            }
            catch {
                throw keelError('keel/invalid-input');
            }
        }
        if (input.status !== undefined || input.risk !== undefined) {
            const ready = await this.ensureRiskLabels(false, signal) && await this.ensureStatusLabels(false, signal);
            if (!ready)
                throw keelError('keel/labels-missing');
        }
        const raw = await this.http.json({
            method: 'POST',
            path: `/projects/${input.projectId}/issues`,
            body: createIssueBody({ ...input, title }),
        }, signal);
        return mapIssue(raw, { get: id => projects.get(id) }, false, true);
    }
    async setStatus(projectId, iid, status, projects, signal) {
        const ready = await this.ensureStatusLabels(false, signal);
        if (!ready)
            throw keelError('keel/labels-missing');
        const current = await this.readIssue(projectId, iid, projects, signal);
        const body = statusUpdate(current.labels.map(label => label.name), status);
        if (body === null)
            return current;
        return this.putIssue(projectId, iid, body, projects, signal);
    }
    async readIssue(projectId, iid, projects, signal, includeDescription = false) {
        if (!projects.has(projectId))
            throw keelError('keel/outside-group');
        const raw = await this.http.json({
            method: 'GET',
            path: `/projects/${projectId}/issues/${iid}`,
            query: { with_labels_details: 'true' },
        }, signal);
        return mapIssue(raw, { get: id => projects.get(id) }, false, includeDescription);
    }
    async setDueDate(projectId, iid, dueDate, projects, signal) {
        let next;
        try {
            next = parseDueInput(dueDate);
        }
        catch {
            throw keelError('keel/invalid-input');
        }
        const current = await this.readIssue(projectId, iid, projects, signal);
        const body = dueDateUpdate(current.dueDate, next);
        const issue = body === null ? current : await this.putIssue(projectId, iid, body, projects, signal);
        return { ...issue, overdue: await this.overdue(projectId, iid, issue, signal) };
    }
    async setRisk(projectId, iid, risk, projects, signal) {
        const ready = await this.ensureRiskLabels(false, signal);
        if (!ready)
            throw keelError('keel/labels-missing');
        const current = await this.readIssue(projectId, iid, projects, signal);
        const body = riskUpdate(current.labels.map(label => label.name), risk);
        if (body === null)
            return current;
        return this.putIssue(projectId, iid, body, projects, signal);
    }
    async setState(projectId, iid, state, projects, signal) {
        const current = await this.readIssue(projectId, iid, projects, signal);
        const body = stateUpdate(current.state, state);
        const issue = body === null ? current : await this.putIssue(projectId, iid, body, projects, signal);
        return { ...issue, overdue: await this.overdue(projectId, iid, issue, signal) };
    }
    async overdue(projectId, iid, issue, signal) {
        if (issue.state !== 'opened' || issue.dueDate === null)
            return false;
        const response = await this.http.send({
            method: 'GET',
            path: `/projects/${projectId}/issues`,
            query: {
                state: 'opened',
                due_date: 'overdue',
                'iids[]': iid,
                per_page: 1,
                with_labels_details: 'true',
            },
        }, signal);
        const body = response.text === '' ? [] : JSON.parse(response.text);
        return Array.isArray(body) && body.some(item => item.iid === iid);
    }
    async putIssue(projectId, iid, body, projects, signal) {
        const raw = await this.http.json({
            method: 'PUT',
            path: `/projects/${projectId}/issues/${iid}`,
            body,
        }, signal);
        return mapIssue(raw, { get: id => projects.get(id) }, false);
    }
    async riskLabelNames(signal) {
        const rows = await this.collect({
            method: 'GET',
            path: `/groups/${this.groupId}/labels`,
            query: {
                search: 'risk::',
                only_group_labels: 'true',
                include_ancestor_groups: 'false',
                include_descendant_groups: 'false',
                per_page: PAGE_SIZE,
            },
        }, signal, LABEL_CAP_MESSAGE, 'keel/labels-missing');
        return new Set(rows.flatMap(row => typeof row.name === 'string' ? [row.name] : []));
    }
    async collect(request, signal, capMessage, capCode) {
        const items = [];
        for (let page = 1; page <= PAGE_CAP; page += 1) {
            const response = await this.http.send({
                ...request,
                query: { ...request.query, page },
            }, signal);
            const body = response.text === '' ? [] : JSON.parse(response.text);
            if (!Array.isArray(body))
                throw keelError('keel/invalid-input');
            items.push(...body);
            const next = nextPageOf(response.headers);
            if (next === null)
                return items;
            if (page === PAGE_CAP)
                throw keelError(capCode, capMessage);
        }
        return items;
    }
    async ensureStatusLabels(create, signal) {
        const present = await this.labelNames('status::', signal);
        const missing = Object.keys(STATUS_LABELS).filter(level => !present.has(STATUS_LABELS[level]));
        if (missing.length === 0)
            return true;
        if (!create)
            return false;
        for (const level of missing) {
            const meta = STATUS_META[level];
            try {
                await this.http.json({
                    method: 'POST',
                    path: `/groups/${this.groupId}/labels`,
                    body: { name: STATUS_LABELS[level], color: meta.color, description: meta.description },
                }, signal);
            }
            catch (error) {
                if (isCode(error, 'keel/forbidden'))
                    return false;
                const again = await this.labelNames('status::', signal);
                if (!again.has(STATUS_LABELS[level]))
                    throw error;
            }
        }
        const ready = await this.labelNames('status::', signal);
        return Object.values(STATUS_LABELS).every(name => ready.has(name));
    }
    async labelNames(search, signal) {
        const rows = await this.collect({
            method: 'GET',
            path: `/groups/${this.groupId}/labels`,
            query: {
                search,
                only_group_labels: 'true',
                include_ancestor_groups: 'false',
                include_descendant_groups: 'false',
                per_page: PAGE_SIZE,
            },
        }, signal, LABEL_CAP_MESSAGE, 'keel/labels-missing');
        return new Set(rows.flatMap(row => typeof row.name === 'string' ? [row.name] : []));
    }
    async statusHits(projectId, signal) {
        for (const label of Object.values(STATUS_LABELS)) {
            const response = await this.http.send({
                method: 'GET',
                path: `/projects/${projectId}/issues`,
                query: { state: 'all', labels: label, per_page: 1, page: 1 },
            }, signal);
            const body = response.text === '' ? [] : JSON.parse(response.text);
            if (Array.isArray(body) && body.length > 0)
                return 'status';
        }
        return 'state';
    }
    async collectProjectIds(request, signal) {
        const ids = [];
        for (let page = 1; page <= PAGE_CAP; page += 1) {
            const response = await this.http.send({ ...request, query: { ...request.query, page } }, signal);
            const body = response.text === '' ? [] : JSON.parse(response.text);
            if (!Array.isArray(body))
                throw keelError('keel/invalid-input');
            for (const row of body)
                if (typeof row.project_id === 'number')
                    ids.push(row.project_id);
            const next = nextPageOf(response.headers);
            if (next === null)
                return { ids, truncated: false };
            if (page === PAGE_CAP)
                return { ids, truncated: true };
        }
        return { ids, truncated: false };
    }
    async count(query, projects, signal) {
        const first = await this.listIssues({ ...query, page: 1, perPage: 100 }, projects, signal);
        if (first.total !== null)
            return { count: first.total, complete: true };
        let count = first.issues.length;
        let page = first;
        let complete = first.nextPage === null;
        while (page.nextPage !== null && page.page < PAGE_CAP) {
            page = await this.listIssues({ ...query, page: page.nextPage, perPage: 100 }, projects, signal);
            count += page.issues.length;
            complete = page.nextPage === null;
        }
        if (page.nextPage !== null)
            complete = false;
        return { count, complete };
    }
}
function assertPage(page, perPage) {
    if (!Number.isInteger(page) || page < 1 || page > PAGE_CAP)
        throw keelError('keel/invalid-input');
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100)
        throw keelError('keel/invalid-input');
}
function isCode(error, code) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
