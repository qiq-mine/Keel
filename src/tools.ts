import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { KeelListPage } from './model.js'
import * as ops from './operations.js'
import { keelError } from './errors.js'

const WRITE_TOOLS = new Set(['keel_create_issue', 'keel_set_due_date', 'keel_set_risk', 'keel_set_status', 'keel_set_state'])

const issueSchema = {
  type: 'object' as const,
  additionalProperties: false as const,
  properties: {
    projectId: { type: 'integer' as const, required: true as const },
    projectPath: { type: 'string' as const, required: true as const },
    iid: { type: 'integer' as const, required: true as const },
    title: { type: 'string' as const, required: true as const },
    state: { type: 'string' as const, enum: ['opened', 'closed'] as const, required: true as const },
    status: { oneOf: [{ type: 'string' as const, enum: ['todo', 'doing', 'blocked', 'done'] as const }, { type: 'null' as const }] as const, required: true as const },
    statusConflict: { type: 'boolean' as const, required: true as const },
    issueType: { type: 'string' as const, required: true as const },
    confidential: { type: 'boolean' as const, required: true as const },
    dueDate: { oneOf: [{ type: 'string' as const }, { type: 'null' as const }] as const, required: true as const },
    overdue: { type: 'boolean' as const, required: true as const },
    risk: { oneOf: [{ type: 'string' as const, enum: ['low', 'medium', 'high'] as const }, { type: 'null' as const }] as const, required: true as const },
    riskConflict: { type: 'boolean' as const, required: true as const },
    milestoneTitle: { oneOf: [{ type: 'string' as const }, { type: 'null' as const }] as const, required: true as const },
    commentCount: { type: 'integer' as const, required: true as const },
    labels: {
      type: 'array' as const,
      required: true as const,
      items: {
        type: 'object' as const,
        additionalProperties: false as const,
        properties: {
          name: { type: 'string' as const, required: true as const },
          color: { oneOf: [{ type: 'string' as const }, { type: 'null' as const }] as const, required: true as const },
        },
      },
    },
    assignees: {
      type: 'array' as const,
      required: true as const,
      items: {
        type: 'object' as const,
        additionalProperties: false as const,
        properties: {
          id: { type: 'integer' as const, required: true as const },
          username: { type: 'string' as const, required: true as const },
          name: { type: 'string' as const, required: true as const },
        },
      },
    },
    webUrl: { type: 'string' as const, required: true as const },
    updatedAt: { type: 'string' as const, required: true as const },
    description: { type: 'string' as const },
  },
}

const pageSchema = {
  type: 'object' as const,
  additionalProperties: false as const,
  properties: {
    issues: { type: 'array' as const, items: issueSchema, required: true as const },
    page: { type: 'integer' as const, required: true as const },
    perPage: { type: 'integer' as const, required: true as const },
    nextPage: { oneOf: [{ type: 'integer' as const }, { type: 'null' as const }] as const, required: true as const },
    truncated: { type: 'boolean' as const, required: true as const },
  },
}

function renderJson(_args: unknown, value: unknown) {
  return [{ type: 'text' as const, text: JSON.stringify(value) }]
}

export function preExecuteDecision(exec: { name: string, arguments: unknown }):
  | { kind: 'ask', reason: string, displayReason: { zh: string, en: string } }
  | { kind: 'next' } {
  if (!WRITE_TOOLS.has(exec.name)) return { kind: 'next' }
  const args = asArgs(exec.arguments)
  const project = args.projectId === undefined ? '未知项目' : String(args.projectId)
  const iid = args.iid === undefined ? '?' : String(args.iid)
  const target = targetText(exec.name, args)
  return {
    kind: 'ask',
    reason: `${exec.name} project ${project} #${iid} -> ${target.en}`,
    displayReason: {
      zh: `Keel 将把项目 ${project}#${iid} 的${target.zh}`,
      en: `Keel will ${target.en} on project ${project}#${iid}`,
    },
  }
}

