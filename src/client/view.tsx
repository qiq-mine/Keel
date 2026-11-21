import { useEffect, useRef, type ReactNode, type KeyboardEvent } from 'react'
import type { KeelIssue, KeelLabel, KeelMember, KeelProject, KeelRisk } from '../model.js'
import { issueKey } from '../model.js'
import { RISK_LABELS } from '../risk.js'
import { STATUS_LABELS } from '../status.js'
import {
  CLOSED_CAP_MESSAGE,
  CLOSED_PAGE_MESSAGE,
  OPENED_CAP_MESSAGE,
  OVERDUE_PARTIAL_MESSAGE,
} from '../messages.js'
import { renderIssueMarkdown } from '../board/markdown.js'
import { assigneeInitials, formatShanghai } from '../board/people.js'
import { droppedIssue, type CardState, type FilterState } from '../board/model.js'
import type { KeelNote, KeelSummary } from '../model.js'
import type { ReportPreview, ReportResult } from '../report/run.js'

export function reportButtonState(c: { configured: boolean, gitlabHealth: 'unconfigured' | 'ok' | 'error', wecomConfigured: boolean } | null): { disabled: boolean, title: string } {
  if (c === null || !c.configured || c.gitlabHealth !== 'ok') {
    return { disabled: true, title: '尚未配置 GitLab 连接' }
  }
  if (!c.wecomConfigured) {
    return { disabled: true, title: '尚未配置企业微信' }
  }
  return { disabled: false, title: '预览并写入本周周报' }
}

export function formatLastReport(r: { at: string, written: number, skipped: number, failed: number } | null): string | null {
  if (r === null) return null
  const date = new Date(r.at)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(date)
  const find = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  const formatted = `${find('month')}-${find('day')} ${find('hour')}:${find('minute')}`
  return `上次周报：${formatted} 写入 ${r.written} 跳过 ${r.skipped} 失败 ${r.failed}`
}

export type ReportDialogState =
  | { kind: 'closed' }
  | { kind: 'loading', progress: { done: number, total: number } }
  | { kind: 'preview', preview: ReportPreview }
  | { kind: 'writing', preview: ReportPreview, progress: { done: number, total: number } }
  | { kind: 'result', preview: ReportPreview | null, result: ReportResult }
  | { kind: 'error', message: string }

export interface BoardViewProps {
  configured: boolean
  status: '已连接' | '未配置' | '连接失败'
  groupFullPath: string | null
  tokenMasked: string | null
  tokenConfigured: boolean
  allowSelfSigned: boolean
  showState: boolean
  showStatus: boolean
  modeTruncated: boolean
  todo: CardState[]
  doing: CardState[]
  blocked: CardState[]
  done: CardState[]
  unscoped: CardState[]
  statusTruncated: boolean
  summary: KeelSummary | null
  view: 'board' | 'list'
  list: CardState[]
  helpOpen: boolean
  drawer: { kind: 'none' } | { kind: 'create' } | { kind: 'issue', issue: KeelIssue, notes: KeelNote[], html: string }
  mineName: string | null
  refreshedAt: Date | null
  loading: boolean
  connectionError: string | null
  connectError: string | null
  filter: FilterState
  members: KeelMember[]
  memberError: string | null
  labels: KeelLabel[]
  labelError: string | null
  projects: KeelProject[]
  projectError: string | null
  opened: CardState[]
  closed: CardState[]
  openedTruncated: boolean
  closedTruncated: boolean
  closedHasMore: boolean
  overduePartial: boolean
  reportButton?: { disabled: boolean, title: string }
  lastReportText?: string | null
  report?: ReportDialogState
  onRefresh(): void
  onFilter(filter: FilterState): void
  onDueDate(issue: KeelIssue, value: string): void
  onRisk(issue: KeelIssue, risk: KeelRisk): void
  onMove(issue: KeelIssue, state: 'opened' | 'closed'): void
  onRetry(issue: KeelIssue): void
  onLoadClosed(): void
  onConnect(input: { baseUrl: string, groupPath: string, token: string, allowSelfSigned: boolean, wecomCorpId: string, wecomSpaceId: string, wecomFatherId: string, wecomSecret: string }): void
  onClearToken(): void
  onSummary(summary: FilterState['summary']): void
  onView(view: 'board' | 'list'): void
  onSearch(search: string): void
  onOnlyMine(value: boolean): void
  onCreate(): void
  onOpen(issue: KeelIssue): void
  onCloseDrawer(): void
  onHelp(): void
  onStatus(issue: KeelIssue, status: 'todo' | 'doing' | 'blocked' | 'done' | 'none'): void
  onReport?(): void
  onReportWrite?(): void
  onReportClose?(): void
}

