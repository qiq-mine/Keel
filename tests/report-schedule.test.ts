import assert from 'node:assert/strict'
import test from 'node:test'
import { armSchedule, ONE_HOUR_MS, type TimerHandle } from '../src/report/schedule.js'
import { ReportJobs } from '../src/report/run.js'
import type { OperationContext } from '../src/operations.js'
import { Config } from '../src/config.js'

function fakeConfig(overrides: {
  baseUrl?: string
  groupPath?: string
  tokenRef?: string
  allowSelfSigned?: boolean
  wecomCorpId?: string
  wecomSecretRef?: string
  wecomSpaceId?: string
  wecomFatherId?: string
} = {}): Config {
  return {
    baseUrl: { get: () => overrides.baseUrl ?? '' },
    groupPath: { get: () => overrides.groupPath ?? '' },
    tokenRef: { get: () => overrides.tokenRef ?? 'KEEL_GITLAB_TOKEN' },
    allowSelfSigned: { get: () => overrides.allowSelfSigned ?? false },
    wecomCorpId: { get: () => overrides.wecomCorpId ?? '' },
    wecomSecretRef: { get: () => overrides.wecomSecretRef ?? 'KEEL_WECOM_SECRET' },
    wecomSpaceId: { get: () => overrides.wecomSpaceId ?? '' },
    wecomFatherId: { get: () => overrides.wecomFatherId ?? '' },
  } as unknown as Config
}

function fakeContext(options: { jobs?: ReportJobs } = {}): OperationContext {
  const jobs = options.jobs ?? new ReportJobs()
  const config = fakeConfig({
    baseUrl: 'https://gitlab.example.com',
    groupPath: 'acme/platform',
  })
  return {
    config,
    resolve: async () => 'test-token',
    describe: async () => ({ configured: true, masked: '***' }),
    set: async () => {},
    unset: async () => {},
    jobs,
    fetch: async () => new Response(JSON.stringify([])),
    sleep: async () => {},
  }
}

interface FakeTimerController {
  activeCount: () => number
  setTimeout: (cb: () => void, ms: number) => TimerHandle
  clearTimeout: (id: TimerHandle) => void
  fireNext: () => void
  delays: number[]
}

function createTimerController(): FakeTimerController {
  let nextId = 1
  const timers = new Map<number, { cb: () => void, ms: number }>()
  const delays: number[] = []

  return {
    activeCount: () => timers.size,
    setTimeout: (cb, ms) => {
      const id = nextId++
      delays.push(ms)
      timers.set(id, { cb, ms })
      return id as unknown as TimerHandle
    },
    clearTimeout: (id) => {
      timers.delete(id as unknown as number)
    },
    fireNext: () => {
      const entry = timers.entries().next().value
      if (!entry) return
      const [id, { cb }] = entry
      timers.delete(id)
      cb()
    },
    delays,
  }
}

type MockTask = (progress: (done: number, total: number) => void) => Promise<{ result?: { kind?: string } } | void>

test('segmented sleep: timer sleeps at most 1 hour towards Friday 10:00', () => {
  // Thursday 2026-11-19 10:00:00 Asia/Shanghai (24h before Friday 10:00)
  let currentTime = Date.parse('2026-11-19T10:00:00.000+08:00')
  const timers = createTimerController()
  const jobs = new ReportJobs()
  const ctx = fakeContext({ jobs })

  const dispose = armSchedule(ctx, {
    now: () => currentTime,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  })

  // First delay must be capped at 1 hour (3600000ms), not 24 hours
  assert.equal(timers.delays[0], ONE_HOUR_MS)
  assert.equal(timers.activeCount(), 1)

  // Fire the hourly timer after advancing time by 1 hour
  currentTime += ONE_HOUR_MS
  timers.fireNext()

  // Second delay is also 1 hour
  assert.equal(timers.delays[1], ONE_HOUR_MS)

  dispose()
  assert.equal(timers.activeCount(), 0)
})

test('scheduled execution: callback fires within 60s of Friday 10:00', async () => {
  // Friday 2026-11-20 09:30:00 Asia/Shanghai (30m before Friday 10:00)
  let currentTime = Date.parse('2026-11-20T09:30:00.000+08:00')
  const timers = createTimerController()
  let queuedKind: string | null = null

  const jobs = {
    start(task: MockTask) {
      // Inspect task closure by running or intercepting
      void task(() => {}).then(res => {
        if (res?.result?.kind) queuedKind = res.result.kind
      }).catch(() => {})
      return 'run-test'
    },
    status: () => { throw new Error('unused') },
    lastReport: () => null,
  } as unknown as ReportJobs

  const ctx = fakeContext({ jobs })

  const dispose = armSchedule(ctx, {
    now: () => currentTime,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  })

  // Remaining time is 30m = 1800000ms
  assert.equal(timers.delays[0], 30 * 60 * 1000)

  // Advance time to Friday 10:00:05 (5 seconds after scheduled time, <= 60s)
  currentTime = Date.parse('2026-11-20T10:00:05.000+08:00')
  timers.fireNext()

  // Give microtasks time to run
  await new Promise(resolve => setTimeout(resolve, 10))

  assert.equal(queuedKind, 'scheduled')
  dispose()
})