export function registerKeelTools(ctx: Context, context: () => ops.OperationContext): () => void {
  const disposers = [
    ctx.tools.register(defineTool({
      name: 'keel_list_issues',
      description: '列出 Keel 看板上的 GitLab 议题。scope 为 opened、closed、status、unscoped 或 all，默认 opened。labels 同时匹配每一个标签。风险标签只能是 risk::low、risk::medium、risk::high。状态标签只能是 status::todo、status::doing、status::blocked、status::done。',
      parameters: {
        scope: { type: 'string', enum: ['opened', 'closed', 'status', 'unscoped', 'all'], description: '列范围，默认 opened' },
        status: { type: 'string', enum: ['todo', 'doing', 'blocked', 'done'], description: 'scope=status 时的状态' },
        assigneeId: { type: 'string', description: '负责人 id，或 None 表示未指派' },
        labels: { type: 'array', items: { type: 'string' }, description: '议题必须同时带有的标签名' },
        projectId: { type: 'integer', description: '仓库的数字 project id' },
        page: { type: 'integer', description: '页码，默认 1' },
        perPage: { type: 'integer', description: '每页条数，默认 20，最大 100' },
      },
      output: { schema: pageSchema, render: renderJson },
      async execute(args) {
        const page = args.page ?? 1
        const perPage = args.perPage ?? 20
        const assigneeId = args.assigneeId === undefined
          ? undefined
          : args.assigneeId === 'None'
            ? 'None' as const
            : Number(args.assigneeId)
        if (assigneeId !== undefined && assigneeId !== 'None' && !Number.isInteger(assigneeId)) {
          throw keelError('keel/invalid-input')
        }
        return contextList(context, {
          scope: args.scope ?? 'opened',
          status: args.status,
          assigneeId,
          labels: args.labels,
          projectId: args.projectId,
          page,
          perPage,
        })
      },
    })),
    ctx.tools.register(defineTool({
      name: 'keel_list_high_risk',
      description: '列出打开的高风险议题。固定查询 state=opened 且 labels=risk::high，不接受其他筛选。带有多个风险标签且包含 risk::high 的议题会返回，并且 riskConflict 为 true。',
      parameters: {
        page: { type: 'integer', description: '页码，默认 1' },
        perPage: { type: 'integer', description: '每页条数，默认 20，最大 100' },
      },
      output: { schema: pageSchema, render: renderJson },
      execute: args => ops.listHighRisk(context(), args.page ?? 1, args.perPage ?? 20),
    })),
    ctx.tools.register(defineTool({
      name: 'keel_list_overdue',
      description: '列出 GitLab 判定为逾期的打开议题。固定查询 state=opened 且 due_date=overdue，按 due_date 升序，不接受其他筛选。',
      parameters: {
        page: { type: 'integer', description: '页码，默认 1' },
        perPage: { type: 'integer', description: '每页条数，默认 20，最大 100' },
      },
      output: { schema: pageSchema, render: renderJson },
      execute: args => ops.listOverdue(context(), args.page ?? 1, args.perPage ?? 20),
    })),
    ctx.tools.register(defineTool({
      name: 'keel_set_due_date',
      description: '设置议题截止日期。dueDate 为 YYYY-MM-DD，或空字符串表示清除。写入前需要用户批准。',
      parameters: {
        projectId: { type: 'integer', required: true },
        iid: { type: 'integer', required: true },
        dueDate: { type: 'string', required: true, description: 'YYYY-MM-DD，或空字符串' },
      },
      output: { schema: issueSchema, render: renderJson },
      execute: args => ops.setDueDate(context(), args.projectId, args.iid, args.dueDate),
    })),
    ctx.tools.register(defineTool({
      name: 'keel_set_risk',
      description: '设置议题风险。risk 只能是 low、medium、high 或 none。none 表示未评估，会去掉 risk::low、risk::medium、risk::high，不会创建 risk::none。写入前需要用户批准。',
      parameters: {
        projectId: { type: 'integer', required: true },
        iid: { type: 'integer', required: true },
        risk: { type: 'string', enum: ['low', 'medium', 'high', 'none'], required: true },
      },
      output: { schema: issueSchema, render: renderJson },
      execute: args => ops.setRisk(context(), args.projectId, args.iid, args.risk),
    })),
    ctx.tools.register(defineTool({
      name: 'keel_set_state',
      description: '关闭或重新打开议题。state 只能是 opened 或 closed，对应 GitLab state_event 的 reopen 或 close。写入前需要用户批准。',
      parameters: {
        projectId: { type: 'integer', required: true },
        iid: { type: 'integer', required: true },
        state: { type: 'string', enum: ['opened', 'closed'], required: true },
      },
      output: { schema: issueSchema, render: renderJson },
      execute: args => ops.setState(context(), args.projectId, args.iid, args.state),
    })),
    ctx.tools.register(defineTool({
      name: 'keel_list_due_this_week',
      description: '列出 GitLab 服务器时区本周到期且仍打开的议题。固定查询 state=opened 且 due_date=week，按 due_date 升序。这不是企业微信周报的上海时区周一至周五窗口。不接受其他筛选。',
      parameters: {
        page: { type: 'integer', description: '页码，默认 1' },
        perPage: { type: 'integer', description: '每页条数，默认 20，最大 100' },
      },
      output: { schema: pageSchema, render: renderJson },
      execute: args => ops.listDueThisWeek(context(), args.page ?? 1, args.perPage ?? 20),
    })),
    ctx.tools.register(defineTool({
      name: 'keel_list_unassessed',
      description: '列出未评估风险的打开议题。固定查询 state=opened 且 not[labels]=risk::low,risk::medium,risk::high。不接受其他筛选。',
      parameters: {
        page: { type: 'integer', description: '页码，默认 1' },
        perPage: { type: 'integer', description: '每页条数，默认 20，最大 100' },
      },
      output: { schema: pageSchema, render: renderJson },
      execute: args => ops.listUnassessed(context(), args.page ?? 1, args.perPage ?? 20),
    })),
    ctx.tools.register(defineTool({
      name: 'keel_get_issue',
      description: '读取单条 GitLab 议题，包含描述。',
      parameters: {
        projectId: { type: 'integer', required: true },
        iid: { type: 'integer', required: true },
      },
      output: { schema: issueSchema, render: renderJson },
      execute: args => ops.getIssue(context(), args.projectId, args.iid),
    })),
    ctx.tools.register(defineTool({
      name: 'keel_list_notes',
      description: '读取一页议题评论和系统动态。system 为 false 的是评论，为 true 的是动态。',
      parameters: {
        projectId: { type: 'integer', required: true },
        iid: { type: 'integer', required: true },
        page: { type: 'integer', description: '页码，默认 1' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false as const,
          properties: {
            notes: { type: 'array' as const, required: true as const, items: { type: 'object' as const, additionalProperties: false as const, properties: {
              id: { type: 'integer' as const, required: true as const },
              system: { type: 'boolean' as const, required: true as const },
              body: { type: 'string' as const, required: true as const },
              authorName: { type: 'string' as const, required: true as const },
              createdAt: { type: 'string' as const, required: true as const },
            } } },
            page: { type: 'integer' as const, required: true as const },
            nextPage: { oneOf: [{ type: 'integer' as const }, { type: 'null' as const }] as const, required: true as const },
            truncated: { type: 'boolean' as const, required: true as const },
          },
        },
        render: renderJson,
      },
      execute: args => ops.listNotes(context(), args.projectId, args.iid, args.page ?? 1),
    })),
    ctx.tools.register(defineTool({
      name: 'keel_create_issue',
      description: '在 GitLab 新建议题。title 必填。status 只能是 todo、doing、blocked、done，省略表示不设置状态。risk 只能是 low、medium、high，省略表示未评估，不会写入 risk::none。写入前需要用户批准。',
      parameters: {
        projectId: { type: 'integer', required: true },
        title: { type: 'string', required: true },
        assigneeId: { type: 'integer' },
        status: { type: 'string', enum: ['todo', 'doing', 'blocked', 'done'] },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        risk: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      output: { schema: issueSchema, render: renderJson },
      execute: args => ops.createIssue(context(), args),
    })),
    ctx.tools.register(defineTool({
      name: 'keel_set_status',
      description: '设置议题状态标签。status 只能是 todo、doing、blocked、done 或 none。对应 status::todo、status::doing、status::blocked、status::done。none 去掉这四个标签，不关闭议题。写入前需要用户批准。',
      parameters: {
        projectId: { type: 'integer', required: true },
        iid: { type: 'integer', required: true },
        status: { type: 'string', enum: ['todo', 'doing', 'blocked', 'done', 'none'], required: true },
      },
      output: { schema: issueSchema, render: renderJson },
      execute: args => ops.setStatus(context(), args.projectId, args.iid, args.status),
    })),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}

export function bindPreExecute(ctx: Context): () => boolean {
  return ctx.on('tools/pre-execute', (exec, next) => {
    const decision = preExecuteDecision({ name: exec.name, arguments: exec.arguments })
    if (decision.kind === 'next') return next()
    return Promise.resolve(decision)
  })
}

async function contextList(context: () => ops.OperationContext, query: Parameters<typeof ops.listIssues>[1]): Promise<KeelListPage> {
  return ops.listIssues(context(), query)
}

function asArgs(value: unknown): { projectId?: number, iid?: number, dueDate?: string, risk?: string, state?: string, status?: string, title?: string } {
  if (typeof value !== 'object' || value === null) return {}
  return value as { projectId?: number, iid?: number, dueDate?: string, risk?: string, state?: string, status?: string, title?: string }
}

function targetText(name: string, args: { dueDate?: string, risk?: string, state?: string, status?: string, title?: string }): { zh: string, en: string } {
  if (name === 'keel_set_due_date') {
    if (args.dueDate === '') return { zh: '截止日期清除', en: 'clear the due date' }
    return { zh: `截止日期设为 ${args.dueDate ?? ''}`, en: `set the due date to ${args.dueDate ?? ''}` }
  }
  if (name === 'keel_create_issue') {
    return { zh: `新建议题「${args.title ?? ''}」`, en: `create issue "${args.title ?? ''}"` }
  }
  if (name === 'keel_set_status') {
    return { zh: `状态设为${args.status ?? ''}`, en: `set status to ${args.status ?? ''}` }
  }
  if (name === 'keel_set_risk') {
    const labels = { low: '低', medium: '中', high: '高', none: '未评估' } as const
    const risk = args.risk ?? ''
    const zh = risk in labels ? labels[risk as keyof typeof labels] : risk
    return { zh: `风险设为${zh}`, en: `set risk to ${risk}` }
  }
  const state = args.state === 'closed' ? '已关闭' : '打开'
  return { zh: `状态设为${state}`, en: `set state to ${args.state ?? ''}` }
}
