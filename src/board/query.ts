import type { KeelListQuery } from '../model.js'
import { RISK_LABELS } from '../risk.js'
import { STATUS_LABELS } from '../status.js'

const STATUS_NOT = [STATUS_LABELS.todo, STATUS_LABELS.doing, STATUS_LABELS.blocked, STATUS_LABELS.done].join(',')
const RISK_NOT = [RISK_LABELS.low, RISK_LABELS.medium, RISK_LABELS.high].join(',')

export interface GitLabIssueParams {
  state?: string
  labels?: string
  'not[labels]'?: string
  due_date?: string
  search?: string
  in?: string
  assignee_id?: number | 'None'
  order_by: 'updated_at' | 'due_date'
  sort: 'asc' | 'desc'
  with_labels_details: 'true'
  per_page: number
  page: number
}

export function issueParams(
  query: KeelListQuery,
  order: { orderBy: 'updated_at' | 'due_date', sort: 'asc' | 'desc' } = { orderBy: 'updated_at', sort: 'desc' },
): GitLabIssueParams {
  const labels = [...(query.labels ?? [])]
  const excluded: string[] = []
  const params: GitLabIssueParams = {
    order_by: order.orderBy,
    sort: order.sort,
    with_labels_details: 'true',
    per_page: query.perPage,
    page: query.page,
  }
  if (query.scope === 'opened' || query.scope === 'closed') params.state = query.scope
  else params.state = 'all'
  if (query.scope === 'status' && query.status !== undefined) labels.push(STATUS_LABELS[query.status])
  if (query.scope === 'unscoped') excluded.push(...STATUS_NOT.split(','))
  if (query.risk === 'low' || query.risk === 'medium' || query.risk === 'high') labels.push(RISK_LABELS[query.risk])
  if (query.risk === 'none') excluded.push(...RISK_NOT.split(','))
  if (query.summary === 'overdue') {
    params.state = 'opened'
    params.due_date = 'overdue'
  } else if (query.summary === 'due_this_week') {
    params.state = 'opened'
    params.due_date = 'week'
  } else if (query.summary === 'high_risk') {
    params.state = 'opened'
    labels.push(RISK_LABELS.high)
  } else if (query.summary === 'unassessed') {
    params.state = 'opened'
    excluded.push(...RISK_NOT.split(','))
  }
  if (labels.length > 0) params.labels = unique(labels).join(',')
  const notLabels = unique(excluded)
  if (notLabels.length > 0) params['not[labels]'] = notLabels.join(',')
  const search = query.search?.trim() ?? ''
  if (search !== '') {
    params.search = search
    params.in = 'title,description'
  }
  if (query.assigneeId !== undefined) params.assignee_id = query.assigneeId
  return params
}

/** Summary counts ignore the summary chip, the risk control, and the label control. */
export function summaryQuery(query: KeelListQuery, summary: NonNullable<KeelListQuery['summary']>): KeelListQuery {
  return {
    scope: query.scope,
    status: query.status,
    assigneeId: query.assigneeId,
    search: query.search,
    projectId: query.projectId,
    page: 1,
    perPage: 1,
    summary,
  }
}

export function createIssueBody(input: {
  title: string
  assigneeId?: number
  status?: 'todo' | 'doing' | 'blocked' | 'done'
  dueDate?: string
  risk?: 'low' | 'medium' | 'high'
}): Record<string, unknown> {
  const title = input.title.trim()
  const body: Record<string, unknown> = { title }
  if (input.assigneeId !== undefined) body.assignee_ids = [input.assigneeId]
  if (input.dueDate !== undefined && input.dueDate !== '') body.due_date = input.dueDate
  const labels = [
    ...(input.status === undefined ? [] : [STATUS_LABELS[input.status]]),
    ...(input.risk === undefined ? [] : [RISK_LABELS[input.risk]]),
  ]
  if (labels.length > 0) body.labels = labels.join(',')
  return body
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
