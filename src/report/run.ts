import { randomUUID } from 'node:crypto'
import type { WecomHttp } from '../wecom/http.js'
import {
  type DocTarget,
  docName,
  docHeader,
  listDocsByName,
  createDoc,
  resolveDocid,
  readDoc,
  replaceSection
} from '../wecom/docs.js'
import { isLastFriday, monthTitle, weekOf, windowEnd } from './clock.js'
import { comparableText, renderSection, countsOf, type ReportCounts } from './render.js'
import { parseWeeks, renderMonthly } from './monthly.js'
import { KeelError, keelError, KEEL_MESSAGES } from '../errors.js'
import { collectReport, isoShanghai, type ReportSource, type ReportData } from './collect.js'

export interface WriteProjectInput {
  target: DocTarget
  projectPath: string
  weekTitle: string
  F: string
  sectionText: string
  kind: 'manual' | 'scheduled' | 'catch-up'
}

export interface WriteProjectResult {
  weekly: 'written' | 'skipped' | 'failed'
  monthly: 'written' | 'skipped' | 'not-due' | 'failed'
  message: string | null
  docUrl: string | null
}

function errorMessage(err: unknown): string {
  if (err instanceof KeelError) {
    return err.message
  }
  return KEEL_MESSAGES['keel/wecom-unavailable']
}

export async function writeProject(http: WecomHttp, input: WriteProjectInput): Promise<WriteProjectResult> {
  let docUrl: string | null = null
  let weekly: 'written' | 'skipped'
  let docid: string
  let policy: 'if-missing' | 'if-different'

  try {
    const name = docName(input.projectPath)
    const matches = await listDocsByName(http, input.target, name)
    if (matches.length > 1) {
      throw keelError('keel/wecom-ambiguous-doc')
    }

    let file: { fileid: string; url: string }
    let created = false
    if (matches.length === 1) {
      file = matches[0]
      created = false
    } else {
      const c = await createDoc(http, input.target, name)
      file = { fileid: c.docid, url: c.url }
      created = true
    }

    docid = await resolveDocid(http, file)
    docUrl = file.url === '' || !file.url ? null : file.url

    policy = input.kind === 'catch-up' ? 'if-missing' : 'if-different'
    const text = created ? docHeader(input.projectPath) + input.sectionText : input.sectionText
    weekly = await replaceSection(
      http,
      docid,
      input.weekTitle,
      text,
      policy,
      (a, b) => comparableText(a) === comparableText(b)
    )
  } catch (err) {
    return {
      weekly: 'failed',
      monthly: 'failed',
      message: errorMessage(err),
      docUrl
    }
  }

  try {
    if (!isLastFriday(input.F)) {
      return {
        weekly,
        monthly: 'not-due',
        message: null,
        docUrl
      }
    }

    const month = input.F.slice(0, 7)
    const doc = await readDoc(http, docid)
    const monthText = renderMonthly(month, parseWeeks(doc.text, month))
    const monthly = await replaceSection(
      http,
      docid,
      monthTitle(input.F),
      monthText,
      policy,
      (a, b) => a.replace(/\n$/, '') === b.replace(/\n$/, '')
    )
    return {
      weekly,
      monthly,
      message: null,
      docUrl
    }
  } catch (err) {
    return {
      weekly,
      monthly: 'failed',
      message: errorMessage(err),
      docUrl
    }
  }
}

export interface RunProject { projectId: number; projectPath: string; columnMode: 'status' | 'state' }
export interface RunDeps {
  now: () => number
  projects: () => Promise<RunProject[]>
  source: ReportSource
  // Called once per write run. Must build a NEW WecomHttp each time (secret read fresh). null = WeCom not configured.
  wecom: () => Promise<{ http: WecomHttp; target: DocTarget } | null>
  onProgress?: (done: number, total: number) => void
}
export interface ReportPreview {
  asOf: string; weekTitle: string; windowStart: string; windowEnd: string; generatedAt: string
  monthlyDue: boolean; monthlyTitle: string | null
  projects: { projectId: number; projectPath: string; text: string; counts: ReportCounts; truncated: boolean }[]
  failed: { projectId: number; projectPath: string; message: string }[]
}
export interface ReportResult {
  kind: 'manual' | 'scheduled' | 'catch-up'
  weekTitle: string
  finishedAt: string
  message: string | null
  projects: { projectId: number; projectPath: string; weekly: 'written' | 'skipped' | 'failed'; monthly: 'written' | 'skipped' | 'not-due' | 'failed'; message: string | null; docUrl: string | null; counts: ReportCounts | null }[]
}

