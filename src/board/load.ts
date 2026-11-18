import type { KeelColumnMode, KeelIssue, KeelListPage, KeelListQuery, KeelSummary } from '../model.js'
import { issueKey } from '../model.js'
import { BOARD_PAGE_SIZE, toListQuery, type FilterState } from './model.js'

export interface BoardLoader {
  listIssues(query: KeelListQuery): Promise<KeelListPage>
  columnModes(projectId: number): Promise<{ modes: KeelColumnMode[], truncated: boolean }>
  summary(query: KeelListQuery): Promise<KeelSummary>
}

export interface LoadedBoard {
  modeTruncated: boolean
  opened: KeelIssue[]
  closed: KeelIssue[]
  todo: KeelIssue[]
  doing: KeelIssue[]
  blocked: KeelIssue[]
  done: KeelIssue[]
  unscoped: KeelIssue[]
  showState: boolean
  showStatus: boolean
  openedTruncated: boolean
  closedTruncated: boolean
  closedHasMore: boolean
  statusTruncated: boolean
  overduePartial: boolean
  list: KeelIssue[]
  listTruncated: boolean
  summary: KeelSummary | null
}

const MAX_PAGES = 20
const EMPTY_SUMMARY: KeelSummary = {
  overdue: { count: 0, complete: true },
  dueThisWeek: { count: 0, complete: true },
  highRisk: { count: 0, complete: true },
  unassessed: { count: 0, complete: true },
}

export async function loadBoard(api: BoardLoader, filter: FilterState, closedPages: number, mineId?: number): Promise<LoadedBoard> {
  const projectId = filter.projectId === 'all' ? 0 : filter.projectId
  const modes = await api.columnModes(projectId)
  const summary = await api.summary(toListQuery({ ...filter, summary: null, risk: 'all', labels: [] }, 'all', 1, 1, undefined, mineId))
  if (modes.truncated) return emptyBoard(true, summary)
  const statusIds = new Set(modes.modes.filter(mode => mode.columnMode === 'status').map(mode => mode.projectId))
  const stateIds = new Set(modes.modes.filter(mode => mode.columnMode === 'state').map(mode => mode.projectId))
  const showStatus = statusIds.size > 0
  const showState = stateIds.size > 0
  if (filter.view === 'list') {
    const list = await loadPages(api, filter, 'all', MAX_PAGES, undefined, mineId)
    const marked = await markOverdue(api, filter, list.issues, mineId)
    return { ...emptyBoard(false, summary), showState, showStatus, list: marked.issues, listTruncated: list.truncated, overduePartial: marked.partial }
  }
  const opened = showState ? await loadPages(api, filter, 'opened', MAX_PAGES, undefined, mineId) : { issues: [], truncated: false }
  const closed = showState ? await loadClosed(api, filter, closedPages, mineId) : { issues: [], truncated: false, hasMore: false }
  const todo = showStatus ? await loadPages(api, filter, 'status', MAX_PAGES, 'todo', mineId) : { issues: [], truncated: false }
  const doing = showStatus ? await loadPages(api, filter, 'status', MAX_PAGES, 'doing', mineId) : { issues: [], truncated: false }
  const blocked = showStatus ? await loadPages(api, filter, 'status', MAX_PAGES, 'blocked', mineId) : { issues: [], truncated: false }
  const done = showStatus ? await loadPages(api, filter, 'status', MAX_PAGES, 'done', mineId) : { issues: [], truncated: false }
  const unscopedAll = showStatus ? await loadPages(api, filter, 'unscoped', MAX_PAGES, undefined, mineId) : { issues: [], truncated: false }
  const keep = (issues: KeelIssue[], allowed: Set<number>) => filter.projectId === 'all'
    ? issues.filter(issue => allowed.has(issue.projectId))
    : issues
  const columns = {
    opened: keep(opened.issues, stateIds),
    closed: keep(closed.issues, stateIds),
    todo: keep(todo.issues, statusIds),
    doing: keep(doing.issues, statusIds),
    blocked: keep(blocked.issues, statusIds),
    done: keep(done.issues, statusIds),
    unscoped: keep(unscopedAll.issues, statusIds),
  }
  const overdue = await markOverdue(api, filter, [
    ...columns.opened, ...columns.todo, ...columns.doing, ...columns.blocked, ...columns.done, ...columns.unscoped,
  ], mineId)
  const flagged = new Set(overdue.issues.filter(issue => issue.overdue).map(issueKey))
  const apply = (issues: KeelIssue[]) => issues.map(issue => ({ ...issue, overdue: issue.state === 'opened' && flagged.has(issueKey(issue)) }))
  return {
    ...emptyBoard(false, summary),
    showState,
    showStatus,
    opened: apply(columns.opened),
    closed: columns.closed.map(issue => ({ ...issue, overdue: false })),
    todo: apply(columns.todo),
    doing: apply(columns.doing),
    blocked: apply(columns.blocked),
    done: apply(columns.done),
    unscoped: apply(columns.unscoped),
    openedTruncated: opened.truncated,
    closedTruncated: closed.truncated,
    closedHasMore: closed.hasMore,
    statusTruncated: todo.truncated || doing.truncated || blocked.truncated || done.truncated || unscopedAll.truncated,
    overduePartial: overdue.partial,
  }
}

