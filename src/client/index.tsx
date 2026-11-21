import { useEffect, useRef, useState } from 'react'
import type { KeelConnection, KeelIssue, KeelLabel, KeelListPage, KeelListQuery, KeelMember, KeelProject, KeelRisk } from '../model.js'
import { issueKey } from '../model.js'
import { TYPERT_REMOTE } from '../remote.js'
import { loadBoard } from '../board/load.js'
import {
  beginSave,
  DEFAULT_FILTER,
  failSave,
  finishSave,
  mergeColumn,
  type CardState,
  type FilterState,
  type SaveField,
} from '../board/model.js'
import { createDebounce } from '../board/shortcuts.js'
import {
  BoardView,
  KeelIcon,
  statusOf,
  reportButtonState,
  formatLastReport,
  type ReportDialogState,
} from './view.js'
import type { ReportStatus } from '../report/run.js'

const POLL_MS = 10_000

interface RemoteResult<T> {
  ok: boolean
  value?: T
  error?: { message?: string }
}

interface KeelRemote {
  connection(signal?: AbortSignal): Promise<RemoteResult<KeelConnection>>
  setToken(value: string, signal?: AbortSignal): Promise<RemoteResult<{ configured: true }>>
  clearToken(signal?: AbortSignal): Promise<RemoteResult<{ configured: false }>>
  listMembers(signal?: AbortSignal): Promise<RemoteResult<KeelMember[]>>
  listLabels(signal?: AbortSignal): Promise<RemoteResult<KeelLabel[]>>
  listProjects(signal?: AbortSignal): Promise<RemoteResult<KeelProject[]>>
  listIssues(query: KeelListQuery, signal?: AbortSignal): Promise<RemoteResult<KeelListPage>>
  columnModes(projectId: number, signal?: AbortSignal): Promise<RemoteResult<{ modes: { projectId: number, columnMode: 'status' | 'state' }[], truncated: boolean }>>
  summary(query: KeelListQuery, signal?: AbortSignal): Promise<RemoteResult<import('../model.js').KeelSummary>>
  setWecomSecret(value: string, signal?: AbortSignal): Promise<RemoteResult<{ configured: true }>>
  setDueDate(projectId: number, iid: number, dueDate: string, signal?: AbortSignal): Promise<RemoteResult<KeelIssue>>
  setRisk(projectId: number, iid: number, risk: KeelRisk, signal?: AbortSignal): Promise<RemoteResult<KeelIssue>>
  setState(projectId: number, iid: number, state: 'opened' | 'closed', signal?: AbortSignal): Promise<RemoteResult<KeelIssue>>
  reportStart(mode: 'preview' | 'write', asOf: string, signal?: AbortSignal): Promise<RemoteResult<{ runId: string }>>
  reportStatus(runId: string, signal?: AbortSignal): Promise<RemoteResult<ReportStatus>>
}

interface SettingsRemote {
  describe(): Promise<RemoteResult<{ namespaces: { ns: string, revision: number }[] }>>
  update(ns: string, patch: Record<string, string | boolean>, revision: number | undefined): Promise<RemoteResult<unknown>>
}

interface ClientHost {
  effect(run: () => void | (() => void)): unknown
  remote: {
    $mount(contribution: unknown): Promise<() => Promise<void>>
    keel: KeelRemote
    settings: SettingsRemote
  }
  slots: {
    inject(name: string, register: () => (() => void) | void): () => void
    register(options: object, component: unknown): () => void
  }
  locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
  }
}

export const name = 'keel'
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'layout']

