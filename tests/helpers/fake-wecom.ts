export interface RecordedCall {
  method: string
  path: string
  queryKeys: string[]
  query: Record<string, string>
  body?: unknown
}

export interface FakeRouteResponse {
  status?: number
  headers?: Record<string, string>
  body?: unknown
}

export type FakeRouteHandler =
  | FakeRouteResponse
  | ((req: { method: string; path: string; queryKeys: string[]; query?: Record<string, string>; body?: unknown }) => FakeRouteResponse | Promise<FakeRouteResponse>)
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null

export function createFakeWecom(routes: Record<string, FakeRouteHandler> = {}) {
  const calls: RecordedCall[] = []

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let urlStr: string
    if (typeof input === 'string') {
      urlStr = input
    } else if (input instanceof URL) {
      urlStr = input.toString()
    } else if (input && typeof (input as Request).url === 'string') {
      urlStr = (input as Request).url
    } else {
      urlStr = String(input)
    }

    const parsedUrl = new URL(urlStr, 'https://qyapi.weixin.qq.com')
    const path = parsedUrl.pathname
    const queryKeys = Array.from(parsedUrl.searchParams.keys())
    const query: Record<string, string> = Object.fromEntries(parsedUrl.searchParams.entries())
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()

    let body: unknown = undefined
    const rawBody = init?.body ?? (input instanceof Request ? await (input as Request).clone().text() : undefined)
    if (rawBody !== undefined && rawBody !== null) {
      if (typeof rawBody === 'string') {
        try {
          body = JSON.parse(rawBody)
        } catch {
          body = rawBody
        }
      } else {
        body = rawBody
      }
    }

    calls.push({
      method,
      path,
      queryKeys,
      query,
      body,
    })

    const matchedHandler = routes[path]
    if (matchedHandler === undefined) {
      return new Response(JSON.stringify({ errcode: 404, errmsg: 'not found in fake routes' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }

    let resp: FakeRouteResponse
    if (typeof matchedHandler === 'function') {
      resp = await (matchedHandler as (req: { method: string; path: string; queryKeys: string[]; query: Record<string, string>; body?: unknown }) => FakeRouteResponse | Promise<FakeRouteResponse>)({
        method,
        path,
        queryKeys,
        query,
        body,
      })
    } else if (
      matchedHandler !== null &&
      typeof matchedHandler === 'object' &&
      ('status' in (matchedHandler as Record<string, unknown>) ||
        'body' in (matchedHandler as Record<string, unknown>) ||
        'headers' in (matchedHandler as Record<string, unknown>))
    ) {
      resp = matchedHandler as FakeRouteResponse
    } else {
      resp = { body: matchedHandler }
    }

    const status = resp.status ?? 200
    const headers = new Headers(resp.headers)
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }

    const responseBody = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body ?? {})
    return new Response(responseBody, {
      status,
      headers,
    })
  }

  return {
    fetch: fakeFetch as typeof globalThis.fetch,
    calls,
  }
}

export const fakeWecom = createFakeWecom
export default createFakeWecom
