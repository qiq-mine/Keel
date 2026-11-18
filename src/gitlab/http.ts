import { Agent } from 'undici'
import { GITLAB_DOWN_MESSAGE, KEEL_MESSAGES, REDIRECT_MESSAGE, keelError, type KeelCode } from '../errors.js'
import { gitlabConnectOptions } from '../tls.js'

const TIMEOUT_MS = 15_000

export interface GitLabRequest {
  method: 'GET' | 'POST' | 'PUT'
  path: string
  query?: Record<string, string | number | undefined>
  body?: Record<string, unknown>
}

export interface GitLabHttpOptions {
  baseUrl: string
  token: string
  allowSelfSigned?: boolean
  fetch?: typeof fetch
  log?: (line: string) => void
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}

export class GitLabHttp {
  private dispatcher: Agent | undefined

  constructor(private readonly options: GitLabHttpOptions) {}

  async json<T>(request: GitLabRequest, signal?: AbortSignal): Promise<T> {
    const response = await this.send(request, signal)
    if (response.text === '') return undefined as T
    try {
      return JSON.parse(response.text) as T
    } catch {
      throw keelError('keel/gitlab-unavailable', GITLAB_DOWN_MESSAGE)
    }
  }

  async send(request: GitLabRequest, signal?: AbortSignal): Promise<{ status: number, headers: Headers, text: string }> {
    assertAllowed(request)
    const write = request.method !== 'GET'
    return this.once(request, signal, write, false)
  }

  private async once(
    request: GitLabRequest,
    signal: AbortSignal | undefined,
    write: boolean,
    retried: boolean,
  ): Promise<{ status: number, headers: Headers, text: string }> {
    const url = buildUrl(this.options.baseUrl, request.path, request.query)
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), this.options.timeoutMs ?? TIMEOUT_MS)
    const composed = signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal])
    let response: Response
    try {
      if (composed.aborted) throw keelError('keel/gitlab-unavailable')
      const dispatcher = this.dispatcherFor(new URL(url))
      response = await (this.options.fetch ?? fetch)(url, {
        method: request.method,
        redirect: 'manual',
        signal: composed,
        ...(dispatcher === undefined ? {} : { dispatcher }),
        headers: {
          'PRIVATE-TOKEN': this.options.token,
          accept: 'application/json',
          ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      })
    } catch (error) {
      if (signal?.aborted) throw error
      if (isUntrustedCertificate(error)) throw keelError('keel/gitlab-tls')
      if (isHostnameMismatch(error)) throw keelError('keel/gitlab-unavailable', 'GitLab 证书的主机名不匹配')
      throw keelError('keel/gitlab-unavailable')
    } finally {
      clearTimeout(timer)
    }
    const text = await response.text()
    this.options.log?.(`${request.method} ${request.path} ${response.status}`)
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw keelError('keel/gitlab-unavailable', REDIRECT_MESSAGE)
    }
    if (response.status === 429 && !write && !retried) {
      await (this.options.sleep ?? delay)(retryDelay(response.headers))
      return this.once(request, signal, write, true)
    }
    if (response.status >= 200 && response.status < 300) {
      return { status: response.status, headers: response.headers, text }
    }
    throw mapStatus(response.status)
  }

  private dispatcherFor(url: URL): Agent | undefined {
    if (this.options.allowSelfSigned !== true || url.protocol !== 'https:') return undefined
    this.dispatcher ??= new Agent({ connect: gitlabConnectOptions(true) })
    return this.dispatcher
  }
}

export function assertAllowed(request: GitLabRequest): void {
  const path = request.path
  const group = /^\/groups\/[^/]+(?:\/projects|\/members\/all|\/labels|\/issues)?$/
  const projectIssues = /^\/projects\/\d+\/issues$/
  const projectIssue = /^\/projects\/\d+\/issues\/\d+$/
  const notes = /^\/projects\/\d+\/issues\/\d+\/notes$/
  const labelEvents = /^\/projects\/\d+\/issues\/\d+\/resource_label_events$/
  const allowed = request.method === 'GET'
    ? path === '/user' || group.test(path) || projectIssues.test(path) || projectIssue.test(path) || notes.test(path) || labelEvents.test(path)
    : request.method === 'POST'
      ? /^\/groups\/[^/]+\/labels$/.test(path) || projectIssues.test(path)
      : projectIssue.test(path)
  if (!allowed) throw keelError('keel/invalid-input')
  if (request.method !== 'GET' && request.body !== undefined) {
    const keys = Object.keys(request.body)
    const permitted = request.method === 'POST' && projectIssues.test(path)
      ? new Set(['title', 'assignee_ids', 'labels', 'due_date'])
      : request.method === 'POST'
        ? new Set(['name', 'color', 'description'])
        : new Set(['due_date', 'add_labels', 'remove_labels', 'state_event'])
    if (keys.length === 0 || keys.some(key => !permitted.has(key))) throw keelError('keel/invalid-input')
  }
}

export function buildUrl(baseUrl: string, path: string, query: GitLabRequest['query']): string {
  const url = new URL(`${baseUrl}/api/v4${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export function totalOf(headers: Headers): number | null {
  const raw = headers.get('x-total')
  if (raw === null || raw === '') return null
  const total = Number(raw)
  return Number.isInteger(total) && total >= 0 ? total : null
}

export function nextPageOf(headers: Headers): number | null {
  const raw = headers.get('x-next-page')
  if (raw === null || raw === '') return null
  const page = Number(raw)
  return Number.isInteger(page) && page > 0 ? page : null
}

function mapStatus(status: number): Error {
  const code: KeelCode = status === 401
    ? 'keel/unauthorized'
    : status === 403
      ? 'keel/forbidden'
      : status === 404
        ? 'keel/not-found'
        : status === 429
          ? 'keel/rate-limited'
          : status >= 500
            ? 'keel/gitlab-unavailable'
            : 'keel/invalid-input'
  const message = status >= 500 ? GITLAB_DOWN_MESSAGE : KEEL_MESSAGES[code]
  return keelError(code, message)
}

function retryDelay(headers: Headers): number {
  const raw = headers.get('retry-after')
  if (raw === null || raw === '') return 1000
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds < 0) return 1000
  return seconds * 1000
}

function isUntrustedCertificate(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'SELF_SIGNED_CERT_IN_CHAIN'
}

function isHostnameMismatch(error: unknown): boolean {
  return errorCode(error) === 'ERR_TLS_CERT_ALTNAME_INVALID'
}

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const code = 'code' in error ? error.code : 'cause' in error ? errorCode(error.cause) : ''
  return typeof code === 'string' ? code : ''
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