export function apply(ctx: ClientHost): void {
  ctx.effect(() => ctx.locale.register('keel', {
    zh: { panel: '项目看板' },
    en: { panel: 'Project board' },
  }))
  let disposeMount: (() => Promise<void>) | undefined
  let cancelled = false
  const ready = ctx.remote.$mount(TYPERT_REMOTE).then(async dispose => {
    if (cancelled) {
      await dispose()
      return
    }
    disposeMount = dispose
  })
  ctx.effect(() => () => {
    cancelled = true
    void disposeMount?.()
  })
  const remote = {
    async listIssues(query: KeelListQuery) {
      await ready
      return unwrap(await ctx.remote.keel.listIssues(query))
    },
    async columnModes(projectId: number) {
      await ready
      return unwrap(await ctx.remote.keel.columnModes(projectId))
    },
    async summary(query: KeelListQuery) {
      await ready
      return unwrap(await ctx.remote.keel.summary(query))
    },
    async saveConfig(input: { baseUrl: string, groupPath: string, token: string, allowSelfSigned: boolean, wecomCorpId: string, wecomSpaceId: string, wecomFatherId: string, wecomSecret: string }, tokenConfigured: boolean) {
      await ready
      const described = await ctx.remote.settings.describe()
      if (!described.ok) throw new Error(described.error?.message ?? '尚未配置 GitLab 连接')
      const current = described.value?.namespaces.find(item => item.ns === 'keel')
      const updated = await ctx.remote.settings.update('keel', {
        baseUrl: input.baseUrl,
        groupPath: input.groupPath,
        allowSelfSigned: input.allowSelfSigned,
        wecomCorpId: input.wecomCorpId,
        wecomSpaceId: input.wecomSpaceId,
        wecomFatherId: input.wecomFatherId,
      }, current?.revision)
      if (input.wecomSecret.trim() !== '') {
        const secret = await ctx.remote.keel.setWecomSecret(input.wecomSecret)
        if (!secret.ok) throw new Error(secret.error?.message ?? '输入不符合约定格式')
      }
      if (!updated.ok) throw new Error(updated.error?.message ?? '尚未配置 GitLab 连接')
      if (input.token.trim() !== '') {
        const saved = await ctx.remote.keel.setToken(input.token)
        if (!saved.ok) throw new Error(saved.error?.message ?? '输入不符合约定格式')
      } else if (!tokenConfigured) {
        throw new Error('尚未保存令牌')
      }
      return unwrap(await ctx.remote.keel.connection())
    },
    async clearToken() {
      await ready
      return unwrap(await ctx.remote.keel.clearToken())
    },
    async connection() {
      await ready
      return unwrap(await ctx.remote.keel.connection())
    },
    async members() {
      await ready
      return unwrap(await ctx.remote.keel.listMembers())
    },
    async labels() {
      await ready
      return unwrap(await ctx.remote.keel.listLabels())
    },
    async projects() {
      await ready
      return unwrap(await ctx.remote.keel.listProjects())
    },
    async write(field: SaveField, issue: KeelIssue, attempted: string) {
      await ready
      if (field === 'dueDate') return unwrap(await ctx.remote.keel.setDueDate(issue.projectId, issue.iid, attempted))
      if (field === 'risk') return unwrap(await ctx.remote.keel.setRisk(issue.projectId, issue.iid, attempted as KeelRisk))
      return unwrap(await ctx.remote.keel.setState(issue.projectId, issue.iid, attempted as 'opened' | 'closed'))
    },
    async reportStart(mode: 'preview' | 'write', asOf: string) {
      await ready
      return unwrap(await ctx.remote.keel.reportStart(mode, asOf))
    },
    async reportStatus(runId: string) {
      await ready
      return unwrap(await ctx.remote.keel.reportStatus(runId))
    },
  }
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: 'keel',
    order: 20,
    label: '项目看板',
  }, KeelIcon)))
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: 'keel',
  }, function KeelPanel() {
    return <BoardApp remote={remote} />
  })))
}

function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(result.error?.message ?? '无法连接 GitLab')
  }
  return result.value
}

