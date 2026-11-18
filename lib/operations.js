import { assertConfigured, readConnection } from './config.js';
import { keelError } from './errors.js';
import { GitLabApi } from './gitlab/api.js';
import { brandString } from '@deepseek-ai/dsh-brand';
import { randomUUID } from 'node:crypto';
import { analysisMessage } from './board/analysis.js';
export async function connection(ctx, signal) {
    const settings = readConnection(ctx.config);
    const described = await ctx.describe(settings.tokenRef);
    const wecom = await ctx.describe(settings.wecomSecretRef);
    const wecomConfigured = settings.wecomCorpId !== '' && settings.wecomSpaceId !== '' && settings.wecomFatherId !== '' && wecom.configured;
    const shell = {
        baseUrl: settings.baseUrl,
        groupPath: settings.groupPath,
        allowSelfSigned: settings.allowSelfSigned,
        tokenConfigured: described.configured,
        tokenMasked: described.masked ?? null,
        wecomConfigured,
        wecomCorpId: settings.wecomCorpId,
        wecomSpaceId: settings.wecomSpaceId,
        wecomFatherId: settings.wecomFatherId,
        wecomSecretConfigured: wecom.configured,
        wecomSecretMasked: wecom.masked ?? null,
        wecomHealth: 'unconfigured',
        wecomHealthDetail: wecomConfigured ? '周报写入将在下一版提供' : null,
        lastReport: null,
    };
    if (settings.baseUrl === '' || settings.groupPath === '' || !described.configured) {
        return { ...shell, configured: false, groupFullPath: null, labelsReady: false, gitlabHealth: 'unconfigured', gitlabHealthDetail: null };
    }
    try {
        const api = await openApi(ctx);
        await api.currentUser(signal);
        const group = await api.group(signal);
        await api.projects(signal);
        const riskReady = await api.ensureRiskLabels(true, signal);
        const statusReady = await api.ensureStatusLabels(true, signal);
        return {
            ...shell,
            configured: true,
            groupFullPath: group.fullPath,
            labelsReady: riskReady && statusReady,
            gitlabHealth: 'ok',
            gitlabHealthDetail: null,
        };
    }
    catch (error) {
        return {
            ...shell,
            configured: true,
            groupFullPath: null,
            labelsReady: false,
            gitlabHealth: 'error',
            gitlabHealthDetail: error instanceof Error ? error.message : '无法连接 GitLab',
        };
    }
}
export async function setToken(ctx, value) {
    if (value.trim() === '')
        throw keelError('keel/invalid-input');
    const settings = readConnection(ctx.config);
    await ctx.set(settings.tokenRef, value);
    return { configured: true };
}
export async function clearToken(ctx) {
    const settings = readConnection(ctx.config);
    await ctx.unset(settings.tokenRef);
    return { configured: false };
}
export async function listMembers(ctx, signal) {
    const api = await openApi(ctx);
    await api.group(signal);
    return api.members(signal);
}
export async function listLabels(ctx, signal) {
    const api = await openApi(ctx);
    await api.group(signal);
    return api.labels(signal);
}
export async function listProjects(ctx, signal) {
    const api = await openApi(ctx);
    await api.group(signal);
    const projects = await api.projects(signal);
    return [...projects.entries()].map(([projectId, projectPath]) => ({ projectId, projectPath }));
}
export async function listIssues(ctx, query, signal) {
    const api = await openApi(ctx);
    await api.group(signal);
    const projects = await api.projects(signal);
    await api.ensureRiskLabels(true, signal);
    await api.ensureStatusLabels(true, signal);
    return api.listIssues(query, projects, signal);
}
export async function listHighRisk(ctx, page, perPage, signal) {
    const api = await openApi(ctx);
    await api.group(signal);
    const projects = await api.projects(signal);
    return api.listIssues({
        scope: 'opened',
        summary: 'high_risk',
        page,
        perPage,
    }, projects, signal);
}
export async function listOverdue(ctx, page, perPage, signal) {
    const api = await openApi(ctx);
    await api.group(signal);
    const projects = await api.projects(signal);
    return api.listIssues({
        scope: 'opened',
        summary: 'overdue',
        page,
        perPage,
    }, projects, signal, { orderBy: 'due_date', sort: 'asc' });
}
export async function listDueThisWeek(ctx, page, perPage, signal) {
    const api = await openApi(ctx);
    await api.group(signal);
    const projects = await api.projects(signal);
    return api.listIssues({
        scope: 'opened',
        summary: 'due_this_week',
        page,
        perPage,
    }, projects, signal, { orderBy: 'due_date', sort: 'asc' });
}
export async function listUnassessed(ctx, page, perPage, signal) {
    const api = await openApi(ctx);
    await api.group(signal);
    const projects = await api.projects(signal);
    return api.listIssues({
        scope: 'opened',
        summary: 'unassessed',
        page,
        perPage,
    }, projects, signal);
}
export async function setDueDate(ctx, projectId, iid, dueDate, signal) {
    return mutate(ctx, signal, (api, projects) => api.setDueDate(projectId, iid, dueDate, projects, signal));
}
export async function setRisk(ctx, projectId, iid, risk, signal) {
    return mutate(ctx, signal, (api, projects) => api.setRisk(projectId, iid, risk, projects, signal));
}
export async function setState(ctx, projectId, iid, state, signal) {
    return mutate(ctx, signal, (api, projects) => api.setState(projectId, iid, state, projects, signal));
}
export async function setStatus(ctx, projectId, iid, status, signal) {
    return mutate(ctx, signal, (api, projects) => api.setStatus(projectId, iid, status, projects, signal));
}
export async function createIssue(ctx, input, signal) {
    return mutate(ctx, signal, (api, projects) => api.createIssue(input, projects, signal));
}
export async function columnModes(ctx, projectId, signal) {
    const api = await openApi(ctx);
    await api.group(signal);
    const projects = await api.projects(signal);
    return api.columnModes(projectId, projects, signal);
}
export async function summary(ctx, query, signal) {
    const api = await openApi(ctx);
    await api.group(signal);
    const projects = await api.projects(signal);
    return api.summary(query, projects, signal);
}
export async function getIssue(ctx, projectId, iid, signal) {
    return mutate(ctx, signal, (api, projects) => api.getIssue(projectId, iid, projects, signal));
}
export async function listNotes(ctx, projectId, iid, page, signal) {
    const api = await openApi(ctx);
    await api.group(signal);
    const projects = await api.projects(signal);
    return api.listNotes(projectId, iid, page, projects, signal);
}
export async function setWecomSecret(ctx, value) {
    if (value.trim() === '')
        throw keelError('keel/invalid-input');
    await ctx.set(readConnection(ctx.config).wecomSecretRef, value);
    return { configured: true };
}
export async function clearWecomSecret(ctx) {
    await ctx.unset(readConnection(ctx.config).wecomSecretRef);
    return { configured: false };
}
export async function analyzeIssue(ctx, input, signal) {
    if (ctx.agents === undefined)
        throw keelError('keel/session-unavailable');
    const issue = await getIssue(ctx, input.projectId, input.iid, signal);
    const message = {
        id: brandString(randomUUID()),
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: analysisMessage(issue) }],
    };
    if (input.sessionId === '') {
        const sessionId = brandString(randomUUID());
        const handle = await ctx.agents.create({
            sessionId,
            meta: { agentPreset: input.agentPreset && input.agentPreset !== '' ? input.agentPreset : 'standard' },
        });
        handle.agent.followup(message);
        return { sessionId };
    }
    const sessionId = brandString(input.sessionId);
    const agent = ctx.agents.get(sessionId);
    if (agent === undefined)
        throw keelError('keel/session-unavailable');
    agent.followup(message);
    return { sessionId };
}
async function mutate(ctx, signal, run) {
    const api = await openApi(ctx);
    await api.group(signal);
    const projects = await api.projects(signal);
    return run(api, projects);
}
async function openApi(ctx) {
    const settings = readConnection(ctx.config);
    assertConfigured(settings);
    const token = await ctx.resolve(settings.tokenRef);
    if (token === undefined || token === '')
        throw keelError('keel/not-configured');
    return new GitLabApi({
        baseUrl: settings.baseUrl,
        groupPath: settings.groupPath,
        token,
        allowSelfSigned: settings.allowSelfSigned,
        fetch: ctx.fetch,
        log: ctx.log,
        sleep: ctx.sleep,
    });
}