async function loadPages(
  api: BoardLoader,
  filter: FilterState,
  scope: KeelListQuery['scope'],
  maxPages: number,
  status?: KeelListQuery['status'],
  mineId?: number,
): Promise<{ issues: KeelIssue[], truncated: boolean }> {
  const issues: KeelIssue[] = []
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await api.listIssues(toListQuery(filter, scope, page, BOARD_PAGE_SIZE, status, mineId))
    issues.push(...result.issues)
    if (result.nextPage === null) return { issues, truncated: false }
    if (result.truncated || page === maxPages) return { issues, truncated: true }
  }
  return { issues, truncated: false }
}

async function loadClosed(api: BoardLoader, filter: FilterState, pages: number, mineId?: number): Promise<{
  issues: KeelIssue[]
  truncated: boolean
  hasMore: boolean
}> {
  const issues: KeelIssue[] = []
  const limit = Math.min(Math.max(pages, 1), MAX_PAGES)
  let truncated = false
  let hasMore = false
  for (let page = 1; page <= limit; page += 1) {
    const result = await api.listIssues(toListQuery(filter, 'closed', page, BOARD_PAGE_SIZE, undefined, mineId))
    issues.push(...result.issues)
    truncated = result.truncated
    hasMore = result.nextPage !== null && !result.truncated
    if (result.nextPage === null || result.truncated) break
  }
  return { issues, truncated, hasMore }
}

async function markOverdue(api: BoardLoader, filter: FilterState, issues: KeelIssue[], mineId?: number): Promise<{
  issues: KeelIssue[]
  partial: boolean
}> {
  const markFilter: FilterState = {
    ...filter,
    summary: 'overdue',
    ...(filter.summary === 'high_risk' && filter.risk === 'all' ? { risk: 'high' as const } : {}),
    ...(filter.summary === 'unassessed' && filter.risk === 'all' ? { risk: 'none' as const } : {}),
  }
  const overdue = await loadPages(api, markFilter, 'opened', MAX_PAGES, undefined, mineId)
  const ids = new Set(overdue.issues.map(issueKey))
  return {
    partial: overdue.truncated,
    issues: issues.map(issue => ({ ...issue, overdue: issue.state === 'opened' && ids.has(issueKey(issue)) })),
  }
}

function emptyBoard(modeTruncated: boolean, summary: KeelSummary | null): LoadedBoard {
  return {
    modeTruncated,
    opened: [],
    closed: [],
    todo: [],
    doing: [],
    blocked: [],
    done: [],
    unscoped: [],
    showState: false,
    showStatus: false,
    openedTruncated: false,
    closedTruncated: false,
    closedHasMore: false,
    statusTruncated: false,
    overduePartial: false,
    list: [],
    listTruncated: false,
    summary: summary ?? EMPTY_SUMMARY,
  }
}
