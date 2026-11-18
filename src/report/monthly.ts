export interface WeekCounts {
  title: string
  date: string
  created: number
  closed: number
  overdue: number
  highRisk: number
  missing: boolean
}

const WEEK_TITLE_RE = /^周报 (\d{4}-\d{2}-\d{2})$/
const BOUNDARY_RE = /^(?:周报 \d{4}-\d{2}-\d{2}|月报 \d{4}-\d{2})$/
const CREATED_RE = /^新建：(\d+)$/
const CLOSED_RE = /^关闭：(\d+)$/
const OVERDUE_RE = /^逾期：(\d+)$/
const HIGH_RISK_RE = /^高风险变动：(\d+)$/

interface RawSection {
  title: string
  date: string
  lines: string[]
}

export function parseWeeks(docText: string, month: string): WeekCounts[] {
  const lines = docText.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
  const rawSections: RawSection[] = []
  let current: RawSection | null = null

  for (const line of lines) {
    if (BOUNDARY_RE.test(line)) {
      if (current) {
        rawSections.push(current)
        current = null
      }
      const m = line.match(WEEK_TITLE_RE)
      if (m) {
        current = {
          title: line,
          date: m[1],
          lines: []
        }
      }
    } else if (current) {
      current.lines.push(line)
    }
  }

  if (current) {
    rawSections.push(current)
  }

  const prefix = `${month}-`
  const seenTitles = new Set<string>()
  const result: WeekCounts[] = []

  for (const section of rawSections) {
    if (!section.date.startsWith(prefix)) {
      continue
    }
    if (seenTitles.has(section.title)) {
      continue
    }
    seenTitles.add(section.title)

    let created: number | undefined
    let closed: number | undefined
    let overdue: number | undefined
    let highRisk: number | undefined

    for (const line of section.lines) {
      if (created === undefined) {
        const m = line.match(CREATED_RE)
        if (m) {
          created = Number.parseInt(m[1], 10)
          continue
        }
      }
      if (closed === undefined) {
        const m = line.match(CLOSED_RE)
        if (m) {
          closed = Number.parseInt(m[1], 10)
          continue
        }
      }
      if (overdue === undefined) {
        const m = line.match(OVERDUE_RE)
        if (m) {
          overdue = Number.parseInt(m[1], 10)
          continue
        }
      }
      if (highRisk === undefined) {
        const m = line.match(HIGH_RISK_RE)
        if (m) {
          highRisk = Number.parseInt(m[1], 10)
          continue
        }
      }
    }

    const missing = created === undefined || closed === undefined || overdue === undefined || highRisk === undefined

    result.push({
      title: section.title,
      date: section.date,
      created: created ?? 0,
      closed: closed ?? 0,
      overdue: overdue ?? 0,
      highRisk: highRisk ?? 0,
      missing
    })
  }

  result.sort((a, b) => a.date.localeCompare(b.date))
  return result
}

export function renderMonthly(month: string, weeks: WeekCounts[]): string {
  const sortedWeeks = [...weeks].sort((a, b) => a.date.localeCompare(b.date))
  const sumCreated = sortedWeeks.reduce((acc, w) => acc + w.created, 0)
  const sumClosed = sortedWeeks.reduce((acc, w) => acc + w.closed, 0)
  const sumHighRisk = sortedWeeks.reduce((acc, w) => acc + w.highRisk, 0)
  const lastOverdue = sortedWeeks.length > 0 ? sortedWeeks[sortedWeeks.length - 1].overdue : 0

  let note = '说明：新建合计与关闭合计是各周次数相加。高风险变动合计也是各周次数相加，同一议题跨周会重复计入。月末逾期取该月最后一份周报的逾期数，不是各周相加。'
  for (const w of sortedWeeks) {
    if (w.missing) {
      note += `周报 ${w.date} 缺少计数，按 0。`
    }
  }

  const header = [
    `月报 ${month}`,
    `来源：本文档中标题日期属于 ${month} 的周报`,
    `周次：${sortedWeeks.length}`,
    `新建合计：${sumCreated}`,
    `关闭合计：${sumClosed}`,
    `高风险变动合计：${sumHighRisk}`,
    `月末逾期：${lastOverdue}`,
    note
  ]

  if (sortedWeeks.length === 0) {
    return header.join('\n')
  }

  const rows = sortedWeeks.map(
    (w) => `周报 ${w.date}  新建 ${w.created}  关闭 ${w.closed}  逾期 ${w.overdue}  高风险变动 ${w.highRisk}`
  )

  return [...header, '', ...rows].join('\n')
}
