import type { KeelIssue, KeelListQuery } from '../model.js'
import { issueKey } from '../model.js'

export interface FilterState {
  assigneeId: 'all' | 'None' | number
  labels: string[]
  projectId: 'all' | number
  risk: 'all' | 'low' | 'medium' | 'high' | 'none'
  search: string
  onlyMine: boolean
  summary: 'overdue' | 'due_this_week' | 'high_risk' | 'unassessed' | null
  view: 'board' | 'list'
}

export const DEFAULT_FILTER: FilterState = {
  assigneeId: 'all',
  labels: [],
  projectId: 'all',
  risk: 'all',
  search: '',
  onlyMine: false,
  summary: null,
  view: 'board',
}

export const BOARD_PAGE_SIZE = 100

export function toListQuery(
  filter: FilterState,
  scope: KeelListQuery['scope'],
  page: number,
  perPage = BOARD_PAGE_SIZE,
  status?: KeelListQuery['status'],
  mineId?: number,
): KeelListQuery {
  const assigneeId = filter.onlyMine && mineId !== undefined
    ? mineId
    : filter.assigneeId === 'all' ? undefined : filter.assigneeId
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
  }
}

export type SaveField = 'dueDate' | 'risk' | 'state' | 'status'

export interface CardState {
  issue: KeelIssue
  pending?: { field: SaveField, attempted: string, previous: KeelIssue }
  error?: { field: SaveField, attempted: string, message: string }
}

export function beginSave(cards: readonly CardState[], key: string, field: SaveField, attempted: string): CardState[] {
  return cards.map(card => issueKey(card.issue) === key
    ? { issue: card.issue, pending: { field, attempted, previous: card.issue } }
    : card)
}

export function finishSave(cards: readonly CardState[], key: string, result: KeelIssue): CardState[] {
  return cards.map(card => {
    if (issueKey(card.issue) !== key) return card
    const field = card.pending?.field
    const issue = field === 'risk' || field === 'status'
      ? { ...result, overdue: card.pending?.previous.overdue ?? card.issue.overdue }
      : result
    return { issue }
  })
}

export function failSave(cards: readonly CardState[], key: string, message: string): CardState[] {
  return cards.map(card => {
    if (issueKey(card.issue) !== key || card.pending === undefined) return card
    return {
      issue: card.pending.previous,
      error: { field: card.pending.field, attempted: card.pending.attempted, message },
    }
  })
}

export function mergeColumn(previous: readonly CardState[], incoming: readonly KeelIssue[]): CardState[] {
  const incomingKeys = new Set(incoming.map(issueKey))
  const merged = incoming.map(issue => {
    const prior = previous.find(card => issueKey(card.issue) === issueKey(issue))
    if (prior?.pending !== undefined) return prior
    return { issue }
  })
  const held = previous.filter(card => card.pending !== undefined && !incomingKeys.has(issueKey(card.issue)))
  return [...merged, ...held]
}

export function shouldMove(from: 'opened' | 'closed', to: 'opened' | 'closed'): boolean {
  return from !== to
}

export function droppedIssue(
  opened: readonly CardState[],
  closed: readonly CardState[],
  key: string,
  target: 'opened' | 'closed',
): KeelIssue | null {
  const card = [...opened, ...closed].find(item => issueKey(item.issue) === key)
  if (card === undefined || !shouldMove(card.issue.state, target)) return null
  return card.issue
}

export function cardStatus(card: CardState): 'saving' | 'idle' {
  return card.pending === undefined ? 'idle' : 'saving'
}
