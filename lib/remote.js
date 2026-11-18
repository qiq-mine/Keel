import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import { z } from 'zod';
const issue = z.object({
    projectId: z.number().int(),
    projectPath: z.string(),
    iid: z.number().int(),
    title: z.string(),
    state: z.enum(['opened', 'closed']),
    issueType: z.string(),
    status: z.enum(['todo', 'doing', 'blocked', 'done']).nullable(),
    statusConflict: z.boolean(),
    confidential: z.boolean(),
    dueDate: z.string().nullable(),
    overdue: z.boolean(),
    risk: z.enum(['low', 'medium', 'high']).nullable(),
    riskConflict: z.boolean(),
    milestoneTitle: z.string().nullable(),
    commentCount: z.number().int(),
    labels: z.array(z.object({ name: z.string(), color: z.string().nullable() })),
    assignees: z.array(z.object({ id: z.number().int(), username: z.string(), name: z.string() })),
    webUrl: z.string(),
    updatedAt: z.string(),
    description: z.string().optional(),
});
const page = z.object({
    issues: z.array(issue),
    page: z.number().int(),
    perPage: z.number().int(),
    nextPage: z.number().int().nullable(),
    truncated: z.boolean(),
    total: z.number().int().nullable(),
});
const query = z.object({
    scope: z.enum(['opened', 'closed', 'status', 'unscoped', 'all']),
    status: z.enum(['todo', 'doing', 'blocked', 'done']).optional(),
    assigneeId: z.union([z.number().int(), z.literal('None')]).optional(),
    labels: z.array(z.string()).optional(),
    risk: z.enum(['low', 'medium', 'high', 'none']).optional(),
    search: z.string().optional(),
    summary: z.enum(['overdue', 'due_this_week', 'high_risk', 'unassessed']).optional(),
    projectId: z.number().int().optional(),
    page: z.number().int(),
    perPage: z.number().int(),
});
const connection = z.object({
    configured: z.boolean(),
    baseUrl: z.string(),
    groupPath: z.string(),
    groupFullPath: z.string().nullable(),
    allowSelfSigned: z.boolean(),
    tokenConfigured: z.boolean(),
    tokenMasked: z.string().nullable(),
    labelsReady: z.boolean(),
    gitlabHealth: z.enum(['unconfigured', 'ok', 'error']),
    gitlabHealthDetail: z.string().nullable(),
    wecomConfigured: z.boolean(),
    wecomCorpId: z.string(),
    wecomSpaceId: z.string(),
    wecomFatherId: z.string(),
    wecomSecretConfigured: z.boolean(),
    wecomSecretMasked: z.string().nullable(),
    wecomHealth: z.enum(['unconfigured', 'ok', 'error']),
    wecomHealthDetail: z.string().nullable(),
    lastReport: z.object({
        at: z.string(),
        written: z.number().int(),
        skipped: z.number().int(),
        failed: z.number().int(),
    }).nullable(),
});
const reportCounts = z.object({
    created: z.number().int(),
    closed: z.number().int(),
    overdue: z.number().int(),
    highRiskEvents: z.number().int(),
    doing: z.number().int().nullable(),
    blocked: z.number().int().nullable(),
    highRiskNow: z.number().int(),
});
const reportPreview = z.object({
    asOf: z.string(),
    weekTitle: z.string(),
    windowStart: z.string(),
    windowEnd: z.string(),
    generatedAt: z.string(),
    monthlyDue: z.boolean(),
    monthlyTitle: z.string().nullable(),
    projects: z.array(z.object({
        projectId: z.number().int(),
        projectPath: z.string(),
        text: z.string(),
        counts: reportCounts,
        truncated: z.boolean(),
    })),
    failed: z.array(z.object({
        projectId: z.number().int(),
        projectPath: z.string(),
        message: z.string(),
    })),
});
const reportResult = z.object({
    kind: z.enum(['manual', 'scheduled', 'catch-up']),
    weekTitle: z.string(),
    finishedAt: z.string(),
    message: z.string().nullable(),
    projects: z.array(z.object({
        projectId: z.number().int(),
        projectPath: z.string(),
        weekly: z.enum(['written', 'skipped', 'failed']),
        monthly: z.enum(['written', 'skipped', 'not-due', 'failed']),
        message: z.string().nullable(),
        docUrl: z.string().nullable(),
        counts: reportCounts.nullable(),
    })),
});
const reportStatus = z.object({
    state: z.enum(['queued', 'running', 'done', 'failed']),
    progress: z.object({
        done: z.number().int(),
        total: z.number().int(),
    }),
    preview: reportPreview.nullable(),
    result: reportResult.nullable(),
    message: z.string().nullable(),
});
function codec(name, schema) {
    return {
        mode: 'strict',
        typeSymbol: `keel.${name}`,
        create: () => schema,
    };
}
function parameter(name, schema) {
    const value = codec(name, schema);
    return {
        name,
        source: 'json',
        codec: value,
        strictCodec: value,
    };
}
function method(serviceMethod, parameters, result, resultName) {
    return {
        service: 'keel',
        invocation: { kind: 'direct' },
        parameters,
        cancellation: { parameter: 'signal' },
        result: codec(resultName, result),
    };
}
export const TYPERT_REMOTE = createTypertRemoteInfo({
    package: 'keel',
    methods: {
        'keel/connection': method('connection', [], connection, 'Connection'),
        'keel/setToken': method('setToken', [parameter('value', z.string())], z.object({ configured: z.literal(true) }), 'TokenSet'),
        'keel/clearToken': method('clearToken', [], z.object({ configured: z.literal(false) }), 'TokenCleared'),
        'keel/listMembers': method('listMembers', [], z.array(z.object({
            id: z.number().int(),
            username: z.string(),
            name: z.string(),
        })), 'Members'),
        'keel/listLabels': method('listLabels', [], z.array(z.object({
            name: z.string(),
            color: z.string().nullable(),
        })), 'Labels'),
        'keel/listProjects': method('listProjects', [], z.array(z.object({
            projectId: z.number().int(),
            projectPath: z.string(),
        })), 'Projects'),
        'keel/listIssues': method('listIssues', [parameter('query', query)], page, 'ListPage'),
        'keel/setDueDate': method('setDueDate', [
            parameter('projectId', z.number().int()),
            parameter('iid', z.number().int()),
            parameter('dueDate', z.string()),
        ], issue, 'Issue'),
        'keel/setRisk': method('setRisk', [
            parameter('projectId', z.number().int()),
            parameter('iid', z.number().int()),
            parameter('risk', z.enum(['low', 'medium', 'high', 'none'])),
        ], issue, 'Issue'),
        'keel/setState': method('setState', [
            parameter('projectId', z.number().int()),
            parameter('iid', z.number().int()),
            parameter('state', z.enum(['opened', 'closed'])),
        ], issue, 'Issue'),
        'keel/setStatus': method('setStatus', [
            parameter('projectId', z.number().int()),
            parameter('iid', z.number().int()),
            parameter('status', z.enum(['todo', 'doing', 'blocked', 'done', 'none'])),
        ], issue, 'Issue'),
        'keel/createIssue': method('createIssue', [parameter('input', z.object({
                projectId: z.number().int(),
                title: z.string(),
                assigneeId: z.number().int().optional(),
                status: z.enum(['todo', 'doing', 'blocked', 'done']).optional(),
                dueDate: z.string().optional(),
                risk: z.enum(['low', 'medium', 'high']).optional(),
            }))], issue, 'Issue'),
        'keel/columnModes': method('columnModes', [parameter('projectId', z.number().int())], z.object({
            modes: z.array(z.object({ projectId: z.number().int(), columnMode: z.enum(['status', 'state']) })),
            truncated: z.boolean(),
        }), 'ColumnModes'),
        'keel/summary': method('summary', [parameter('query', query)], z.object({
            overdue: z.object({ count: z.number().int(), complete: z.boolean() }),
            dueThisWeek: z.object({ count: z.number().int(), complete: z.boolean() }),
            highRisk: z.object({ count: z.number().int(), complete: z.boolean() }),
            unassessed: z.object({ count: z.number().int(), complete: z.boolean() }),
        }), 'Summary'),
        'keel/getIssue': method('getIssue', [
            parameter('projectId', z.number().int()),
            parameter('iid', z.number().int()),
        ], issue, 'Issue'),
        'keel/listNotes': method('listNotes', [
            parameter('projectId', z.number().int()),
            parameter('iid', z.number().int()),
            parameter('page', z.number().int()),
        ], z.object({
            notes: z.array(z.object({
                id: z.number().int(),
                system: z.boolean(),
                body: z.string(),
                authorName: z.string(),
                createdAt: z.string(),
            })),
            page: z.number().int(),
            nextPage: z.number().int().nullable(),
            truncated: z.boolean(),
        }), 'Notes'),
        'keel/setWecomSecret': method('setWecomSecret', [parameter('value', z.string())], z.object({ configured: z.literal(true) }), 'WecomSecretSet'),
        'keel/clearWecomSecret': method('clearWecomSecret', [], z.object({ configured: z.literal(false) }), 'WecomSecretCleared'),
        'keel/analyzeIssue': method('analyzeIssue', [
            parameter('projectId', z.number().int()),
            parameter('iid', z.number().int()),
            parameter('sessionId', z.string()),
            parameter('agentPreset', z.string()),
        ], z.object({ sessionId: z.string() }), 'Session'),
        'keel/reportStart': method('reportStart', [parameter('mode', z.enum(['preview', 'write'])), parameter('asOf', z.string())], z.object({ runId: z.string() }), 'ReportStarted'),
        'keel/reportStatus': method('reportStatus', [parameter('runId', z.string())], reportStatus, 'ReportStatus'),
    },
}, z);
export default TYPERT_REMOTE;
