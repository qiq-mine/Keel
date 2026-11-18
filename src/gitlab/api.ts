import {
  LABEL_CAP_MESSAGE,
  MEMBER_CAP_MESSAGE,
  PROJECT_CAP_MESSAGE,
  keelError,
} from '../errors.js'
import type { KeelIssue, KeelLabel, KeelListPage, KeelListQuery, KeelMember } from '../model.js'
import type { KeelCreateInput, KeelNote, KeelSummary } from '../model.js'
import { createIssueBody, issueParams, summaryQuery } from '../board/query.js'
import { dueDateUpdate, parseDueInput, RISK_LABELS, RISK_META, riskUpdate, stateUpdate, type RiskLevel } from '../risk.js'
import { STATUS_LABELS, STATUS_META, statusUpdate, type StatusLevel } from '../status.js'
import { GitLabHttp, nextPageOf, totalOf, type GitLabRequest } from './http.js'
import { mapIssue, mapNote } from './map.js'

const PAGE_CAP = 20
const PAGE_SIZE = 100

export interface GitLabApiOptions {
  baseUrl: string
  groupPath: string
  token: string
  allowSelfSigned?: boolean
  fetch?: typeof fetch
  log?: (line: string) => void
  sleep?: (ms: number) => Promise<void>
}

interface GitLabGroup {
  full_path?: string
  name?: string
}

interface GitLabProject {
  id?: number
  path_with_namespace?: string
}

export class GitLabApi {
  private readonly http: GitLabHttp
  private readonly groupId: string

  constructor(private readonly options: GitLabApiOptions) {
    this.http = new GitLabHttp(options)
    this.groupId = encodeURIComponent(options.groupPath)
  }

  async group(signal?: AbortSignal): Promise<{ fullPath: string, name: string }> {
    const body = await this.http.json<GitLabGroup>({ method: 'GET', path: `/groups/${this.groupId}` }, signal)
    return {
      fullPath: typeof body?.full_path === 'string' ? body.full_path : this.options.groupPath,
      name: typeof body?.name === 'string' ? body.name : this.options.groupPath,
    }
  }

  async projects(signal?: AbortSignal): Promise<Map<number, string>> {
    const rows = await this.collect<GitLabProject>({
      method: 'GET',
      path: `/groups/${this.groupId}/projects`,
      query: {
        include_subgroups: 'true',
        with_shared: 'false',
        archived: 'false',
        simple: 'true',
        per_page: PAGE_SIZE,
      },
    }, signal, PROJECT_CAP_MESSAGE, 'keel/outside-group')
    const projects = new Map<number, string>()
    for (const row of rows) {
      if (typeof row.id !== 'number' || typeof row.path_with_namespace !== 'string') continue
      projects.set(row.id, row.path_with_namespace)
    }
    return projects
  }

  async members(signal?: AbortSignal): Promise<KeelMember[]> {
    const rows = await this.collect<Record<string, unknown>>({
      method: 'GET',
      path: `/groups/${this.groupId}/members/all`,
      query: { per_page: PAGE_SIZE },
    }, signal, MEMBER_CAP_MESSAGE, 'keel/invalid-input')
    return rows.flatMap(row => {
      if (typeof row.id !== 'number' || typeof row.username !== 'string' || typeof row.name !== 'string') return []
      return [{ id: row.id, username: row.username, name: row.name }]
    })
  }

  async labels(signal?: AbortSignal): Promise<KeelLabel[]> {
    const rows = await this.collect<Record<string, unknown>>({
      method: 'GET',
      path: `/groups/${this.groupId}/labels`,
      query: { per_page: PAGE_SIZE },
    }, signal, LABEL_CAP_MESSAGE, 'keel/invalid-input')
    return rows.flatMap(row => typeof row.name === 'string'
      ? [{ name: row.name, color: typeof row.color === 'string' ? row.color : null }]
      : [])
  }

