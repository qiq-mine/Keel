import { assertConfigured, readConnection } from './config.js';
import { KeelError, keelError } from './errors.js';
import { GitLabApi } from './gitlab/api.js';
import { WecomHttp } from './wecom/http.js';
import { checkAsOf, previewReport, writeReport, } from './report/run.js';
import { brandString } from '@deepseek-ai/dsh-brand';
import { randomUUID } from 'node:crypto';
import { analysisMessage } from './board/analysis.js';
export async function connection(ctx, signal) {
    const settings = readConnection(ctx.config);
    const described = await ctx.describe(settings.tokenRef);
    const wecom = await ctx.describe(settings.wecomSecretRef);
    const wecomConfigured = settings.wecomCorpId !== '' && settings.wecomSpaceId !== '' && settings.wecomFatherId !== '' && wecom.configured;
    let wecomHealth = 'unconfigured';
    let wecomHealthDetail = null;
    if (!wecomConfigured) {
        wecomHealth = 'unconfigured';
        wecomHealthDetail = null;
    }
    else {
        const c = await wecomClient(ctx);
        if (c === null) {
            wecomHealth = 'unconfigured';
            wecomHealthDetail = null;
        }
        else {
            try {
                await c.http.token();
                wecomHealth = 'ok';
                wecomHealthDetail = null;
            }
            catch (error) {
                wecomHealth = 'error';
                if (error instanceof KeelError && error.code === 'keel/wecom-unauthorized') {
                    wecomHealthDetail = '企业微信 Secret 无效或应用未授权';
                }
                else {
                    wecomHealthDetail = '无法连接企业微信';
                }
            }
        }
    }
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
        wecomHealth,
        wecomHealthDetail,
        lastReport: ctx.jobs?.lastReport() ?? null,
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
export async function wecomClient(ctx) {
    const settings = readConnection(ctx.config);
    if (settings.wecomCorpId === '' || settings.wecomSpaceId === '' || settings.wecomFatherId === '') {
        return null;
    }
    const secret = await ctx.resolve(settings.wecomSecretRef);
    if (secret === undefined || secret.trim() === '') {
        return null;
    }
    return {
        http: new WecomHttp({
            corpId: settings.wecomCorpId,
            secret,
            fetch: ctx.fetch,
            log: ctx.log,
            sleep: ctx.sleep,
        }),
        target: {
            spaceid: settings.wecomSpaceId,
            fatherid: settings.wecomFatherId,
        },
    };
}
export function reportDeps(ctx, signal) {
    let cachedApi;
    let cachedMap;
    return {
        now: () => Date.now(),
        projects: async () => {
            const api = await openApi(ctx);
            const map = await api.projects(signal);
            const modes = await api.columnModes(undefined, map, signal);
            cachedApi = api;
            cachedMap = map;
            const modeMap = new Map(modes.modes.map(m => [m.projectId, m.columnMode]));
            return [...map].map(([projectId, projectPath]) => ({
                projectId,
                projectPath,
                columnMode: modeMap.get(projectId) ?? 'state',
            }));
        },
        source: {
            reportIssues: (id, params) => {
                if (!cachedApi || !cachedMap)
                    throw keelError('keel/not-configured');
                return cachedApi.reportIssues(id, params, cachedMap, signal);
            },
            labelEvents: (id, iid) => {
                if (!cachedApi || !cachedMap)
                    throw keelError('keel/not-configured');
                return cachedApi.labelEvents(id, iid, cachedMap, signal);
            },
        },
        wecom: () => wecomClient(ctx),
    };
}
export async function reportStart(ctx, mode, asOf) {
    const jobs = ctx.jobs;
    if (!jobs)
        throw keelError('keel/not-configured');
    if (mode === 'preview') {
        const runId = jobs.start(onProgress => previewReport({ ...reportDeps(ctx), onProgress }).then(preview => ({ preview })));
        return { runId };
    }
    if (mode === 'write') {
        const at = checkAsOf(asOf, Date.now());
        const runId = jobs.start(onProgress => writeReport({ ...reportDeps(ctx), onProgress }, 'manual', at).then(result => ({ result })));
        return { runId };
    }
    throw keelError('keel/invalid-input');
}
export function reportStatus(ctx, runId) {
    if (!ctx.jobs)
        throw keelError('keel/not-found');
    return ctx.jobs.status(runId);
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
