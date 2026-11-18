export interface KeelLabel {
  name: string
  color: string | null
}

export interface KeelAssignee {
  id: number
  username: string
  name: string
}

export type KeelStatus = 'todo' | 'doing' | 'blocked' | 'done'

export interface KeelIssue {
  projectId: number
  projectPath: string
  iid: number
  title: string
  state: 'opened' | 'closed'
  status: KeelStatus | null
  statusConflict: boolean
  issueType: string
  confidential: boolean
  dueDate: string | null
  overdue: boolean
  risk: 'low' | 'medium' | 'high' | null
  riskConflict: boolean
  labels: KeelLabel[]
  assignees: KeelAssignee[]
  milestoneTitle: string | null
  commentCount: number
  webUrl: string
  updatedAt: string
  description?: string
}

export interface KeelNote {
  id: number
  system: boolean
  body: string
  authorName: string
  createdAt: string
}

export interface KeelListQuery {
  scope: 'opened' | 'closed' | 'status' | 'unscoped' | 'all'
  status?: KeelStatus
  assigneeId?: number | 'None'
  labels?: string[]
  risk?: 'low' | 'medium' | 'high' | 'none'
  search?: string
  summary?: 'overdue' | 'due_this_week' | 'high_risk' | 'unassessed'
  projectId?: number
  page: number
  perPage: number
}

export interface KeelListPage {
  issues: KeelIssue[]
  page: number
  perPage: number
  nextPage: number | null
  truncated: boolean
  total: number | null
}

export interface KeelProject {
  projectId: number
  projectPath: string
}

export interface KeelMember {
  id: number
  username: string
  name: string
}

export interface KeelColumnMode {
  projectId: number
  columnMode: 'status' | 'state'
}

export interface KeelSummaryCount {
  count: number
  complete: boolean
}

export interface KeelSummary {
  overdue: KeelSummaryCount
  dueThisWeek: KeelSummaryCount
  highRisk: KeelSummaryCount
  unassessed: KeelSummaryCount
}

export interface KeelCreateInput {
  projectId: number
  title: string
  assigneeId?: number
  status?: KeelStatus
  dueDate?: string
  risk?: 'low' | 'medium' | 'high'
}

export interface KeelConnection {
  configured: boolean
  baseUrl: string
  groupPath: string
  groupFullPath: string | null
  allowSelfSigned: boolean
  tokenConfigured: boolean
  tokenMasked: string | null
  labelsReady: boolean
  gitlabHealth: 'unconfigured' | 'ok' | 'error'
  gitlabHealthDetail: string | null
  wecomConfigured: boolean
  wecomCorpId: string
  wecomSpaceId: string
  wecomFatherId: string
  wecomSecretConfigured: boolean
  wecomSecretMasked: string | null
  wecomHealth: 'unconfigured' | 'ok' | 'error'
  wecomHealthDetail: string | null
  lastReport: { at: string, written: number, skipped: number, failed: number } | null
}

export type KeelRisk = 'low' | 'medium' | 'high' | 'none'

export function issueKey(issue: Pick<KeelIssue, 'projectId' | 'iid'>): string {
  return `${issue.projectId}:${issue.iid}`
}