  async ensureRiskLabels(create: boolean, signal?: AbortSignal): Promise<boolean> {
    const present = await this.riskLabelNames(signal)
    const missing = (Object.keys(RISK_LABELS) as RiskLevel[]).filter(level => !present.has(RISK_LABELS[level]))
    if (missing.length === 0) return true
    if (!create) return false
    for (const level of missing) {
      const meta = RISK_META[level]
      try {
        await this.http.json({
          method: 'POST',
          path: `/groups/${this.groupId}/labels`,
          body: { name: RISK_LABELS[level], color: meta.color, description: meta.description },
        }, signal)
      } catch (error) {
        if (isCode(error, 'keel/forbidden')) return false
        const again = await this.riskLabelNames(signal)
        if (!again.has(RISK_LABELS[level])) throw error
      }
    }
    const ready = await this.riskLabelNames(signal)
    return (Object.values(RISK_LABELS)).every(name => ready.has(name))
  }

  async listIssues(
    query: KeelListQuery,
    projects: Map<number, string>,
    signal?: AbortSignal,
    order: { orderBy: 'updated_at' | 'due_date', sort: 'asc' | 'desc' } = { orderBy: 'updated_at', sort: 'desc' },
  ): Promise<KeelListPage> {
    assertPage(query.page, query.perPage)
    if (query.projectId !== undefined && !projects.has(query.projectId)) throw keelError('keel/outside-group')
    const path = query.projectId === undefined
      ? `/groups/${this.groupId}/issues`
      : `/projects/${query.projectId}/issues`
    const params = issueParams(query, order)
    const response = await this.http.send({
      method: 'GET',
      path,
      query: params as unknown as Record<string, string | number | undefined>,
    }, signal)
    const body = response.text === '' ? [] : JSON.parse(response.text) as unknown[]
    if (!Array.isArray(body)) throw keelError('keel/invalid-input')
    const nextPage = nextPageOf(response.headers)
    const overdueQuery = params.due_date === 'overdue' || query.summary === 'overdue'
    const issues = body
      .map(item => mapIssue(item, { get: id => projects.get(id) }, overdueQuery))
      .filter(issue => query.projectId !== undefined || projects.has(issue.projectId))
    return {
      issues,
      page: query.page,
      perPage: query.perPage,
      nextPage,
      truncated: query.page === PAGE_CAP && nextPage !== null,
      total: totalOf(response.headers),
    }
  }

  async currentUser(signal?: AbortSignal): Promise<{ id: number, username: string, name: string }> {
    const body = await this.http.json<Record<string, unknown>>({ method: 'GET', path: '/user' }, signal)
    if (typeof body?.id !== 'number' || typeof body.username !== 'string' || typeof body.name !== 'string') {
      throw keelError('keel/invalid-input')
    }
    return { id: body.id, username: body.username, name: body.name }
  }

  async columnModes(projectId: number | undefined, projects: Map<number, string>, signal?: AbortSignal): Promise<{
    modes: { projectId: number, columnMode: 'status' | 'state' }[]
    truncated: boolean
  }> {
    if (projectId !== undefined) {
      if (!projects.has(projectId)) throw keelError('keel/outside-group')
      const hits = await this.statusHits(projectId, signal)
      return { modes: [{ projectId, columnMode: hits }], truncated: false }
    }
    const statusProjects = new Set<number>()
    for (const label of Object.values(STATUS_LABELS)) {
      const found = await this.collectProjectIds({
        method: 'GET',
        path: `/groups/${this.groupId}/issues`,
        query: { state: 'all', labels: label, per_page: PAGE_SIZE },
      }, signal)
      if (found.truncated) return { modes: [], truncated: true }
      for (const id of found.ids) if (projects.has(id)) statusProjects.add(id)
    }
    return {
      truncated: false,
      modes: [...projects.keys()].map(id => ({
        projectId: id,
        columnMode: statusProjects.has(id) ? 'status' as const : 'state' as const,
      })),
    }
  }

