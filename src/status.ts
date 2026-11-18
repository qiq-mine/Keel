export const STATUS_LEVELS = ['done', 'blocked', 'doing', 'todo'] as const
export type StatusLevel = typeof STATUS_LEVELS[number]

export const STATUS_LABELS: Record<StatusLevel, string> = {
  todo: 'status::todo',
  doing: 'status::doing',
  blocked: 'status::blocked',
  done: 'status::done',
}

export const STATUS_META: Record<StatusLevel, { color: string, description: string }> = {
  todo: { color: '#57606A', description: 'Keel 状态：待办' },
  doing: { color: '#0969DA', description: 'Keel 状态：进行中' },
  blocked: { color: '#BC4C00', description: 'Keel 状态：阻塞' },
  done: { color: '#1A7F37', description: 'Keel 状态：完成' },
}

const ALL = STATUS_LEVELS.map(level => STATUS_LABELS[level])

export function parseStatus(labels: readonly { name: string }[]): {
  status: StatusLevel | null
  statusConflict: boolean
  unrecognized: boolean
} {
  const names = labels.map(label => label.name)
  const present = STATUS_LEVELS.filter(level => names.includes(STATUS_LABELS[level]))
  const unrecognized = names.some(name => name.startsWith('status::') && !ALL.includes(name))
  if (present.length === 0) return { status: null, statusConflict: false, unrecognized }
  if (present.length === 1) return { status: present[0] ?? null, statusConflict: false, unrecognized }
  return { status: present[0] ?? null, statusConflict: true, unrecognized }
}

export function statusUpdate(
  current: readonly string[],
  target: StatusLevel | 'none',
): { add_labels?: string, remove_labels: string } | null {
  const wanted = target === 'none' ? [] : [STATUS_LABELS[target]]
  const have = ALL.filter(name => current.includes(name))
  const same = have.length === wanted.length && wanted.every(name => have.includes(name))
  if (same) return null
  if (target === 'none') return { remove_labels: ALL.join(',') }
  return {
    add_labels: STATUS_LABELS[target],
    remove_labels: ALL.filter(name => name !== STATUS_LABELS[target]).join(','),
  }
}

export function columnModeOf(hits: { todo: number, doing: number, blocked: number, done: number }): 'status' | 'state' {
  return hits.todo + hits.doing + hits.blocked + hits.done > 0 ? 'status' : 'state'
}