export function BoardApp({ remote }: { remote: {
  listIssues(query: KeelListQuery): Promise<KeelListPage>
  connection(): Promise<KeelConnection>
  columnModes(projectId: number): Promise<{ modes: { projectId: number, columnMode: 'status' | 'state' }[], truncated: boolean }>
  summary(query: KeelListQuery): Promise<import('../model.js').KeelSummary>
  members(): Promise<KeelMember[]>
  labels(): Promise<KeelLabel[]>
  projects(): Promise<KeelProject[]>
  saveConfig(input: { baseUrl: string, groupPath: string, token: string, allowSelfSigned: boolean, wecomCorpId: string, wecomSpaceId: string, wecomFatherId: string, wecomSecret: string }, tokenConfigured: boolean): Promise<KeelConnection>
  clearToken(): Promise<{ configured: false }>
  write(field: SaveField, issue: KeelIssue, attempted: string): Promise<KeelIssue>
  reportStart(mode: 'preview' | 'write', asOf: string): Promise<{ runId: string }>
  reportStatus(runId: string): Promise<ReportStatus>
} }) {
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER)
  const [connection, setConnection] = useState<KeelConnection | null>(null)
  const [failed, setFailed] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [members, setMembers] = useState<KeelMember[]>([])
  const [memberError, setMemberError] = useState<string | null>(null)
  const [labels, setLabels] = useState<KeelLabel[]>([])
  const [labelError, setLabelError] = useState<string | null>(null)
  const [projects, setProjects] = useState<KeelProject[]>([])
  const [projectError, setProjectError] = useState<string | null>(null)
  const [opened, setOpened] = useState<CardState[]>([])
  const [closed, setClosed] = useState<CardState[]>([])
  const [todo, setTodo] = useState<CardState[]>([])
  const [doing, setDoing] = useState<CardState[]>([])
  const [blocked, setBlocked] = useState<CardState[]>([])
  const [done, setDone] = useState<CardState[]>([])
  const [unscoped, setUnscoped] = useState<CardState[]>([])
  const [list, setList] = useState<CardState[]>([])
  const [summary, setSummary] = useState<import('../model.js').KeelSummary | null>(null)
  const [showState, setShowState] = useState(true)
  const [showStatus, setShowStatus] = useState(false)
  const [modeTruncated, setModeTruncated] = useState(false)
  const [statusTruncated, setStatusTruncated] = useState(false)
  const [openedTruncated, setOpenedTruncated] = useState(false)
  const [closedTruncated, setClosedTruncated] = useState(false)
  const [closedHasMore, setClosedHasMore] = useState(false)
  const [overduePartial, setOverduePartial] = useState(false)
  const [closedPages, setClosedPages] = useState(1)
  const [report, setReport] = useState<ReportDialogState>({ kind: 'closed' })
  const ticketRef = useRef(0)
  const cards = useRef({ opened, closed })
  const busy = useRef(false)
  const filterRef = useRef(filter)
  const searchDebounce = useRef(createDebounce(300, (fn, ms) => {
    const handle = setTimeout(fn, ms)
    return () => clearTimeout(handle)
  }))
  const pagesRef = useRef(closedPages)
  const reportPoll = useRef<{ timer?: ReturnType<typeof setInterval>, cancelled: boolean }>({ cancelled: false })
  cards.current = { opened, closed }
  filterRef.current = filter
  pagesRef.current = closedPages

  function stopReportPoll() {
    reportPoll.current.cancelled = true
    if (reportPoll.current.timer !== undefined) {
      clearInterval(reportPoll.current.timer)
      reportPoll.current.timer = undefined
    }
  }

  useEffect(() => {
    return () => {
      stopReportPoll()
    }
  }, [])

  async function handleReport() {
    stopReportPoll()
    const pollState: { timer?: ReturnType<typeof setInterval>, cancelled: boolean } = { cancelled: false }
    reportPoll.current = pollState
    setReport({ kind: 'loading', progress: { done: 0, total: 0 } })
    try {
      const { runId } = await remote.reportStart('preview', '')
      if (pollState.cancelled) return
      pollState.timer = setInterval(async () => {
        if (pollState.cancelled) return
        try {
          const status = await remote.reportStatus(runId)
          if (pollState.cancelled) return
          if (status.state === 'queued' || status.state === 'running') {
            setReport({ kind: 'loading', progress: status.progress })
          } else if (status.state === 'done') {
            stopReportPoll()
            if (status.preview) {
              setReport({ kind: 'preview', preview: status.preview })
            } else {
              setReport({ kind: 'error', message: status.message ?? '周报生成失败' })
            }
          } else if (status.state === 'failed') {
            stopReportPoll()
            setReport({ kind: 'error', message: status.message ?? '周报生成失败' })
          }
        } catch (error) {
          if (pollState.cancelled) return
          stopReportPoll()
          setReport({ kind: 'error', message: messageOf(error) })
        }
      }, 1000)
    } catch (error) {
      if (pollState.cancelled) return
      setReport({ kind: 'error', message: messageOf(error) })
    }
  }

  async function handleReportWrite() {
    if (report.kind !== 'preview') return
    const preview = report.preview
    stopReportPoll()
    const pollState: { timer?: ReturnType<typeof setInterval>, cancelled: boolean } = { cancelled: false }
    reportPoll.current = pollState
    setReport({ kind: 'writing', preview, progress: { done: 0, total: preview.projects.length } })
    try {
      const { runId } = await remote.reportStart('write', preview.asOf)
      if (pollState.cancelled) return
      pollState.timer = setInterval(async () => {
        if (pollState.cancelled) return
        try {
          const status = await remote.reportStatus(runId)
          if (pollState.cancelled) return
          if (status.state === 'queued' || status.state === 'running') {
            setReport({ kind: 'writing', preview, progress: status.progress })
          } else if (status.state === 'done') {
            stopReportPoll()
            if (status.result) {
              setReport({ kind: 'result', preview, result: status.result })
              try {
                const updatedConnection = await remote.connection()
                setConnection(updatedConnection)
              } catch {
                // Ignore connection refresh failure
              }
            } else {
              setReport({ kind: 'error', message: status.message ?? '周报写入失败' })
            }
          } else if (status.state === 'failed') {
            stopReportPoll()
            setReport({ kind: 'error', message: status.message ?? '周报写入失败' })
          }
        } catch (error) {
          if (pollState.cancelled) return
          stopReportPoll()
          setReport({ kind: 'error', message: messageOf(error) })
        }
      }, 1000)
    } catch (error) {
      if (pollState.cancelled) return
      setReport({ kind: 'error', message: messageOf(error) })
    }
  }

  function handleReportClose() {
    if (report.kind === 'writing') return
    stopReportPoll()
    setReport({ kind: 'closed' })
  }

  async function reload(nextFilter: FilterState, pages: number, fromTimer = false) {
    if (fromTimer && busy.current) return
    const ticket = ++ticketRef.current
    busy.current = true
    setLoading(true)
    try {
      const loaded = await loadBoard(remote, nextFilter, pages)
      if (ticket !== ticketRef.current) return
      setOpened(mergeColumn(cards.current.opened, loaded.opened))
      setClosed(mergeColumn(cards.current.closed, loaded.closed))
      setTodo(loaded.todo.map(issue => ({ issue })))
      setDoing(loaded.doing.map(issue => ({ issue })))
      setBlocked(loaded.blocked.map(issue => ({ issue })))
      setDone(loaded.done.map(issue => ({ issue })))
      setUnscoped(loaded.unscoped.map(issue => ({ issue })))
      setList(loaded.list.map(issue => ({ issue })))
      setSummary(loaded.summary)
      setShowState(loaded.showState)
      setShowStatus(loaded.showStatus)
      setModeTruncated(loaded.modeTruncated)
      setStatusTruncated(loaded.statusTruncated)
      setOpenedTruncated(loaded.openedTruncated)
      setClosedTruncated(loaded.closedTruncated)
      setClosedHasMore(loaded.closedHasMore)
      setOverduePartial(loaded.overduePartial)
      setRefreshedAt(new Date())
      setFailed(false)
      setConnectionError(null)
    } catch (error) {
      if (ticket !== ticketRef.current) return
      setFailed(true)
      setConnectionError(error instanceof Error ? error.message : '无法连接 GitLab')
    } finally {
      if (ticket === ticketRef.current) {
        busy.current = false
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    const handle: { timer?: ReturnType<typeof setInterval> } = {}
    let stop = false
    void (async () => {
      try {
        const view = await remote.connection()
        if (stop) return
        setConnection(view)
        setFailed(false)
        if (!view.configured) return
        const [memberResult, labelResult, projectResult] = await Promise.allSettled([
          remote.members(),
          remote.labels(),
          remote.projects(),
        ])
        if (stop) return
        if (memberResult.status === 'fulfilled') setMembers(memberResult.value)
        else setMemberError(messageOf(memberResult.reason))
        if (labelResult.status === 'fulfilled') setLabels(labelResult.value)
        else setLabelError(messageOf(labelResult.reason))
        if (projectResult.status === 'fulfilled') setProjects(projectResult.value)
        else {
          setProjectError(messageOf(projectResult.reason))
          return
        }
        await reload(DEFAULT_FILTER, 1)
      } catch (error) {
        if (stop) return
        setFailed(true)
        setConnectionError(messageOf(error))
      }
      if (stop) return
      handle.timer = setInterval(() => {
        void reload(filterRef.current, pagesRef.current, true)
      }, POLL_MS)
    })()
    return () => {
      stop = true
      if (handle.timer !== undefined) clearInterval(handle.timer)
    }
  }, [])

  async function save(field: SaveField, issue: KeelIssue, attempted: string) {
    const key = issueKey(issue)
    const update = (column: CardState[], setter: (cards: CardState[]) => void) => setter(beginSave(column, key, field, attempted))
    if (issue.state === 'opened') update(opened, setOpened)
    else update(closed, setClosed)
    try {
      const result = await remote.write(field, issue, attempted)
      const place = (column: CardState[], state: 'opened' | 'closed') => {
        if (result.state !== state) return column.filter(card => issueKey(card.issue) !== key)
        return column.some(card => issueKey(card.issue) === key)
          ? finishSave(column, key, result)
          : [{ issue: result }, ...column]
      }
      setOpened(column => place(column, 'opened'))
      setClosed(column => place(column, 'closed'))
    } catch (error) {
      const apply = (column: CardState[]) => failSave(column, key, messageOf(error))
      setOpened(apply)
      setClosed(apply)
    }
  }

  const configured = connection?.configured === true
  return (
    <BoardView
      configured={configured}
      status={statusOf(configured, failed)}
      groupFullPath={connection?.groupFullPath ?? null}
      tokenMasked={connection?.tokenMasked ?? null}
      tokenConfigured={connection?.tokenConfigured === true}
      allowSelfSigned={connection?.allowSelfSigned === true}
      showState={showState}
      showStatus={showStatus}
      modeTruncated={modeTruncated}
      todo={todo}
      doing={doing}
      blocked={blocked}
      done={done}
      unscoped={unscoped}
      statusTruncated={statusTruncated}
      summary={summary}
      view={filter.view}
      list={list}
      helpOpen={false}
      drawer={{ kind: 'none' }}
      mineName={null}
      onSummary={() => {}}
      onView={view => setFilter(current => ({ ...current, view }))}
      onSearch={search => {
        setFilter(current => ({ ...current, search }))
        searchDebounce.current(() => { void reload({ ...filterRef.current, search }, 1) })
      }}
      onOnlyMine={onlyMine => setFilter(current => ({ ...current, onlyMine }))}
      onCreate={() => {}}
      onOpen={() => {}}
      onCloseDrawer={() => {}}
      onHelp={() => {}}
      onStatus={() => {}}
      refreshedAt={refreshedAt}
      loading={loading}
      connectionError={connectionError}
      connectError={connectError}
      filter={filter}
      members={members}
      memberError={memberError}
      labels={labels}
      labelError={labelError}
      projects={projects}
      projectError={projectError}
      opened={opened}
      closed={closed}
      openedTruncated={openedTruncated}
      closedTruncated={closedTruncated}
      closedHasMore={closedHasMore}
      overduePartial={overduePartial}
      onRefresh={() => { void reload(filter, closedPages) }}
      onFilter={next => {
        setFilter(next)
        setClosedPages(1)
        setOpened([])
        setClosed([])
        void reload(next, 1)
      }}
      onDueDate={(issue, value) => { void save('dueDate', issue, value) }}
      onRisk={(issue, risk) => { void save('risk', issue, risk) }}
      onMove={(issue, state) => { void save('state', issue, state) }}
      onRetry={issue => {
        const card = [...opened, ...closed].find(item => issueKey(item.issue) === issueKey(issue))
        if (card?.error === undefined) return
        void save(card.error.field, card.issue, card.error.attempted)
      }}
      onLoadClosed={() => {
        const pages = closedPages + 1
        setClosedPages(pages)
        void reload(filter, pages)
      }}
      onConnect={input => {
        void (async () => {
          try {
            const view = await remote.saveConfig(input, connection?.tokenConfigured === true)
            setConnection(view)
            setConnectError(null)
            setFailed(!view.configured)
          } catch (error) {
            setConnectError(messageOf(error))
          }
        })()
      }}
      onClearToken={() => {
        void (async () => {
          await remote.clearToken()
          setConnection(current => current === null ? current : { ...current, configured: false, tokenConfigured: false, tokenMasked: null })
        })()
      }}
      reportButton={reportButtonState(connection)}
      lastReportText={formatLastReport(connection?.lastReport ?? null)}
      report={report}
      onReport={() => { void handleReport() }}
      onReportWrite={() => { void handleReportWrite() }}
      onReportClose={handleReportClose}
    />
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '无法连接 GitLab'
}