  async summary(query: KeelListQuery, projects: Map<number, string>, signal?: AbortSignal): Promise<KeelSummary> {
    const [overdue, dueThisWeek, highRisk, unassessed] = await Promise.all([
      this.count(summaryQuery(query, 'overdue'), projects, signal),
      this.count(summaryQuery(query, 'due_this_week'), projects, signal),
      this.count(summaryQuery(query, 'high_risk'), projects, signal),
      this.count(summaryQuery(query, 'unassessed'), projects, signal),
    ])
    return { overdue, dueThisWeek, highRisk, unassessed }
  }

  async getIssue(projectId: number, iid: number, projects: Map<number, string>, signal?: AbortSignal): Promise<KeelIssue> {
    const issue = await this.readIssue(projectId, iid, projects, signal, true)
    return { ...issue, overdue: await this.overdue(projectId, iid, issue, signal) }
  }

  async listNotes(projectId: number, iid: number, page: number, projects: Map<number, string>, signal?: AbortSignal): Promise<{
    notes: KeelNote[]
    page: number
    nextPage: number | null
    truncated: boolean
  }> {
    if (!projects.has(projectId)) throw keelError('keel/outside-group')
    assertPage(page, PAGE_SIZE)
    const response = await this.http.send({
      method: 'GET',
      path: `/projects/${projectId}/issues/${iid}/notes`,
      query: { order_by: 'created_at', sort: 'asc', per_page: PAGE_SIZE, page },
    }, signal)
    const body = response.text === '' ? [] : JSON.parse(response.text) as unknown[]
    if (!Array.isArray(body)) throw keelError('keel/invalid-input')
    const nextPage = nextPageOf(response.headers)
    return {
      notes: body.map(mapNote),
      page,
      nextPage,
      truncated: page === PAGE_CAP && nextPage !== null,
    }
  }

  async createIssue(input: KeelCreateInput, projects: Map<number, string>, signal?: AbortSignal): Promise<KeelIssue> {
    const title = input.title.trim()
    if (title.length < 1 || title.length > 255) throw keelError('keel/invalid-input')
    if (!projects.has(input.projectId)) throw keelError('keel/outside-group')
    if (input.dueDate !== undefined) {
      try {
        parseDueInput(input.dueDate)
      } catch {
        throw keelError('keel/invalid-input')
      }
    }
    if (input.status !== undefined || input.risk !== undefined) {
      const ready = await this.ensureRiskLabels(false, signal) && await this.ensureStatusLabels(false, signal)
      if (!ready) throw keelError('keel/labels-missing')
    }
    const raw = await this.http.json({
      method: 'POST',
      path: `/projects/${input.projectId}/issues`,
      body: createIssueBody({ ...input, title }),
    }, signal)
    return mapIssue(raw, { get: id => projects.get(id) }, false, true)
  }

  async setStatus(
    projectId: number,
    iid: number,
    status: StatusLevel | 'none',
    projects: Map<number, string>,
    signal?: AbortSignal,
  ): Promise<KeelIssue> {
    const ready = await this.ensureStatusLabels(false, signal)
    if (!ready) throw keelError('keel/labels-missing')
    const current = await this.readIssue(projectId, iid, projects, signal)
    const body = statusUpdate(current.labels.map(label => label.name), status)
    if (body === null) return current
    return this.putIssue(projectId, iid, body, projects, signal)
  }

  async readIssue(projectId: number, iid: number, projects: Map<number, string>, signal?: AbortSignal, includeDescription = false): Promise<KeelIssue> {
    if (!projects.has(projectId)) throw keelError('keel/outside-group')
    const raw = await this.http.json({
      method: 'GET',
      path: `/projects/${projectId}/issues/${iid}`,
      query: { with_labels_details: 'true' },
    }, signal)
    return mapIssue(raw, { get: id => projects.get(id) }, false, includeDescription)
  }