const RISK_NAMES = new Set<string>(Object.values(RISK_LABELS))

const RISK_OPTIONS: { value: KeelRisk, label: string }[] = [
  { value: 'none', label: '未评估' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

export function BoardView(rawProps: BoardViewProps) {
  const props: BoardViewProps & {
    reportButton: { disabled: boolean, title: string }
    lastReportText: string | null
    report: ReportDialogState
    onReport(): void
    onReportWrite(): void
    onReportClose(): void
  } = {
    ...rawProps,
    reportButton: rawProps.reportButton ?? { disabled: true, title: '尚未配置 GitLab 连接' },
    lastReportText: rawProps.lastReportText ?? null,
    report: rawProps.report ?? { kind: 'closed' },
    onReport: rawProps.onReport ?? (() => {}),
    onReportWrite: rawProps.onReportWrite ?? (() => {}),
    onReportClose: rawProps.onReportClose ?? (() => {}),
  }
  return (
    <section className="keel-board" aria-label="项目看板">
      <style>{STYLES}</style>
      <header className="keel-title">
        <h1>项目看板</h1>
        {props.groupFullPath !== null ? <p className="keel-path">{props.groupFullPath}</p> : null}
        <p className="keel-status">{props.status}</p>
        <p className="keel-refreshed">{props.refreshedAt === null ? '尚未拉取' : formatLocal(props.refreshedAt)}</p>
        <button type="button" onClick={props.onRefresh} disabled={props.loading || !props.configured}>刷新</button>
        <button type="button" onClick={() => props.onView('board')} aria-pressed={props.view === 'board'}>看板</button>
        <button type="button" onClick={() => props.onView('list')} aria-pressed={props.view === 'list'}>列表</button>
        <button type="button" onClick={props.onCreate}>新建议题</button>
        <button
          type="button"
          disabled={props.reportButton.disabled || props.report.kind === 'loading' || props.report.kind === 'writing'}
          title={props.reportButton.title}
          onClick={props.onReport}
        >
          立即生成本周周报
        </button>
        {props.lastReportText !== null ? <span className="keel-last-report">{props.lastReportText}</span> : null}
        <button type="button" onClick={props.onHelp}>快捷键</button>
      </header>
      {props.helpOpen ? <ShortcutHelp /> : null}
      {props.connectionError !== null ? <p className="keel-error" role="alert">{props.connectionError}</p> : null}
      {props.overduePartial ? <p className="keel-banner">{OVERDUE_PARTIAL_MESSAGE}</p> : null}
      {props.modeTruncated ? <p className="keel-banner">状态标签议题超过 2000 条，无法判定列模式</p> : null}
      {props.configured ? <SummaryBar {...props} /> : null}
      {props.configured ? <Filters {...props} /> : <ConnectionForm {...props} />}
      {props.configured && props.projectError === null && !props.modeTruncated ? (
        props.view === 'list'
          ? <IssueTable {...props} />
          : (
            <div className="keel-columns">
              {props.showStatus ? (
                <>
                  <StatusColumn name="待办" column="todo" cards={props.todo} note={props.statusTruncated ? OPENED_CAP_MESSAGE : null} {...props} />
                  <StatusColumn name="进行中" column="doing" cards={props.doing} note={null} {...props} />
                  <StatusColumn name="阻塞" column="blocked" cards={props.blocked} note={null} {...props} />
                  <StatusColumn name="完成" column="done" cards={props.done} note={null} {...props} />
                  <StatusColumn name="未分状态" column="none" cards={props.unscoped} note={null} {...props} />
                </>
              ) : null}
              {props.showState ? (
                <>
                  <Column name="打开" state="opened" cards={props.opened} note={props.openedTruncated ? OPENED_CAP_MESSAGE : null} onDrop={key => dropCard(props, 'opened', key)} {...props} />
                  <Column name="已关闭" state="closed" cards={props.closed} note={props.closedTruncated ? CLOSED_CAP_MESSAGE : props.closedHasMore ? CLOSED_PAGE_MESSAGE : null} extra={props.closedHasMore && !props.closedTruncated ? <button type="button" onClick={props.onLoadClosed}>加载更早的已关闭议题</button> : null} onDrop={key => dropCard(props, 'closed', key)} {...props} />
                </>
              ) : null}
            </div>
          )
      ) : null}
      {props.drawer.kind !== 'none' ? <Drawer {...props} /> : null}
      {props.report.kind !== 'closed' ? <ReportDialog {...props} /> : null}
    </section>
  )
}

function formatLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function SummaryBar(props: BoardViewProps) {
  const items = [
    ['overdue', '逾期', props.summary?.overdue],
    ['due_this_week', '本周到期', props.summary?.dueThisWeek],
    ['high_risk', '高风险', props.summary?.highRisk],
    ['unassessed', '未评估', props.summary?.unassessed],
  ] as const
  return (
    <div className="keel-summary">
      {items.map(([id, label, count]) => (
        <button
          key={id}
          type="button"
          aria-pressed={props.filter.summary === id}
          onClick={() => props.onSummary(props.filter.summary === id ? null : id)}
        >
          {label} {count === undefined ? '…' : `${count.count}${count.complete ? '' : ' 不完整'}`}
        </button>
      ))}
    </div>
  )
}

function ShortcutHelp() {
  return (
    <aside className="keel-help" aria-label="快捷键">
      <p>c 新建议题，/ 搜索，1 到 4 设置状态，Enter 打开抽屉，Esc 关闭，方向键移动焦点。</p>
    </aside>
  )
}

function ConnectionForm(props: BoardViewProps) {
  return (
    <form
      className="keel-connect"
      data-keel="connection"
      onSubmit={event => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        props.onConnect({
          baseUrl: String(data.get('baseUrl') ?? ''),
          groupPath: String(data.get('groupPath') ?? ''),
          token: String(data.get('token') ?? ''),
          allowSelfSigned: data.get('allowSelfSigned') === 'on',
          wecomCorpId: String(data.get('wecomCorpId') ?? ''),
          wecomSpaceId: String(data.get('wecomSpaceId') ?? ''),
          wecomFatherId: String(data.get('wecomFatherId') ?? ''),
          wecomSecret: String(data.get('wecomSecret') ?? ''),
        })
        event.currentTarget.reset()
      }}
    >
      <label>GitLab 源站<input name="baseUrl" defaultValue="" autoComplete="off" /></label>
      <label>
        组路径
        <input name="groupPath" defaultValue="" autoComplete="off" />
        <small>例如 acme/platform。只填路径，不填整段网址。</small>
      </label>
      <label>允许自签证书<input name="allowSelfSigned" type="checkbox" defaultChecked={props.allowSelfSigned} /><small>只放宽这个 GitLab 源站的信任库校验，主机名仍然要匹配，不影响企业微信。</small></label>
      <label>
        令牌
        <input name="token" type="password" autoComplete="off" />
        <small>{props.tokenMasked ?? (props.tokenConfigured ? '已保存令牌' : '尚未保存令牌')}</small>
      </label>
      <p>令牌保存在 DSH 凭据库，配置里只保留引用名 tokenRef。请使用该组的组访问令牌，角色不低于 Reporter，范围包含 api。</p>
      <label>企业微信企业 ID<input name="wecomCorpId" autoComplete="off" /></label>
      <label>空间 spaceid<input name="wecomSpaceId" autoComplete="off" /></label>
      <label>目录 fatherid<input name="wecomFatherId" autoComplete="off" /><small>文档放在空间根上时，fatherid 填同一个 spaceid。周报写入将在下一版提供。</small></label>
      <label>企业微信 Secret<input name="wecomSecret" type="password" autoComplete="off" /></label>
      {props.connectError !== null ? <p className="keel-error" role="alert">{props.connectError}</p> : null}
      <button type="submit">保存并连接</button>
      <button type="button" onClick={props.onClearToken}>清除令牌</button>
    </form>
  )
}

function Filters(props: BoardViewProps) {
  return (
    <div className="keel-filters">
      <label>搜索<input value={props.filter.search} onChange={event => props.onSearch(event.target.value)} /></label>
      <label>只看我的<input type="checkbox" checked={props.filter.onlyMine} disabled={props.mineName === null} onChange={event => props.onOnlyMine(event.target.checked)} />{props.mineName ?? ''}</label>
      <label>
        风险
        <select value={props.filter.risk} onChange={event => props.onFilter({ ...props.filter, risk: event.target.value as FilterState['risk'] })}>
          <option value="all">全部</option>
          <option value="none">未评估</option>
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
        </select>
      </label>
      <label>
        负责人
        {props.memberError !== null
          ? <span className="keel-error">{props.memberError}</span>
          : (
            <select
              value={String(props.filter.assigneeId)}
              disabled={props.filter.onlyMine}
              onChange={event => {
                const value = event.target.value
                props.onFilter({
                  ...props.filter,
                  assigneeId: value === 'all' || value === 'None' ? value : Number(value),
                })
              }}
            >
              <option value="all">全部</option>
              <option value="None">未指派</option>
              {props.members.map(member => (
                <option key={member.id} value={member.id}>{member.name} ({member.username})</option>
              ))}
            </select>
          )}
      </label>
      <fieldset>
        <legend>标签</legend>
        {props.labelError !== null
          ? <span className="keel-error">{props.labelError}</span>
          : props.labels.map(label => (
            <label key={label.name}>
              <input
                type="checkbox"
                checked={props.filter.labels.includes(label.name)}
                onChange={event => {
                  const labels = event.target.checked
                    ? [...props.filter.labels, label.name]
                    : props.filter.labels.filter(name => name !== label.name)
                  props.onFilter({ ...props.filter, labels })
                }}
              />
              {label.name}
            </label>
          ))}
      </fieldset>
      <label>
        仓库
        {props.projectError !== null
          ? <span className="keel-error">{props.projectError}</span>
          : (
            <select
              value={String(props.filter.projectId)}
              onChange={event => {
                const value = event.target.value
                props.onFilter({
                  ...props.filter,
                  projectId: value === 'all' ? 'all' : Number(value),
                })
              }}
            >
              <option value="all">全部仓库</option>
              {props.projects.map(project => (
                <option key={project.projectId} value={project.projectId}>{project.projectPath}</option>
              ))}
            </select>
          )}
      </label>
    </div>
  )
}

function StatusColumn(props: BoardViewProps & { name: string, column: 'todo' | 'doing' | 'blocked' | 'done' | 'none', cards: CardState[], note: string | null }) {
  return (
    <Column
      name={props.name}
      state="opened"
      cards={props.cards}
      note={props.note}
      onDrop={key => dropStatus(props, props.column, key)}
      onDueDate={props.onDueDate}
      onRisk={props.onRisk}
      onMove={props.onMove}
      onRetry={props.onRetry}
      onOpen={props.onOpen}
      onStatus={props.onStatus}
    />
  )
}

function dropStatus(props: BoardViewProps, target: 'todo' | 'doing' | 'blocked' | 'done' | 'none', key: string) {
  const card = [props.todo, props.doing, props.blocked, props.done, props.unscoped].flat().find(item => issueKey(item.issue) === key)
  if (card === undefined) return
  const current = card.issue.status ?? 'none'
  if (current === target) return
  props.onStatus(card.issue, target)
}

function IssueTable(props: BoardViewProps) {
  return (
    <table className="keel-list">
      <thead><tr><th>标题</th><th>仓库</th><th>编号</th><th>状态或开关</th><th>负责人</th><th>截止日期</th><th>风险</th><th>评论数</th><th>更新时间</th></tr></thead>
      <tbody>
        {props.list.map(card => (
          <tr key={issueKey(card.issue)} onClick={() => props.onOpen(card.issue)}>
            <td>{card.issue.title}</td>
            <td>{card.issue.projectPath}</td>
            <td>#{card.issue.iid}</td>
            <td>{card.issue.status ?? card.issue.state}</td>
            <td>{card.issue.assignees[0]?.name ?? '未指派'}</td>
            <td>{card.issue.dueDate ?? ''}</td>
            <td>{card.issue.risk ?? '未评估'}</td>
            <td>{card.issue.commentCount}</td>
            <td title={formatShanghai(card.issue.updatedAt, 'full')}>{formatShanghai(card.issue.updatedAt, 'short')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Drawer(props: BoardViewProps) {
  if (props.drawer.kind === 'none') return null
  return (
    <aside className="keel-drawer" aria-label={props.drawer.kind === 'create' ? '新建议题' : '议题详情'}>
      <button type="button" onClick={props.onCloseDrawer}>关闭抽屉</button>
      {props.drawer.kind === 'create' ? <p>新建议题</p> : (
        <>
          <h2>{props.drawer.issue.title}</h2>
          <div dangerouslySetInnerHTML={{ __html: props.drawer.html || renderIssueMarkdown(props.drawer.issue.description ?? '', '') }} />
          {props.drawer.issue.milestoneTitle !== null ? <p>里程碑 {props.drawer.issue.milestoneTitle}</p> : null}
          <ul>
            {props.drawer.notes.map(note => <li key={note.id}>{note.system ? '动态' : '评论'} {note.authorName} {note.body}</li>)}
          </ul>
        </>
      )}
    </aside>
  )
}

function countsDiffer(
  a: NonNullable<ReportResult['projects'][number]['counts']>,
  b: NonNullable<ReportResult['projects'][number]['counts']>
): boolean {
  const norm = (c: typeof a) => JSON.stringify({
    created: c.created,
    closed: c.closed,
    overdue: c.overdue,
    highRiskEvents: c.highRiskEvents,
    doing: c.doing,
    blocked: c.blocked,
    highRiskNow: c.highRiskNow,
  })
  return norm(a) !== norm(b)
}

function ReportDialog(props: {
  report: ReportDialogState
  onReportWrite(): void
  onReportClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])

  const { report } = props
  if (report.kind === 'closed') return null

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && report.kind !== 'writing') {
      props.onReportClose()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="本周周报预览"
      className="keel-report"
      tabIndex={-1}
      ref={ref}
      onKeyDown={handleKeyDown}
    >
      {report.kind === 'loading' ? (
        <>
          <p>正在生成预览…</p>
          <p>已完成 {report.progress.done} / {report.progress.total} 个仓库</p>
        </>
      ) : null}
      {(report.kind === 'preview' || report.kind === 'writing') ? (
        <>
          <h2>{report.preview.weekTitle}</h2>
          <p>窗口：{report.preview.windowStart} 至 {report.preview.windowEnd}</p>
          <p>生成于：{report.preview.generatedAt}</p>
          {report.preview.monthlyDue ? <p>本次同时写入 {report.preview.monthlyTitle}</p> : null}
          {report.preview.projects.length === 0 && report.preview.failed.length === 0 ? (
            <p>没有可生成的仓库</p>
          ) : (
            <>
              {report.preview.projects.map(p => (
                <div key={p.projectId} className="keel-report-project">
                  <h3>{p.projectPath}</h3>
                  <pre className="keel-report-text">{p.text}</pre>
                  {p.truncated ? <p>部分议题超出上限，已截断</p> : null}
                </div>
              ))}
              {report.preview.failed.map(f => (
                <p key={f.projectId} className="keel-error">{f.projectPath}：{f.message}</p>
              ))}
            </>
          )}
          {report.kind === 'writing' ? (
            <p>已完成 {report.progress.done} / {report.progress.total} 个仓库</p>
          ) : null}
          <div className="keel-report-actions">
            <button
              type="button"
              onClick={props.onReportWrite}
              disabled={report.kind === 'writing'}
            >
              写入企业微信
            </button>
            <button
              type="button"
              onClick={props.onReportClose}
              disabled={report.kind === 'writing'}
            >
              关闭
            </button>
          </div>
        </>
      ) : null}
      {report.kind === 'result' ? (
        <>
          <h2>{report.result.weekTitle}</h2>
          {report.result.message !== null ? (
            <p className="keel-error" role="alert">{report.result.message}</p>
          ) : null}
          {report.result.projects.map(p => {
            const weeklyLabel = p.weekly === 'written'
              ? '已写入'
              : p.weekly === 'skipped'
                ? '已跳过（内容相同）'
                : `失败：${p.message ?? '未知错误'}`
            const monthlyLabel = p.monthly === 'written'
              ? '月报已写入'
              : p.monthly === 'skipped'
                ? '月报已跳过（内容相同）'
                : p.monthly === 'failed'
                  ? `月报失败：${p.message ?? '未知错误'}`
                  : null
            let countsChanged = false
            if (report.preview !== null && p.counts !== null) {
              const prev = report.preview.projects.find(item => item.projectId === p.projectId)
              if (prev && countsDiffer(prev.counts, p.counts)) {
                countsChanged = true
              }
            }
            return (
              <div key={p.projectId} className="keel-report-result-project">
                <h3>{p.projectPath}</h3>
                <p>
                  <span>{weeklyLabel}</span>
                  {monthlyLabel !== null ? <span>{monthlyLabel}</span> : null}
                  {p.docUrl !== null ? (
                    <a href={p.docUrl} target="_blank" rel="noreferrer">打开文档</a>
                  ) : null}
                  {countsChanged ? <span>数据在预览后有变化，已按最新数据写入</span> : null}
                </p>
              </div>
            )
          })}
          <div className="keel-report-actions">
            <button type="button" onClick={props.onReportClose}>关闭</button>
          </div>
        </>
      ) : null}
      {report.kind === 'error' ? (
        <>
          <p className="keel-error" role="alert">{report.message}</p>
          <div className="keel-report-actions">
            <button type="button" onClick={props.onReportClose}>关闭</button>
          </div>
        </>
      ) : null}
    </div>
  )
}

function dropCard(props: BoardViewProps, target: 'opened' | 'closed', key: string) {
  const issue = droppedIssue(props.opened, props.closed, key, target)
  if (issue === null) return
  props.onMove(issue, target)
}

function Column(props: {
  name: string
  state: 'opened' | 'closed'
  cards: CardState[]
  note: string | null
  extra?: ReactNode
  onDrop(key: string): void
  onDueDate(issue: KeelIssue, value: string): void
  onRisk(issue: KeelIssue, risk: KeelRisk): void
  onMove(issue: KeelIssue, state: 'opened' | 'closed'): void
  onRetry(issue: KeelIssue): void
  onOpen(issue: KeelIssue): void
  onStatus(issue: KeelIssue, status: 'todo' | 'doing' | 'blocked' | 'done' | 'none'): void
}) {
  return (
    <section
      className="keel-column"
      data-keel={`column-${props.state}`}
      aria-label={props.name}
      onDragOver={event => event.preventDefault()}
      onDrop={event => {
        event.preventDefault()
        props.onDrop(event.dataTransfer.getData('text/plain'))
      }}
    >
      <h2>{props.name}<span>{props.cards.length}</span></h2>
      {props.note !== null ? <p>{props.note}</p> : null}
      {props.extra}
      {props.cards.length === 0 ? <p>没有议题</p> : props.cards.map(card => (
        <Card
          key={issueKey(card.issue)}
          card={card}
          onDueDate={props.onDueDate}
          onRisk={props.onRisk}
          onMove={props.onMove}
          onRetry={props.onRetry}
          onOpen={props.onOpen}
          onStatus={props.onStatus}
        />
      ))}
    </section>
  )
}

function Card(props: {
  card: CardState
  onDueDate(issue: KeelIssue, value: string): void
  onRisk(issue: KeelIssue, risk: KeelRisk): void
  onMove(issue: KeelIssue, state: 'opened' | 'closed'): void
  onRetry(issue: KeelIssue): void
  onOpen(issue: KeelIssue): void
  onStatus(issue: KeelIssue, status: 'todo' | 'doing' | 'blocked' | 'done' | 'none'): void
}) {
  const { issue } = props.card
  const saving = props.card.pending !== undefined
  const reserved = new Set<string>([...RISK_NAMES, ...Object.values(STATUS_LABELS)])
  const otherLabels = issue.labels.filter(label => !reserved.has(label.name))
  const unknownRisk = issue.labels.some(label => label.name.startsWith('risk::') && !RISK_NAMES.has(label.name))
  const unknownStatus = issue.labels.some(label => label.name.startsWith('status::') && !Object.values(STATUS_LABELS).includes(label.name as typeof STATUS_LABELS[keyof typeof STATUS_LABELS]))
  return (
    <article
      className="keel-card"
      draggable={!saving}
      onDragStart={event => event.dataTransfer.setData('text/plain', issueKey(issue))}
    >
      <h3><button type="button" onClick={() => props.onOpen(issue)}>{issue.title}</button></h3>
      <a href={issue.webUrl} target="_blank" rel="noopener">{issue.projectPath}#{issue.iid}</a>
      <p>
        {issue.assignees.length === 0 ? '未指派' : issue.assignees.map(person => (
          <span key={person.id}><span className="keel-avatar" aria-hidden="true">{assigneeInitials(person.name, person.username)}</span>{person.name}</span>
        ))}
      </p>
      {issue.milestoneTitle !== null ? <p>里程碑 {issue.milestoneTitle}</p> : null}
      <p>评论 {issue.commentCount}</p>
      <p title={formatShanghai(issue.updatedAt, 'full')}>{formatShanghai(issue.updatedAt, 'short')}</p>
      <label>
        截止日期
        <input
          type="date"
          value={issue.dueDate ?? ''}
          disabled={saving}
          onChange={event => props.onDueDate(issue, event.target.value)}
        />
        <button type="button" disabled={saving} onClick={() => props.onDueDate(issue, '')}>清除</button>
      </label>
      <label>
        风险
        <select
          value={issue.risk ?? 'none'}
          disabled={saving}
          onChange={event => props.onRisk(issue, event.target.value as KeelRisk)}
        >
          {RISK_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label>
        状态
        <select value={issue.status ?? 'none'} disabled={saving} onChange={event => props.onStatus(issue, event.target.value as 'todo' | 'doing' | 'blocked' | 'done' | 'none')}>
          <option value="none">未分状态</option>
          <option value="todo">待办</option>
          <option value="doing">进行中</option>
          <option value="blocked">阻塞</option>
          <option value="done">完成</option>
        </select>
      </label>
      {issue.riskConflict ? <span>风险标签重复</span> : null}
      {issue.statusConflict ? <span>状态标签重复</span> : null}
      {unknownRisk ? <span>未识别的风险标签</span> : null}
      {unknownStatus ? <span>未识别的状态标签</span> : null}
      <p className="keel-labels">
        {otherLabels.map(label => (
          <span key={label.name} className="keel-chip" style={{ borderColor: label.color ?? 'currentColor' }}>{label.name}</span>
        ))}
      </p>
      {issue.overdue ? <strong>逾期</strong> : null}
      {issue.issueType !== 'issue' ? <span>{issue.issueType}</span> : null}
      {issue.confidential ? <span>保密</span> : null}
      {issue.state === 'closed' ? <span>已关闭</span> : null}
      {saving ? <p>保存中</p> : null}
      {props.card.error !== undefined ? (
        <p className="keel-error" role="alert">
          {props.card.error.message}
          <button type="button" onClick={() => props.onRetry(issue)}>重试</button>
        </p>
      ) : null}
      <button type="button" disabled={saving || issue.state === 'opened'} onClick={() => props.onMove(issue, 'opened')}>移动到打开</button>
      <button type="button" disabled={saving || issue.state === 'closed'} onClick={() => props.onMove(issue, 'closed')}>移动到已关闭</button>
    </article>
  )
}

export function KeelIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M4 16h16M6 16V8h4v8M14 16V5h4v11" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

const STYLES = `
.keel-board { display: flex; flex-direction: column; gap: 12px; padding: 16px; min-width: 0; }
.keel-title { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.keel-title h1 { margin: 0; font-size: 20px; }
.keel-filters, .keel-connect { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
.keel-filters label, .keel-connect label { display: flex; flex-direction: column; gap: 4px; }
.keel-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.keel-column, .keel-card { border: 1px solid #d0d7de; border-radius: 8px; padding: 12px; }
.keel-column { display: flex; flex-direction: column; gap: 8px; min-height: 160px; }
.keel-card { display: flex; flex-direction: column; gap: 6px; background: #fff; }
.keel-card h3 { margin: 0; font-size: 16px; }
.keel-chip { display: inline-block; margin-right: 6px; padding: 0 6px; border: 1px solid; border-radius: 999px; }
.keel-error { color: #cf222e; }
.keel-drawer { position: absolute; right: 0; top: 0; width: 420px; max-width: 100%; background: #fff; border-left: 1px solid #d0d7de; padding: 16px; }
.keel-avatar { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 50%; background: #eaeef2; margin-right: 4px; }
.keel-board { position: relative; }
.keel-report { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #fff; border: 1px solid #d0d7de; border-radius: 8px; padding: 20px; max-width: 800px; max-height: 80vh; overflow-y: auto; z-index: 100; box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
.keel-report-text { white-space: pre-wrap; font-family: monospace; }
.keel-last-report { font-size: 13px; color: #57606a; margin-left: 8px; }
.keel-report-actions { display: flex; gap: 8px; margin-top: 16px; }
.keel-report-result-project p { display: flex; gap: 8px; align-items: center; }
@media (max-width: 767px) {
  .keel-columns, .keel-filters, .keel-connect { display: flex; flex-direction: column; }
  .keel-filters label, .keel-connect label { width: 100%; }
}
`

export function statusOf(configured: boolean, failed: boolean): BoardViewProps['status'] {
  if (!configured) return '未配置'
  if (failed) return '连接失败'
  return '已连接'
}
