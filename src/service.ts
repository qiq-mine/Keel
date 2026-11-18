import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Config } from './config.js'
import { KeelError } from './errors.js'
import type { KeelConnection, KeelIssue, KeelLabel, KeelListPage, KeelListQuery, KeelMember, KeelProject, KeelRisk } from './model.js'
import * as ops from './operations.js'
import { ReportJobs, ReportStatus } from './report/run.js'
import { WecomClients } from './wecom/http.js'

declare module '@deepseek-ai/dsh-typert-protocol/types' {
  interface RemoteErrorDetailsMap {
    'keel/gitlab-unavailable': { readonly status?: number }
    'keel/unauthorized': { readonly status?: number }
    'keel/forbidden': { readonly status?: number }
    'keel/not-found': { readonly status?: number }
    'keel/rate-limited': { readonly status?: number }
    'keel/not-configured': { readonly status?: number }
    'keel/outside-group': { readonly status?: number }
    'keel/labels-missing': { readonly status?: number }
    'keel/invalid-input': { readonly status?: number }
    'keel/gitlab-tls': { readonly status?: number }
    'keel/session-unavailable': { readonly status?: number }
    'keel/wecom-not-configured': { readonly status?: number }
    'keel/wecom-unavailable': { readonly status?: number }
    'keel/wecom-unauthorized': { readonly status?: number }
    'keel/wecom-forbidden': { readonly status?: number }
    'keel/wecom-ambiguous-doc': { readonly status?: number }
    'keel/wecom-docid-unreadable': { readonly status?: number }
    'keel/wecom-doc-index': { readonly status?: number }
    'keel/wecom-rejected': { readonly status?: number }
    'keel/report-stale': { readonly status?: number }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    keel: KeelService
  }
}

export class KeelService extends TypertRemoteService {
  private readonly jobs = new ReportJobs()
  private readonly wecomClients = new WecomClients()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'keel')
  }

  @Remote
  connection(signal: AbortSignal): Promise<KeelConnection> {
    return this.run(signal, ctx => ops.connection(ctx, signal))
  }

  @Remote
  setToken(value: string, signal: AbortSignal): Promise<{ configured: true }> {
    return this.run(signal, ctx => ops.setToken(ctx, value))
  }

  @Remote
  clearToken(signal: AbortSignal): Promise<{ configured: false }> {
    return this.run(signal, ctx => ops.clearToken(ctx))
  }

  @Remote
  listMembers(signal: AbortSignal): Promise<KeelMember[]> {
    return this.run(signal, ctx => ops.listMembers(ctx, signal))
  }

  @Remote
  listLabels(signal: AbortSignal): Promise<KeelLabel[]> {
    return this.run(signal, ctx => ops.listLabels(ctx, signal))
  }

  @Remote
  listProjects(signal: AbortSignal): Promise<KeelProject[]> {
    return this.run(signal, ctx => ops.listProjects(ctx, signal))
  }

  @Remote
  listIssues(query: KeelListQuery, signal: AbortSignal): Promise<KeelListPage> {
    return this.run(signal, ctx => ops.listIssues(ctx, query, signal))
  }

  @Remote
  setDueDate(projectId: number, iid: number, dueDate: string, signal: AbortSignal): Promise<KeelIssue> {
    return this.run(signal, ctx => ops.setDueDate(ctx, projectId, iid, dueDate, signal))
  }

  @Remote
  setRisk(projectId: number, iid: number, risk: KeelRisk, signal: AbortSignal): Promise<KeelIssue> {
    return this.run(signal, ctx => ops.setRisk(ctx, projectId, iid, risk, signal))
  }

  @Remote
  setState(projectId: number, iid: number, state: 'opened' | 'closed', signal: AbortSignal): Promise<KeelIssue> {
    return this.run(signal, ctx => ops.setState(ctx, projectId, iid, state, signal))
  }

  @Remote
  setStatus(projectId: number, iid: number, status: 'todo' | 'doing' | 'blocked' | 'done' | 'none', signal: AbortSignal): Promise<KeelIssue> {
    return this.run(signal, ctx => ops.setStatus(ctx, projectId, iid, status, signal))
  }

  @Remote
  createIssue(input: import('./model.js').KeelCreateInput, signal: AbortSignal): Promise<KeelIssue> {
    return this.run(signal, ctx => ops.createIssue(ctx, input, signal))
  }

  @Remote
  columnModes(projectId: number, signal: AbortSignal) {
    return this.run(signal, ctx => ops.columnModes(ctx, projectId === 0 ? undefined : projectId, signal))
  }

  @Remote
  summary(query: import('./model.js').KeelListQuery, signal: AbortSignal) {
    return this.run(signal, ctx => ops.summary(ctx, query, signal))
  }

  @Remote
  getIssue(projectId: number, iid: number, signal: AbortSignal): Promise<KeelIssue> {
    return this.run(signal, ctx => ops.getIssue(ctx, projectId, iid, signal))
  }

  @Remote
  listNotes(projectId: number, iid: number, page: number, signal: AbortSignal) {
    return this.run(signal, ctx => ops.listNotes(ctx, projectId, iid, page, signal))
  }

  @Remote
  setWecomSecret(value: string, signal: AbortSignal): Promise<{ configured: true }> {
    return this.run(signal, ctx => ops.setWecomSecret(ctx, value))
  }

  @Remote
  clearWecomSecret(signal: AbortSignal): Promise<{ configured: false }> {
    return this.run(signal, ctx => ops.clearWecomSecret(ctx))
  }

  @Remote
  analyzeIssue(projectId: number, iid: number, sessionId: string, agentPreset: string, signal: AbortSignal): Promise<{ sessionId: string }> {
    return this.run(signal, ctx => ops.analyzeIssue(ctx, { projectId, iid, sessionId, agentPreset }, signal))
  }

  @Remote
  reportStart(mode: string, asOf: string, signal: AbortSignal): Promise<{ runId: string }> {
    return this.run(signal, ctx => ops.reportStart(ctx, mode, asOf))
  }

  @Remote
  reportStatus(runId: string, signal: AbortSignal): Promise<ReportStatus> {
    return this.run(signal, async ctx => ops.reportStatus(ctx, runId))
  }

  private async run<T>(signal: AbortSignal, action: (ctx: ops.OperationContext) => Promise<T>): Promise<T> {
    signal.throwIfAborted()
    try {
      return await action(this.context())
    } catch (error) {
      if (error instanceof KeelError) {
        throw new RemoteError(error.code, error.message, {})
      }
      throw error
    }
  }

  operationContext(): ops.OperationContext {
    return this.context()
  }

  private context(): ops.OperationContext {
    const credentials = this.ctx.credentials
    const log = (line: string) => this.ctx.logger.info(line)
    return {
      config: this.config,
      log,
      agents: this.ctx.agents,
      resolve: async ref => (await credentials.resolve(credentialRef(ref)))?.value,
      describe: async ref => {
        const info = await credentials.describe(credentialRef(ref))
        const preview = (info as { masked?: unknown }).masked
        return { configured: info.configured, masked: typeof preview === 'string' ? preview : undefined }
      },
      set: (ref, value) => credentials.set(credentialRef(ref), value),
      unset: ref => credentials.unset(credentialRef(ref)),
      jobs: this.jobs,
      wecomClients: this.wecomClients,
    }
  }
}