  async setDueDate(projectId: number, iid: number, dueDate: string, projects: Map<number, string>, signal?: AbortSignal): Promise<KeelIssue> {
    let next: string
    try {
      next = parseDueInput(dueDate)
    } catch {
      throw keelError('keel/invalid-input')
    }
    const current = await this.readIssue(projectId, iid, projects, signal)
    const body = dueDateUpdate(current.dueDate, next)
    const issue = body === null ? current : await this.putIssue(projectId, iid, body, projects, signal)
    return { ...issue, overdue: await this.overdue(projectId, iid, issue, signal) }
  }

  async setRisk(
    projectId: number,
    iid: number,
    risk: RiskLevel | 'none',
    projects: Map<number, string>,
    signal?: AbortSignal,
  ): Promise<KeelIssue> {
    const ready = await this.ensureRiskLabels(false, signal)
    if (!ready) throw keelError('keel/labels-missing')
    const current = await this.readIssue(projectId, iid, projects, signal)
    const body = riskUpdate(current.labels.map(label => label.name), risk)
    if (body === null) return current
    return this.putIssue(projectId, iid, body, projects, signal)
  }

  async setState(
    projectId: number,
    iid: number,
    state: 'opened' | 'closed',
    projects: Map<number, string>,
    signal?: AbortSignal,
  ): Promise<KeelIssue> {
    const current = await this.readIssue(projectId, iid, projects, signal)
    const body = stateUpdate(current.state, state)
    const issue = body === null ? current : await this.putIssue(projectId, iid, body, projects, signal)
    return { ...issue, overdue: await this.overdue(projectId, iid, issue, signal) }
  }