export function checkAsOf(asOf: string, now: number): number {
  const t = Date.parse(asOf)
  if (Number.isNaN(t) || t > now || now - t > 30 * 60 * 1000 || weekOf(t).F !== weekOf(now).F) {
    throw keelError('keel/report-stale')
  }
  return t
}

export async function previewReport(deps: RunDeps): Promise<ReportPreview> {
  const at = deps.now()
  const week = weekOf(at)
  const windowStartMs = week.windowStart
  const windowEndMs = windowEnd(at, 'manual')
  const runAt = deps.now()

  const projects = await deps.projects()
  const succeeded: ReportPreview['projects'] = []
  const failed: ReportPreview['failed'] = []

  for (let i = 0; i < projects.length; i++) {
    const p = projects[i]
    try {
      const data = await collectReport(deps.source, {
        projectId: p.projectId,
        projectPath: p.projectPath,
        columnMode: p.columnMode,
        weekTitle: week.weekTitle,
        windowStart: windowStartMs,
        windowEnd: windowEndMs,
        runAt
      })
      const truncated = Boolean(
        data.created.truncated
        || data.closed.truncated
        || data.overdue.truncated
        || data.highRisk.truncated
        || (data.doing?.truncated ?? false)
        || (data.blocked?.truncated ?? false)
        || data.highRiskNow.truncated
      )
      succeeded.push({
        projectId: p.projectId,
        projectPath: p.projectPath,
        text: renderSection(data),
        counts: countsOf(data),
        truncated
      })
    } catch (err) {
      const message = err instanceof KeelError ? err.message : KEEL_MESSAGES['keel/gitlab-unavailable']
      failed.push({
        projectId: p.projectId,
        projectPath: p.projectPath,
        message
      })
    }
    deps.onProgress?.(i + 1, projects.length)
  }

  const monthlyDue = isLastFriday(week.F)
  return {
    asOf: isoShanghai(at),
    weekTitle: week.weekTitle,
    windowStart: isoShanghai(windowStartMs),
    windowEnd: isoShanghai(windowEndMs),
    generatedAt: isoShanghai(runAt),
    monthlyDue,
    monthlyTitle: monthlyDue ? monthTitle(week.F) : null,
    projects: succeeded,
    failed
  }
}

export async function writeReport(
  deps: RunDeps,
  kind: 'manual' | 'scheduled' | 'catch-up',
  at: number
): Promise<ReportResult> {
  const week = weekOf(at)
  const windowStartMs = week.windowStart
  const windowEndMs = windowEnd(at, kind === 'manual' ? 'manual' : 'scheduled')

  const w = await deps.wecom()
  if (w === null) {
    return {
      kind,
      weekTitle: week.weekTitle,
      finishedAt: isoShanghai(deps.now()),
      message: KEEL_MESSAGES['keel/wecom-not-configured'],
      projects: []
    }
  }

  try {
    await w.http.token()
  } catch (err) {
    const message = err instanceof KeelError ? err.message : KEEL_MESSAGES['keel/wecom-unavailable']
    return {
      kind,
      weekTitle: week.weekTitle,
      finishedAt: isoShanghai(deps.now()),
      message,
      projects: []
    }
  }

  const projects = await deps.projects()
  const results: ReportResult['projects'] = []
  const runAt = deps.now()

  for (let i = 0; i < projects.length; i++) {
    const p = projects[i]
    let data: ReportData
    try {
      data = await collectReport(deps.source, {
        projectId: p.projectId,
        projectPath: p.projectPath,
        columnMode: p.columnMode,
        weekTitle: week.weekTitle,
        windowStart: windowStartMs,
        windowEnd: windowEndMs,
        runAt
      })
    } catch (err) {
      const message = err instanceof KeelError ? err.message : KEEL_MESSAGES['keel/gitlab-unavailable']
      results.push({
        projectId: p.projectId,
        projectPath: p.projectPath,
        weekly: 'failed',
        monthly: 'failed',
        message,
        docUrl: null,
        counts: null
      })
      deps.onProgress?.(i + 1, projects.length)
      continue
    }

    const r = await writeProject(w.http, {
      target: w.target,
      projectPath: p.projectPath,
      weekTitle: week.weekTitle,
      F: week.F,
      sectionText: renderSection(data),
      kind
    })
    results.push({
      projectId: p.projectId,
      projectPath: p.projectPath,
      weekly: r.weekly,
      monthly: r.monthly,
      message: r.message,
      docUrl: r.docUrl,
      counts: countsOf(data)
    })
    deps.onProgress?.(i + 1, projects.length)
  }

  return {
    kind,
    weekTitle: week.weekTitle,
    finishedAt: isoShanghai(deps.now()),
    message: null,
    projects: results
  }
}

