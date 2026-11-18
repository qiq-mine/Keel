export const KEEL_MESSAGES = {
  'keel/gitlab-unavailable': '无法连接 GitLab',
  'keel/unauthorized': '令牌无效或已过期',
  'keel/forbidden': '令牌权限不足',
  'keel/not-found': '组、项目或议题不存在，或当前令牌看不到它',
  'keel/rate-limited': 'GitLab 限流，请稍后再试',
  'keel/not-configured': '尚未配置 GitLab 连接',
  'keel/outside-group': '该仓库不在已配置的组内',
  'keel/labels-missing': '令牌不能创建组标签',
  'keel/invalid-input': '输入不符合约定格式',
  'keel/gitlab-tls': 'GitLab 证书不受信任。若这是自建证书，请在设置里打开允许自签证书。',
  'keel/session-unavailable': '无法把议题送到会话',
  'keel/wecom-not-configured': '尚未配置企业微信',
} as const

export const REDIRECT_MESSAGE = '地址被重定向，请把 baseUrl 写成最终源站'
export const GITLAB_DOWN_MESSAGE = 'GitLab 暂时不可用'
export const PROJECT_CAP_MESSAGE = '项目列表超过 2000 个，超出第一版支持的组规模'
export const MEMBER_CAP_MESSAGE = '成员列表超过 2000 人，超出第一版支持的规模'
export const LABEL_CAP_MESSAGE = '标签列表超过 2000 个，超出第一版支持的规模'
export const OVERDUE_PARTIAL_MESSAGE = '逾期标记不完整'
export const OPENED_CAP_MESSAGE = '只显示最近更新的 2000 条打开议题'
export const CLOSED_CAP_MESSAGE = '只显示最近更新的 2000 条已关闭议题'
export const CLOSED_PAGE_MESSAGE = '最近更新的 100 条已关闭议题'
