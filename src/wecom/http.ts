import { keelError } from '../errors.js'

export interface WecomHttpOptions {
  corpId: string
  secret: string
  fetch?: typeof fetch
  log?: (line: string) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  timeoutMs?: number
}

const WECOM_HOST = 'https://qyapi.weixin.qq.com'
const DEFAULT_TIMEOUT_MS = 15_000

const ALLOWED_PATHS = new Set<string>([
  '/cgi-bin/gettoken',
  '/cgi-bin/wedrive/file_list',
  '/cgi-bin/wedoc/create_doc',
  '/cgi-bin/wedoc/document/get',
  '/cgi-bin/wedoc/document/batch_update',
])

function sanitizeLog(line: string): string {
  return line.replace(/(access_token|corpsecret|key)=([^& \s]+)/g, '$1=***')
}

export class WecomHttp {
  private readonly corpId: string
  private readonly secret: string
  private readonly fetchFn: typeof fetch
  private readonly logFn: (line: string) => void
  private readonly timeoutMs: number

  constructor(options: WecomHttpOptions) {
    this.corpId = options.corpId
    this.secret = options.secret
    this.fetchFn = options.fetch ?? fetch
    const log = options.log
    this.logFn = log ? (line: string) => log(sanitizeLog(line)) : () => {}
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async token(signal?: AbortSignal): Promise<string> {
    const path = '/cgi-bin/gettoken'
    const params = new URLSearchParams({
      corpid: this.corpId,
      corpsecret: this.secret,
    })
    const url = `${WECOM_HOST}${path}?${params.toString()}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal

    let res: Response
    try {
      res = await this.fetchFn(url, {
        method: 'GET',
        redirect: 'manual',
        signal: combinedSignal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw keelError('keel/wecom-unavailable')
    } finally {
      clearTimeout(timeoutId)
    }

    if (res.status >= 300 && res.status < 400) {
      throw keelError('keel/wecom-unavailable')
    }
    if (res.status >= 500) {
      throw keelError('keel/wecom-unavailable')
    }

    let data: unknown
    try {
      data = await res.json()
    } catch {
      throw keelError('keel/wecom-unavailable')
    }

    const payload = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
    const errcode = typeof payload?.errcode === 'number' ? payload.errcode : 0
    this.logFn(`GET ${path} ${res.status} errcode=${errcode}`)

    if (errcode !== 0 || typeof payload?.access_token !== 'string' || !payload.access_token) {
      throw keelError('keel/wecom-unauthorized')
    }

    return payload.access_token
  }

  async call<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    if (!ALLOWED_PATHS.has(path) || path === '/cgi-bin/gettoken') {
      throw keelError('keel/invalid-input')
    }

    const accessToken = await this.token(signal)
    const params = new URLSearchParams({ access_token: accessToken })
    const url = `${WECOM_HOST}${path}?${params.toString()}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal

    let res: Response
    try {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'manual',
        signal: combinedSignal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw keelError('keel/wecom-unavailable')
    } finally {
      clearTimeout(timeoutId)
    }

    if (res.status >= 300 && res.status < 400) {
      throw keelError('keel/wecom-unavailable')
    }
    if (res.status >= 500) {
      throw keelError('keel/wecom-unavailable')
    }

    let data: unknown
    try {
      data = await res.json()
    } catch {
      throw keelError('keel/wecom-unavailable')
    }

    const payload = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
    const errcode = typeof payload?.errcode === 'number' ? payload.errcode : 0
    this.logFn(`POST ${path} ${res.status} errcode=${errcode}`)

    if (errcode === 0) {
      return data as T
    }

    if (errcode === 40014 || errcode === 42001 || errcode === 41001) {
      throw keelError('keel/wecom-unauthorized')
    }
    if ([60011, 60020, 48002, 301002, 640014].includes(errcode)) {
      throw keelError('keel/wecom-forbidden')
    }
    if (errcode === 45009 || errcode === -1) {
      throw keelError('keel/wecom-unavailable')
    }

    throw keelError('keel/wecom-rejected', `企业微信拒绝了这次写入（errcode ${errcode}）`)
  }
}
