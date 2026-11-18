export const RISK_LEVELS = ['low', 'medium', 'high'] as const
export type RiskLevel = typeof RISK_LEVELS[number]

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'risk::low',
  medium: 'risk::medium',
  high: 'risk::high',
}

export const RISK_META: Record<RiskLevel, { color: string, description: string }> = {
  low: { color: '#1F883D', description: 'Keel 风险：低' },
  medium: { color: '#D4A017', description: 'Keel 风险：中' },
  high: { color: '#CF222E', description: 'Keel 风险：高' },
}

const RANK: RiskLevel[] = ['high', 'medium', 'low']
const ALL = RANK.map(level => RISK_LABELS[level])

export function parseRisk(labels: readonly { name: string }[]): {
  risk: RiskLevel | null
  riskConflict: boolean
  unrecognized: boolean
} {
  const names = labels.map(label => label.name)
  const present = RANK.filter(level => names.includes(RISK_LABELS[level]))
  const unrecognized = names.some(name => name.startsWith('risk::') && !ALL.includes(name))
  if (present.length === 0) return { risk: null, riskConflict: false, unrecognized }
  if (present.length === 1) return { risk: present[0] ?? null, riskConflict: false, unrecognized }
  return { risk: present[0] ?? null, riskConflict: true, unrecognized }
}

export function riskUpdate(
  current: readonly string[],
  target: RiskLevel | 'none',
): { add_labels?: string, remove_labels: string } | null {
  const wanted = target === 'none' ? [] : [RISK_LABELS[target]]
  const have = ALL.filter(name => current.includes(name))
  const same = have.length === wanted.length && wanted.every(name => have.includes(name))
  if (same) return null
  if (target === 'none') return { remove_labels: ALL.join(',') }
  return {
    add_labels: RISK_LABELS[target],
    remove_labels: ALL.filter(name => name !== RISK_LABELS[target]).join(','),
  }
}

export function dueDateUpdate(current: string | null, next: string): { due_date: string } | null {
  const normalized = next === '' ? null : next
  if (current === normalized) return null
  return { due_date: next }
}

export function stateUpdate(
  current: 'opened' | 'closed',
  next: 'opened' | 'closed',
): { state_event: 'close' | 'reopen' } | null {
  if (current === next) return null
  return { state_event: next === 'closed' ? 'close' : 'reopen' }
}

export function parseDueInput(value: string): string {
  if (value === '') return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('bad date')
  }
  const [year, month, day] = value.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) throw new Error('bad date')
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('bad date')
  }
  return value
}
