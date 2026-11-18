import type { KeelIssue } from '../model.js'

const STATUS_TEXT = { todo: '待办', doing: '进行中', blocked: '阻塞', done: '完成' } as const
const RISK_TEXT = { low: '低', medium: '中', high: '高' } as const

export function analysisMessage(issue: KeelIssue): string {
  const description = issue.description ?? ''
  const clipped = description.length > 8000
    ? `${description.slice(0, 8000)}（描述已截断，请用工具读取全文）`
    : description
  const names = issue.assignees.map(person => person.name).filter(name => name !== '')
  return [
    '请只读分析这个 GitLab 议题。不要修改议题，除非我在批准里明确允许一次写入。',
    '',
    `仓库：${issue.projectPath}`,
    `议题：#${issue.iid}`,
    `标题：${issue.title}`,
    `开关：${issue.state === 'opened' ? '打开' : '已关闭'}`,
    `状态标签：${issue.status === null ? '未分状态' : STATUS_TEXT[issue.status]}`,
    `截止日期：${issue.dueDate ?? '未设置'}`,
    `风险：${issue.risk === null ? '未评估' : RISK_TEXT[issue.risk]}`,
    `负责人：${names.length === 0 ? '未指派' : names.join('、')}`,
    `链接：${issue.webUrl}`,
    '',
    '描述：',
    clipped,
    '',
    '请用 Keel 的只读工具核对最新内容后再分析。',
  ].join('\n')
}