export type ReportJobState = 'queued' | 'running' | 'done' | 'failed'

export interface ReportStatus {
  state: ReportJobState
  progress: { done: number; total: number }
  preview: ReportPreview | null
  result: ReportResult | null
  message: string | null
}

export interface ReportJobOutput {
  preview?: ReportPreview
  result?: ReportResult
}

export type ReportTask = (onProgress: (done: number, total: number) => void) => Promise<ReportJobOutput>

export interface LastReport {
  at: string
  written: number
  skipped: number
  failed: number
}

interface StoredJob {
  id: string
  state: ReportJobState
  progress: { done: number; total: number }
  preview: ReportPreview | null
  result: ReportResult | null
  message: string | null
}

export class ReportJobs {
  readonly #newId: () => string
  readonly #keep: number
  readonly #jobs = new Map<string, StoredJob>()
  readonly #jobList: StoredJob[] = []
  #tail: Promise<void> = Promise.resolve()
  #lastReport: LastReport | null = null

  constructor(options?: { newId?: () => string; keep?: number }) {
    this.#newId = options?.newId ?? randomUUID
    this.#keep = options?.keep ?? 10
  }

  #prune(): void {
    while (this.#jobList.length > this.#keep) {
      const idx = this.#jobList.findIndex(j => j.state === 'done' || j.state === 'failed')
      if (idx === -1) {
        break
      }
      const [removed] = this.#jobList.splice(idx, 1)
      this.#jobs.delete(removed.id)
    }
  }

  start(task: ReportTask): string {
    const runId = this.#newId()
    const job: StoredJob = {
      id: runId,
      state: 'queued',
      progress: { done: 0, total: 0 },
      preview: null,
      result: null,
      message: null
    }
    this.#jobs.set(runId, job)
    this.#jobList.push(job)
    this.#prune()

    const run = async () => {
      job.state = 'running'
      try {
        const onProgress = (done: number, total: number) => {
          if (done >= job.progress.done) {
            job.progress = { done, total }
          }
        }
        const output = (await task(onProgress)) ?? {}
        job.state = 'done'
        job.preview = output.preview ?? null
        job.result = output.result ?? null
        job.message = output.result?.message ?? null
        if (output.result) {
          const earlyStop = output.result.message !== null && (output.result.projects?.length ?? 0) === 0
          if (!earlyStop) {
            let written = 0
            let skipped = 0
            let failed = 0
            for (const p of output.result.projects ?? []) {
              if (p.weekly === 'written') {
                written++
              } else if (p.weekly === 'skipped') {
                skipped++
              } else if (p.weekly === 'failed') {
                failed++
              }
            }
            this.#lastReport = {
              at: output.result.finishedAt,
              written,
              skipped,
              failed
            }
          }
        }
      } catch (err) {
        job.state = 'failed'
        job.message = err instanceof KeelError ? err.message : '周报生成失败'
      } finally {
        this.#prune()
      }
    }

    this.#tail = this.#tail.then(run, run)
    return runId
  }

  status(runId: string): ReportStatus {
    const job = this.#jobs.get(runId)
    if (!job) {
      throw keelError('keel/not-found')
    }
    return {
      state: job.state,
      progress: { done: job.progress.done, total: job.progress.total },
      preview: job.preview === null ? null : structuredClone(job.preview),
      result: job.result === null ? null : structuredClone(job.result),
      message: job.message
    }
  }

  lastReport(): LastReport | null {
    return this.#lastReport ? { ...this.#lastReport } : null
  }

  async idle(): Promise<void> {
    while (true) {
      const p = this.#tail
      await p
      if (this.#tail === p) {
        break
      }
    }
  }
}