  private async overdue(projectId: number, iid: number, issue: KeelIssue, signal?: AbortSignal): Promise<boolean> {
    if (issue.state !== 'opened' || issue.dueDate === null) return false
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
    }, signal)
    const body = response.text === '' ? [] : JSON.parse(response.text) as { iid?: number }[]
    return Array.isArray(body) && body.some(item => item.iid === iid)
  }

  private async putIssue(
    projectId: number,
    iid: number,
    body: Record<string, string>,
    projects: Map<number, string>,
    signal?: AbortSignal,
  ): Promise<KeelIssue> {
    const raw = await this.http.json({
      method: 'PUT',
      path: `/projects/${projectId}/issues/${iid}`,
      body,
    }, signal)
    return mapIssue(raw, { get: id => projects.get(id) }, false)
  }

  private async riskLabelNames(signal?: AbortSignal): Promise<Set<string>> {
    const rows = await this.collect<Record<string, unknown>>({
      method: 'GET',
      path: `/groups/${this.groupId}/labels`,
      query: {
        search: 'risk::',
        only_group_labels: 'true',
        include_ancestor_groups: 'false',
        include_descendant_groups: 'false',
        per_page: PAGE_SIZE,
      },
    }, signal, LABEL_CAP_MESSAGE, 'keel/labels-missing')
    return new Set(rows.flatMap(row => typeof row.name === 'string' ? [row.name] : []))
  }

  private async collect<T>(
    request: Omit<GitLabRequest, 'query'> & { query?: GitLabRequest['query'] },
    signal: AbortSignal | undefined,
    capMessage: string,
    capCode: 'keel/outside-group' | 'keel/invalid-input' | 'keel/labels-missing',
  ): Promise<T[]> {
    const items: T[] = []
    for (let page = 1; page <= PAGE_CAP; page += 1) {
      const response = await this.http.send({
        ...request,
        query: { ...request.query, page },
      }, signal)
      const body = response.text === '' ? [] : JSON.parse(response.text) as T[]
      if (!Array.isArray(body)) throw keelError('keel/invalid-input')
      items.push(...body)
      const next = nextPageOf(response.headers)
      if (next === null) return items
      if (page === PAGE_CAP) throw keelError(capCode, capMessage)
    }
    return items
  }

  async ensureStatusLabels(create: boolean, signal?: AbortSignal): Promise<boolean> {
    const present = await this.labelNames('status::', signal)
    const missing = (Object.keys(STATUS_LABELS) as StatusLevel[]).filter(level => !present.has(STATUS_LABELS[level]))
    if (missing.length === 0) return true
    if (!create) return false
    for (const level of missing) {
      const meta = STATUS_META[level]
      try {
        await this.http.json({
          method: 'POST',
          path: `/groups/${this.groupId}/labels`,
          body: { name: STATUS_LABELS[level], color: meta.color, description: meta.description },
        }, signal)
      } catch (error) {
        if (isCode(error, 'keel/forbidden')) return false
        const again = await this.labelNames('status::', signal)
        if (!again.has(STATUS_LABELS[level])) throw error
      }
    }
    const ready = await this.labelNames('status::', signal)
    return Object.values(STATUS_LABELS).every(name => ready.has(name))
  }

  private async labelNames(search: string, signal?: AbortSignal): Promise<Set<string>> {
    const rows = await this.collect<Record<string, unknown>>({
      method: 'GET',
      path: `/groups/${this.groupId}/labels`,
      query: {
        search,
        only_group_labels: 'true',
        include_ancestor_groups: 'false',
        include_descendant_groups: 'false',
        per_page: PAGE_SIZE,
      },
    }, signal, LABEL_CAP_MESSAGE, 'keel/labels-missing')
    return new Set(rows.flatMap(row => typeof row.name === 'string' ? [row.name] : []))
  }

  private async statusHits(projectId: number, signal?: AbortSignal): Promise<'status' | 'state'> {
    for (const label of Object.values(STATUS_LABELS)) {
      const response = await this.http.send({
        method: 'GET',
        path: `/projects/${projectId}/issues`,
        query: { state: 'all', labels: label, per_page: 1, page: 1 },
      }, signal)
      const body = response.text === '' ? [] : JSON.parse(response.text) as unknown[]
      if (Array.isArray(body) && body.length > 0) return 'status'
    }
    return 'state'
  }

  private async collectProjectIds(request: GitLabRequest, signal?: AbortSignal): Promise<{ ids: number[], truncated: boolean }> {
    const ids: number[] = []
    for (let page = 1; page <= PAGE_CAP; page += 1) {
      const response = await this.http.send({ ...request, query: { ...request.query, page } }, signal)
      const body = response.text === '' ? [] : JSON.parse(response.text) as { project_id?: number }[]
      if (!Array.isArray(body)) throw keelError('keel/invalid-input')
      for (const row of body) if (typeof row.project_id === 'number') ids.push(row.project_id)
      const next = nextPageOf(response.headers)
      if (next === null) return { ids, truncated: false }
      if (page === PAGE_CAP) return { ids, truncated: true }
    }
    return { ids, truncated: false }
  }

  private async count(query: KeelListQuery, projects: Map<number, string>, signal?: AbortSignal): Promise<{ count: number, complete: boolean }> {
    const first = await this.listIssues({ ...query, page: 1, perPage: 100 }, projects, signal)
    if (first.total !== null) return { count: first.total, complete: true }
    let count = first.issues.length
    let page = first
    let complete = first.nextPage === null
    while (page.nextPage !== null && page.page < PAGE_CAP) {
      page = await this.listIssues({ ...query, page: page.nextPage, perPage: 100 }, projects, signal)
      count += page.issues.length
      complete = page.nextPage === null
    }
    if (page.nextPage !== null) complete = false
    return { count, complete }
  }
}

function assertPage(page: number, perPage: number): void {
  if (!Number.isInteger(page) || page < 1 || page > PAGE_CAP) throw keelError('keel/invalid-input')
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) throw keelError('keel/invalid-input')
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