test('catch-up execution: callback fires > 60s late within catch-up window', async () => {
  // Friday 2026-11-20 09:30:00 Asia/Shanghai
  let currentTime = Date.parse('2026-11-20T09:30:00.000+08:00')
  const timers = createTimerController()
  let queuedKind: string | null = null

  const jobs = {
    start(task: MockTask) {
      void task(() => {}).then(res => {
        if (res?.result?.kind) queuedKind = res.result.kind
      }).catch(() => {})
      return 'run-test'
    },
    status: () => { throw new Error('unused') },
    lastReport: () => null,
  } as unknown as ReportJobs

  const ctx = fakeContext({ jobs })

  const dispose = armSchedule(ctx, {
    now: () => currentTime,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  })

  // Woke up 5 minutes late (Friday 10:05:00, diff = 300s > 60s)
  currentTime = Date.parse('2026-11-20T10:05:00.000+08:00')
  timers.fireNext()

  await new Promise(resolve => setTimeout(resolve, 10))

  assert.equal(queuedKind, 'catch-up')
  dispose()
})

test('no catch-up: callback fires past Monday 10:00 catch-up window', async () => {
  // Friday 2026-11-20 09:30:00 Asia/Shanghai
  let currentTime = Date.parse('2026-11-20T09:30:00.000+08:00')
  const timers = createTimerController()
  let jobStarted = false

  const jobs = {
    start() {
      jobStarted = true
      return 'run-test'
    },
    status: () => { throw new Error('unused') },
    lastReport: () => null,
  } as unknown as ReportJobs

  const ctx = fakeContext({ jobs })

  const dispose = armSchedule(ctx, {
    now: () => currentTime,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  })

  // Woke up next Tuesday 10:00 (outside catch-up window)
  currentTime = Date.parse('2026-11-24T10:00:00.000+08:00')
  timers.fireNext()

  await new Promise(resolve => setTimeout(resolve, 10))

  assert.equal(jobStarted, false)
  dispose()
})

test('startup catch-up: triggers catch-up on Saturday within window', async () => {
  // Saturday 2026-11-21 14:00:00 Asia/Shanghai (Friday just passed)
  const currentTime = Date.parse('2026-11-21T14:00:00.000+08:00')
  const timers = createTimerController()
  let queuedKind: string | null = null

  const jobs = {
    start(task: MockTask) {
      void task(() => {}).then(res => {
        if (res?.result?.kind) queuedKind = res.result.kind
      }).catch(() => {})
      return 'run-test'
    },
    status: () => { throw new Error('unused') },
    lastReport: () => null,
  } as unknown as ReportJobs

  const ctx = fakeContext({ jobs })

  const dispose = armSchedule(ctx, {
    now: () => currentTime,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  })

  await new Promise(resolve => setTimeout(resolve, 10))

  assert.equal(queuedKind, 'catch-up')
  dispose()
})

test('startup no catch-up: on Wednesday before Friday', () => {
  // Wednesday 2026-11-18 14:00:00 Asia/Shanghai
  const currentTime = Date.parse('2026-11-18T14:00:00.000+08:00')
  const timers = createTimerController()
  let jobStarted = false

  const jobs = {
    start() {
      jobStarted = true
      return 'run-test'
    },
    status: () => { throw new Error('unused') },
    lastReport: () => null,
  } as unknown as ReportJobs

  const ctx = fakeContext({ jobs })

  const dispose = armSchedule(ctx, {
    now: () => currentTime,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  })

  assert.equal(jobStarted, false)
  dispose()
})

test('dispose leaves zero active timers', () => {
  const currentTime = Date.parse('2026-11-19T10:00:00.000+08:00')
  const timers = createTimerController()
  const ctx = fakeContext()

  const dispose = armSchedule(ctx, {
    now: () => currentTime,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  })

  assert.equal(timers.activeCount(), 1)
  dispose()
  assert.equal(timers.activeCount(), 0)
})

test('disposed schedule does not run when timer fires', () => {
  const currentTime = Date.parse('2026-11-19T10:00:00.000+08:00')
  let jobStarted = false

  const jobs = {
    start() {
      jobStarted = true
      return 'run-test'
    },
    status: () => { throw new Error('unused') },
    lastReport: () => null,
  } as unknown as ReportJobs

  const ctx = fakeContext({ jobs })

  // Manually grab the callback before dispose
  let callback: (() => void) | undefined
  const dispose = armSchedule(ctx, {
    now: () => currentTime,
    setTimeout: (cb) => {
      callback = cb
      return 123 as unknown as TimerHandle
    },
    clearTimeout: () => {},
  })

  dispose()
  assert.ok(callback)
  callback()
  assert.equal(jobStarted, false)
})
