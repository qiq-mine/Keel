# Keel 第二阶段：企业微信周报设计

本文是 Keel 第二阶段（企业微信周报与月报）的实现设计。主设计 [2026-11-18-keel-design.md](2026-11-18-keel-design.md) 第 7 节已经定下周报写进企业微信文档、周五 10:00 定时、补跑、小节替换和月报。本文在这个基础上，对照 main 上已合并的看板代码（PR #3，提交 `a855668`），写清楚这一阶段要新增哪些模块、正文多出哪几段、界面怎样先预览再写入，以及怎样拆成可以逐个交给 Kimi Code CLI 的小任务。

本文与主设计不一致的地方都列在第 12 节。实现分支在最后一个任务里同步修改主设计第 7 节，不让两份文档长期矛盾。本文件所在的提交只有设计，不含代码。

## 1. 目标与非目标

### 目标

1. 把看板上禁用的「立即生成本周周报」做成可用：先在界面里预览每个仓库这一周的小节正文，成员确认后才写入企业微信文档。
2. 每个允许项目对应一份长期保留的企业微信普通文档，按主设计第 7 节的命名、查找、`docid` 解析和小节替换规则写入 `周报 F` 小节。
3. 小节正文保留主设计的四项计数（新建、关闭、逾期、高风险变动），并加上当前快照（进行中、阻塞、当前高风险）和按负责人的分布。
4. 该月最后一个周五写入或替换 `月报 YYYY-MM`，只汇总文档里已有的周小节。
5. `dsh web` 运行期间，周五 10:00（Asia/Shanghai）自动运行，启动时按补跑规则处理刚过去的周五。
6. 设置页显示企业微信连接健康，标题栏显示最近一次周报结果。
7. GitLab 令牌、企业微信 Secret 和 `access_token` 不出现在日志、Remote 响应、工具结果和仓库文件里。

### 非目标

- 不给 agent 增加写企业微信的工具，也不在 system prompt 里放周报。主设计第 10 节已经禁止。
- 不改 GitLab 上的任何议题。周报对 GitLab 只读。
- 不用本地数据库、`tasks.json` 或文件记住「这一周写过没有」或 `docid`。幂等只看文档里的标题。
- 不做智能表格、每周新开一份文档、飞书或邮件导出。
- 不做跨进程锁。仍假定一组只跑一个 `dsh web`。
- 不做历史周批量回补。错过不止一个周五时，只按补跑规则处理最近的那个。
- 不做企业微信群机器人推送。用户已确认周报只写企业微信文档（见第 8 节）。

## 2. 现状：main 上已经有什么

下面这些已经合并，第二阶段直接复用，不重写：

| 位置 | 已有内容 | 第二阶段怎么用 |
| --- | --- | --- |
| `src/config.ts` | `wecomCorpId`、`wecomSecretRef`（默认 `KEEL_WECOM_SECRET`）、`wecomSpaceId`、`wecomFatherId` 四个 volatile 字段和校验 | 原样复用。不新增配置字段。 |
| `src/operations.ts` `setWecomSecret` / `clearWecomSecret` | 通过 `ctx.credentials.set/unset` 保存 Secret | 原样复用。读取只走 `ctx.resolve(wecomSecretRef)`。 |
| `src/operations.ts` `connection` | `wecomHealth` 写死 `'unconfigured'`，`lastReport` 写死 `null` | 改成真实的健康检查和最近结果，见第 9 节。 |
| `src/model.ts` `KeelConnection.lastReport` | `{ at, written, skipped, failed }` | 形状不变。由进程内存里最近一次 `ReportResult` 按项目聚合成这四个数，完整结果另走第 7 节的 `reportStatus`。 |
| `src/model.ts` `KeelIssue`、`src/gitlab/map.ts` `mapIssue` | 只保留 `updatedAt`，丢掉了 `created_at` 和 `closed_at` | `KeelIssue` 不改。周报另定义 `ReportIssue`（第 10 节），在 `map.ts` 加 `mapReportIssue`，保留 `createdAt`、`closedAt`。 |
| `src/errors.ts` | 已有 `keel/wecom-not-configured` | 新增第 10 节列出的错误码。 |
| `src/gitlab/http.ts` `assertAllowed` | GET 已允许 `/projects/:id/issues` 和 `/projects/:id/issues/:iid/resource_label_events` | 不放宽路径。新增的只是这些 GET 的查询参数。 |
| `src/gitlab/api.ts` `collect` | 分页到 20 页，超出则抛错 | 周报需要「截断但继续」，新增一个返回 `truncated` 的变体。 |
| `src/tools.ts` `WRITE_TOOLS` + `bindPreExecute` | agent 写工具走 `tools/pre-execute` 的 `ask` | 不新增工具，`WRITE_TOOLS` 不变。 |
| `src/index.ts` | `ctx.effect` 里注册工具和批准钩子 | 同一个 `ctx.effect` 里再武装周五定时器，卸载时取消。 |
| `src/client/view.tsx:98` | 「立即生成本周周报」按钮写死 `disabled` | 接上预览对话框，见第 7 节。 |
| `src/remote.ts` | 手写的严格 Remote 描述符，`tests/remote.test.ts` 核对方法名 | 新增两个方法的描述符，测试同步加上。 |

DSH 0.2.2-rc.1 已安装的包里（`cordis`、`dsh-agent`、`dsh-credentials`、`dsh-tools`、`dsh-typert-protocol`、`dsh-timeout` 等）没有计划任务或 cron 服务，`dsh-timeout` 只做超时信号。所以定时只能是插件自己在 `ctx.effect` 里武装的进程内定时器，这和主设计第 7 节一致，见第 6 节。

## 3. 用户流程

### 立即生成

1. 标题栏或设置里按「立即生成本周周报」。GitLab 未连接或企业微信未配置时按钮禁用，`title` 写明原因：「尚未配置 GitLab 连接」或「尚未配置企业微信」。
2. 弹出「本周周报预览」对话框，显示 `周报 F`、窗口和「生成于」。Host 对允许集合里每个未归档项目只读 GitLab，按第 4、5 节算出小节正文，不联系企业微信。
3. 对话框按项目列出正文（等宽 `<pre>`），每个项目一个可折叠段落，顶部有四项计数合计。是月末最后一个周五时，另提示「本次还会写入或替换 月报 YYYY-MM」。
4. 成员按「写入企业微信」才开始写。按「取消」或 Esc 关闭对话框，什么都不写。
5. 写入时 Host 重新从 GitLab 生成一次正文，不使用浏览器传回的文本。但窗口终点和比较基准沿用预览的时刻 `asOf`：写入请求带上预览返回的 `asOf`，Host 用 `min(asOf, F 当天 10:00)` 作为窗口终点，所以预览后几分钟再确认，窗口不会漂移。`asOf` 早于现在 30 分钟以上、晚于现在，或与现在不属于同一个 `F` 时拒绝写入，错误 `keel/report-stale`，界面提示重新预览。逾期和当前快照仍按写入时刻读取。生成过程中按钮不可再次按下。
6. 结束后对话框按项目列出「已写入」「已跳过（内容相同）」或失败文案，以及月报的 `written`、`skipped`、`not-due` 或 `failed`。写入时的计数与预览时不同（例如预览后有人关闭了一条议题），就在该项目旁标「数据在预览后有变化，已按最新数据写入」。
7. 完整结果留在 Host 进程内存，`connection().lastReport` 只返回聚合后的时间和三个计数。进程重启后丢失。

### 计划运行与补跑

按主设计第 7 节「定时器与补跑」执行，不经过预览，也不需要任何人点确认。结果同样写进进程内存的最近一次结果。

## 4. 周标识、窗口与口径

时区、周标识 `F`、窗口起点和终点、闭区间比较、月末最后一个周五的判定，全部沿用主设计第 7 节，包括那张六行例子表。本文不重复，实现和测试以那张表为准。

本文补两条。第一，立即生成的「运行时刻」在写入时取预览的 `asOf`，见第 3 节。第二，`生成于` 是本次实际运行时刻在 Asia/Shanghai 的 `YYYY-MM-DD HH:mm:ss`。比较「正文是否相同」时去掉 `生成于：` 开头的那一行再比。否则每次立即生成的时刻都不同，「相同则跳过」永远不会成立。

## 5. 统计内容

所有统计都限定在一个项目里，查询都走已允许的 `GET /projects/:id/issues` 和 `GET /projects/:id/issues/:iid/resource_label_events`，带 `with_labels_details=true`，`per_page=100`，最多 20 页（2000 条）。到第 20 页还有下一页时，该段标为截断并继续生成，不让整个项目失败。

### 窗口内的变化（主设计原有四项）

| 段 | GitLab 查询 | 本地复核 |
| --- | --- | --- |
| 新建 | `state=all&created_after=起点&created_before=终点` | `created_at` 落在窗口闭区间内 |
| 关闭 | `state=closed&updated_after=起点&updated_before=运行时刻` | `closed_at` 非空且落在窗口内 |
| 逾期 | `state=opened&due_date=overdue` | 无。这是运行时刻的快照 |
| 高风险变动 | `state=all&updated_after=起点&updated_before=运行时刻`，再对每条读 `resource_label_events` | 只保留 `label.name === 'risk::high'`、`action` 为 `add` 或 `remove`、事件 `created_at` 在窗口内的事件；计事件条数 |

时间参数用 ISO 8601 带 `+08:00` 偏移，例如 `2026-11-16T00:00:00.000+08:00`。

高风险变动每条议题要多读一次标签事件，这是整次运行里请求最多的一步。GitLab 没有按标签事件筛议题的接口，而且「去掉 risk::high」的议题现在已经不带这个标签，所以不能只读当前高风险议题。控制办法：

- 同一项目里事件读取最多 4 个并发，项目之间串行。每次请求 15 秒超时，事件超过一页继续翻页，最多 20 页。
- 读接口遇到 429 沿用现有 `GitLabHttp` 的一次重试。
- 整次运行是后台任务（第 7 节），不受单次 Remote 调用时长限制，界面显示进度「已完成 3 / 12 个仓库」。

按团队 5 到 15 人估算，一周更新的议题通常是几十到一两百条，几十秒内能完成。

### 当前快照（第二阶段新增）

快照描述的是运行时刻的状态，不是窗口内的变化：

| 段 | GitLab 查询 | 说明 |
| --- | --- | --- |
| 进行中 | `state=opened&labels=status::doing` | 只在该项目是状态模式时出现 |
| 阻塞 | `state=opened&labels=status::blocked` | 只在该项目是状态模式时出现 |
| 当前高风险 | `state=opened&labels=risk::high` | 所有项目都有 |

列模式用已有的 `GitLabApi.columnModes` 判定。开关模式的项目不出现进行中和阻塞两段，改为一行 `（该仓库未使用状态标签，不统计进行中和阻塞）`。

### 按负责人

把新建、关闭、逾期、进行中、阻塞、当前高风险六段里的议题按 `assignees` 分组计数。开关模式的项目每行只写 `新建 X 关闭 X 逾期 X 高风险 X`，不写进行中和阻塞，也不写成 0。一个议题有多个负责人时，每人各计一次。没有负责人的计入「未分配」。按负责人显示名的 Unicode 码点升序，「未分配」排最后。显示名使用 GitLab 返回的 `name`，不显示 `username` 以外的个人信息。保密议题照常计数，因为计数不暴露标题。

### 列表格式

沿用主设计：每段按 `iid` 升序；标题换行改空格，去首尾空白，超过 120 个字符截断加 `…`；链接用 `web_url`；空段写 `（无）`；`confidential` 为真的议题不写标题、编号和链接，只在小节末尾写 `已省略保密议题：N`，N 是这一小节各段里去重后的保密议题数。

为了让一节正文有上限，每段最多列 100 条议题。超过时列前 100 条，再加一行 `（另有 N 条未列出）`。计数行仍是全量数字。

## 6. 正文格式

企业微信文档正文是纯文本，行与行之间用 `\n`。在主设计的样例后面追加快照和负责人两段。前六行的格式和四行计数的写法与主设计完全一致，月报解析不需要改。

```text
周报 2026-11-20
窗口：2026-11-16 00:00:00 至 2026-11-20 10:00:00（Asia/Shanghai）
生成于：2026-11-20 10:00:00
新建：1
关闭：0
逾期：1
高风险变动：1

新建
- acme/app#12 登录失败 https://gitlab.example.com/acme/app/-/issues/12

关闭
（无）

逾期
- acme/app#9 导出超时 https://gitlab.example.com/acme/app/-/issues/9

高风险变动
- acme/app#4 支付重试 https://gitlab.example.com/acme/app/-/issues/4
  2026-11-18 14:02:11 加上 risk::high

当前快照
进行中：2
阻塞：1
当前高风险：1

进行中
- acme/app#4 支付重试 https://gitlab.example.com/acme/app/-/issues/4
- acme/app#7 权限页改版 https://gitlab.example.com/acme/app/-/issues/7

阻塞
- acme/app#9 导出超时 https://gitlab.example.com/acme/app/-/issues/9

当前高风险
- acme/app#4 支付重试 https://gitlab.example.com/acme/app/-/issues/4

按负责人
- 张三：新建 1 关闭 0 逾期 0 进行中 1 阻塞 0 高风险 0
- 王五：新建 0 关闭 0 逾期 1 进行中 1 阻塞 1 高风险 1
- 未分配：新建 0 关闭 0 逾期 0 进行中 0 阻塞 0 高风险 0

已省略保密议题：0
```

`已省略保密议题：N` 始终是小节最后一行。快照的三个计数行用 `进行中：`、`阻塞：`、`当前高风险：`，与月报解析的四个计数前缀不重名。

新文档的页眉、小节定位、替换范围、`batch_update` 的两个操作、月报格式和月报只汇总四项计数，都沿用主设计第 7 节。月报不汇总快照和负责人，因为它们是时点数据，相加没有意义。

## 7. 预览与界面

### 新的 Remote 方法

一次周报可能要几十秒，不能挂在一次 Remote 调用上等。所以生成做成 Host 进程内的后台任务，浏览器轮询状态。在 `KeelService` 上新增两个 `@Remote`，并在 `src/remote.ts` 写严格描述符：

| 方法 | 作用 | 返回 |
| --- | --- | --- |
| `reportStart(mode, asOf)` | `mode` 为 `preview` 或 `write`。`preview` 对 GitLab 只读，不联系企业微信，`asOf` 传空字符串，由 Host 取当前时刻。`write` 必须带预览返回的 `asOf`。任务排进第 11 节的串行队列 | `{ runId: string }` |
| `reportStatus(runId)` | 查询任务状态 | `{ state: 'queued' \| 'running' \| 'done' \| 'failed', progress: { done: number, total: number }, preview: ReportPreview \| null, result: ReportResult \| null, message: string \| null }` |

`runId` 是随机 UUID。Host 只保留最近 10 个任务的状态，过期的 `runId` 返回 `keel/not-found`。浏览器每秒轮询一次，对话框关闭即停止轮询；关闭对话框不取消已经开始的写入。

```ts
interface ReportCounts {
  created: number
  closed: number
  overdue: number
  highRiskEvents: number
  doing: number | null      // 开关模式为 null
  blocked: number | null
  highRiskNow: number
}

interface ReportPreview {
  asOf: string               // 预览时刻，写入时原样带回
  weekTitle: string          // 周报 2026-11-20
  windowStart: string        // ISO，带 +08:00
  windowEnd: string
  generatedAt: string
  monthlyDue: boolean
  monthlyTitle: string | null
  projects: { projectId: number, projectPath: string, text: string, counts: ReportCounts, truncated: boolean }[]
  failed: { projectId: number, projectPath: string, message: string }[]
}

interface ReportResult {
  kind: 'manual' | 'scheduled' | 'catch-up'
  weekTitle: string
  finishedAt: string
  projects: {
    projectId: number
    projectPath: string
    weekly: 'written' | 'skipped' | 'failed'
    monthly: 'written' | 'skipped' | 'not-due' | 'failed'
    message: string | null   // 失败时的中文文案，不含秘密
    docUrl: string | null    // 企业微信返回的文档链接，便于打开
    counts: ReportCounts | null
  }[]
}
```

预览不缓存。每次打开对话框重新算。预览里某个项目的 GitLab 读取失败时，该项目放进 `failed`，其他项目照常显示。

### 组件

- `view.tsx` 的按钮去掉 `disabled`，改由 `connection.configured && connection.gitlabHealth === 'ok' && connection.wecomConfigured` 决定，禁用时 `title` 写明原因。
- 新增 `ReportDialog`：加载中、预览、写入中、结果四种状态。焦点进入对话框，Esc 关闭（写入中不关闭）。写入中「写入企业微信」按钮禁用。
- 对话框里的文本按纯文本渲染，不解析为 HTML 或 Markdown，避免议题标题注入标记。
- 预览和写入期间显示进度「已完成 3 / 12 个仓库」。
- 标题栏在按钮旁显示 `connection.lastReport`：「上次周报：11-20 10:00 写入 3 跳过 1 失败 0」。

## 8. 企业微信群机器人推送：不做

用户已确认：周报只写企业微信文档，不向群机器人推送摘要。第二阶段不新增 webhook 配置字段、凭据引用或 `webhook/send` 路径。以后如果需要群通知，另写设计再做。

## 9. 写入、批准与连接健康

### 谁批准写入

| 触发 | 写企业微信前要不要 DSH 批准 | 理由 |
| --- | --- | --- |
| 界面「写入企业微信」 | 不弹 DSH 批准框。预览对话框里的确认就是成员本人的确认 | 与主设计第 8 节一致：看板 Remote 的写入就是成员的操作。DSH 的批准机制是 `tools/pre-execute`，只作用于 agent 的工具调用，Remote 调用不经过它。 |
| 周五定时、启动补跑 | 不批准 | 主设计第 8 节。配置者填好企业微信即表示同意按周写入。 |
| Agent | 没有工具，写不了 | 主设计第 10 节禁止给 agent 写企业微信的工具。`WRITE_TOOLS` 不变。 |

以后如果要让 agent 触发周报，必须新增一个写工具并加入 `WRITE_TOOLS`，在 `tools/pre-execute` 返回 `ask`，只有 `allowed-once` 才写。这不在第二阶段。

### 连接健康

企业微信健康与 GitLab 健康互相独立。`connection()` 先算出企业微信是否四项都配置，配置齐全就调用一次 `gettoken`，不管 GitLab 未配置、检查失败还是成功。现有代码在 GitLab 未配置或出错时提前 `return`，实现时要把企业微信检查放到这些分支之前，或在每个返回分支里都带上它：

- 成功：`wecomHealth: 'ok'`，`wecomHealthDetail: null`。
- `errcode` 非 0 或 `access_token` 为空：`'error'`，文案「企业微信 Secret 无效或应用未授权」。
- 网络失败：`'error'`，文案「无法连接企业微信」。

健康检查不调用 `file_list`、`create_doc` 或任何写接口。`access_token` 放进第 10 节的进程内缓存。

## 10. 模块、错误与秘密

### 新增模块

| 文件 | 职责 |
| --- | --- |
| `src/report/clock.ts` | 周标识、窗口、最后一个周五、下一次计划时刻、补跑判断、Asia/Shanghai 格式化。纯函数，`now` 由参数传入。 |
| `src/report/collect.ts` | 调 `GitLabApi` 的周报查询，得到每个项目的 `ReportData`（各段 `ReportIssue`、事件、计数、截断标记）。只依赖一个窄接口 `ReportSource`，测试里可以换成假实现。 |
| `src/report/render.ts` | `ReportData` → 小节纯文本；比较用的「去掉生成于」文本。纯函数。 |
| `src/report/monthly.ts` | 从文档全文解析周小节计数，渲染月报。纯函数。 |
| `src/report/run.ts` | 一次运行的编排：串行队列、逐项目生成和写入、汇总 `ReportResult`、最近一次结果。 |
| `src/report/schedule.ts` | 武装和取消周五定时器、启动补跑。 |
| `src/wecom/http.ts` | 企业微信 HTTP：主机与路径白名单、无跳转、系统信任库、15 秒超时、`access_token` 缓存、重试规则、`errcode` 映射、日志脱敏。 |
| `src/wecom/docs.ts` | 文档名、查找或创建、`docid` 解析、`document/get` 拼文本与下标校验、小节范围、`batch_update`。 |

周报用自己的议题投影，不改 `KeelIssue`：

```ts
interface ReportIssue {
  projectId: number
  projectPath: string
  iid: number
  title: string
  confidential: boolean
  webUrl: string | null
  assignees: { id: number, name: string }[]
  createdAt: string
  closedAt: string | null
}
```

`src/gitlab/api.ts` 新增 `reportIssues(projectId, params, projects, signal)` 和 `labelEvents(projectId, iid, projects, signal)`。`reportIssues` 只接受这些查询键：`state`、`created_after`、`created_before`、`updated_after`、`updated_before`、`due_date`、`labels`、`order_by`、`sort`、`with_labels_details`、`per_page`、`page`，其他键在发出前拒绝。项目不在允许集合时拒绝。返回 `{ issues: ReportIssue[], truncated }`，不在第 20 页抛错。

`file_list` 按官方的 `start` / `limit` 分页（`limit` 取 1000），跟随响应的 `has_more` 和 `next_start` 直到没有下一页，最多 20 页。到第 20 页仍有下一页时该项目失败，错误 `keel/wecom-ambiguous-doc`，不创建文档，因为看不全目录就无法保证不重复创建。

企业微信 HTTP 只允许：`GET /cgi-bin/gettoken`、`POST /cgi-bin/wedrive/file_list`、`POST /cgi-bin/wedoc/create_doc`、`POST /cgi-bin/wedoc/document/get`、`POST /cgi-bin/wedoc/document/batch_update`。企业微信永远不用 `allowSelfSigned`。

### 新增错误码

加进 `KEEL_CODES`、`KEEL_MESSAGES` 和 `service.ts` 的 `RemoteErrorDetailsMap`：

| 码 | 中文文案 | 何时 |
| --- | --- | --- |
| `keel/wecom-unavailable` | 无法连接企业微信 | 网络失败、超时、5xx、重试后仍限流 |
| `keel/wecom-unauthorized` | 企业微信 Secret 无效或应用未授权 | `gettoken` 失败；`access_token` 过期且重新获取仍失败 |
| `keel/wecom-forbidden` | 企业微信应用缺少文档或微盘权限 | `errcode` 属于无权限一类 |
| `keel/wecom-ambiguous-doc` | 目录里有多份同名文档 | 主设计第 7 节 |
| `keel/wecom-docid-unreadable` | 无法读取该项目的企业微信文档 | 主设计第 7 节 |
| `keel/wecom-doc-index` | 文档内容下标对不上，未做修改 | 主设计第 7 节 |
| `keel/wecom-rejected` | 企业微信拒绝了这次写入 | 其他非 0 `errcode`；文案后附 `（errcode N）`，不附 `errmsg` 里可能出现的参数 |
| `keel/report-stale` | 预览已过期，请重新预览 | 第 3 节的 `asOf` 校验失败 |

`access_token` 失效（`errcode` 40014 或 42001）时清掉缓存，重新 `gettoken` 一次并重试该请求一次。

### 失败的范围

- 一个项目失败不影响其他项目。结果里该项目 `weekly: 'failed'`，`monthly` 不写。
- `gettoken` 失败时所有项目都失败，不调用其他企业微信接口。
- GitLab 读取失败时该项目不联系企业微信。
- 任何失败都不删除文档里已有的内容。替换只用一次 `batch_update`，官方保证一批要么都生效要么都不生效。

### 秘密

- Secret 每次运行通过 `ctx.resolve(wecomSecretRef)` 现取，只放进 `gettoken` 的查询参数。
- `access_token` 只在进程内存里，到期前 120 秒失效，不写盘，不进 Remote 响应。
- 企业微信日志只写 `方法 路径 状态码 errcode=N`，不写查询串和请求体。`src/wecom/http.ts` 的日志函数在输出前把 `access_token=`、`corpsecret=`、`key=` 后面的值替换成 `***`，作为第二道防线。
- 错误对象的 `message` 来自固定文案，不拼接上游 `errmsg`。
- 测试里用明显的假值（`test-wecom-secret`、`test-access-token`），并断言日志、错误、Remote 返回值里都搜不到它们。

## 11. 定时

DSH 0.2.2 没有计划任务服务，因此第二阶段的定时是插件进程内的定时器，只在 `dsh web` 运行期间有效。这是主设计已经接受的做法，第二阶段实现它，但放在最后一个功能任务里，前面的任务做完就能手动使用。

- 在 `apply` 的同一个 `ctx.effect` 里调用 `armSchedule`，返回的清理函数里取消定时器。
- 定时器不一次睡到周五。每次最多睡 1 小时，醒来重新计算到下一个周五 10:00 的距离，避免机器休眠或系统时间调整后错过或提前触发。
- 回调时刻距离计划时刻不超过 60 秒才按计划运行；超过则走补跑规则。与主设计第 7 节相同。
- 启动时只做补跑判断。补跑在 `ctx.effect` 里异步执行，不阻塞 `apply` 返回，失败只写进最近结果和日志。
- 同一进程内所有运行串行：定时回调、补跑、预览和立即生成进同一个队列，后到的任务状态为 `queued`，等前一个结束再跑。重复按下由界面禁用按钮挡掉，Host 不另设「忙」错误。
- 企业微信未配置时，定时器照常武装，但回调直接记一条「尚未配置企业微信」结果，不联系 GitLab 和企业微信。

## 12. 对主设计第 7 节的修订

实现分支的最后一个任务按下面几条修改主设计，并在 README 里删掉「周报留到下一版」的说法：

1. 立即生成先预览，成员确认后才写（主设计原文是按下即写）。写入沿用预览时刻作为窗口终点。
2. 生成是后台任务，Remote 只负责启动和查询状态。
3. 小节正文在四项计数和四段列表之后，增加「当前快照」和「按负责人」两段；`已省略保密议题` 仍是最后一行。
4. 比较正文是否相同时忽略 `生成于：` 行。
5. 每段最多列 100 条，超出写 `（另有 N 条未列出）`；计数仍是全量。
6. 某段被 2000 条截断时继续生成，不让项目失败；在该段标题下写主设计规定的截断说明。
7. 设置页的企业微信健康由一次 `gettoken` 决定，与 GitLab 健康互不影响。
8. `file_list` 必须翻完所有页再判断文档是否存在。
9. 定时器分段睡眠，每次最多 1 小时。

## 13. 测试计划

默认测试命令（`npm test`）不访问真实 GitLab 或企业微信。所有外部请求都通过注入的 `fetch` 打到脚本化的假服务，写法沿用 `tests/gitlab-api.test.ts` 的 `scripted(routes)`。

### 样本

放在 `tests/fixtures/report/`，不从网络现拉：

- `issues-week.json`：一组覆盖各种边界的 GitLab 议题，包括窗口起点整点创建、起点前 1 毫秒创建、窗口内关闭又重开（`closed_at` 为空）、保密议题、无负责人、两个负责人、标题含换行和超过 120 字、没有 `web_url`。
- `label-events.json`：同一议题先加后去 `risk::high`、窗口外事件、`risk::medium` 事件、窗口终点后 1 毫秒的事件。
- `wecom-file-list.json`：零条、一条、两条同名、`file_status` 不为 1、`file_type` 不为 3、目标文档在第二页。
- `wecom-document-get.json`：含页眉、两份周小节和一份月报的文档；另一份 `end - begin` 与文本长度不一致的坏样本。

### 假企业微信

`tests/helpers/fake-wecom.ts` 实现五个接口，记录每次请求（路径、查询键、请求体），可以配置：`gettoken` 失败、`access_token` 第一次过期、`create_doc` 超时但实际已创建、`batch_update` 第一次失败、限流一次、任意接口返回指定 `errcode`。文档内容保存在假服务内存里，`batch_update` 真的修改它，便于断言最终文本。

### 必须覆盖

- 时钟：主设计第 7 节六行例子；周一 00:00:00.000 计入，前 1 毫秒不计入；周五 10:00:00.000 计入，后 1 毫秒不计入；2026-11-27 写月报，2026-11-20 不写；补跑窗口在周一 10:00:00.000 整点关闭。
- GitLab 查询：每段的查询参数与第 5 节表格一致；`reportIssues` 拒绝白名单外的查询键和允许集合外的项目；第 20 页还有下一页时返回 `truncated: true` 而不抛错。
- 采集：用假 `ReportSource` 驱动 `collect.ts`，断言每段拿到的议题、关闭又重开不计入关闭、窗口外事件被丢弃、截断标记向上传递、事件读取并发不超过 4。
- 统计与正文：样本议题生成的正文与 `tests/fixtures/report/expected-section.txt` 逐字相同；保密议题只进计数和省略行；开关模式项目没有进行中和阻塞两段；按负责人排序和「未分配」；每段 100 条上限。
- 比较：只差 `生成于` 行时判为相同，不调用 `batch_update`。
- 企业微信 HTTP：白名单外的路径和主机被拒；不跟随跳转；`access_token` 缓存到期前 120 秒刷新；40014 时重取一次；限流时读接口等 1 秒重试一次；`create_doc` 超时后再列一次目录、不创建第二份。
- 文档：`file_list` 翻页后才判定存在，目标在第二页时不创建；文档名替换斜杠、超长截断加哈希；`docid` 两步解析；下标对不上时不发删除；替换范围停在下一个 `周报 ` 或 `月报 ` 标题前；新文档先写页眉。
- 月报：四项计数相加、月末逾期取最后一周、缺计数行按 0 并写说明；不汇总快照和负责人。
- 编排：一个项目失败其他项目照常；`asOf` 过期、在未来或跨周时返回 `keel/report-stale`；写入沿用 `asOf` 的窗口终点；`lastReport` 是聚合后的四个字段；任务串行，`reportStatus` 的进度单调增加；`gettoken` 失败时全部失败且没有其他企业微信请求；周报对 GitLab 只发 GET。
- 定时：用注入的时钟和定时器，验证分段睡眠、60 秒判定、补跑只在标题不存在时写、卸载后不再触发。
- 秘密：在所有上面的测试里收集日志、错误 `message`、Remote 返回值，断言搜不到测试 Secret、测试 `access_token`、GitLab 测试令牌。
- 连接健康：GitLab 未配置或出错时，企业微信健康仍按 `gettoken` 结果显示。
- 界面：按钮在未配置时禁用并显示原因；预览出现前不发 `mode: 'write'`；取消不写；写入中按钮禁用；结果列表显示三种状态；正文按纯文本渲染（标题里的 `<b>` 原样显示）。

真实企业微信不进入默认测试。验收时由配置者在测试空间手动跑一次，按第 14 节 T9 的验收标准核对。

## 14. 任务拆分

每个任务都在 `keel-weekly-report` 分支上完成，单独提交，提交前 `npm run build && npm test && npm run lint` 全部通过，`lib/` 跟着源码一起更新。任务按顺序做，后面的任务只依赖前面的。每个任务交给 Kimi Code CLI 时附上本节对应段落和本文相关章节，由 Antigravity CLI 评审 diff，再由我验收。

### T1 周报时钟

- 文件：`src/report/clock.ts`，`tests/report-clock.test.ts`。
- 内容：`weekOf(now)` 返回 `F`、`weekTitle`、窗口起点；`windowEnd(now, kind)`；`isLastFriday(F)`；`monthTitle(F)`；`nextScheduled(now)`；`catchUpTarget(now)`；`formatShanghai(instant)`。不读系统时钟，全部由参数传入。
- 验收：主设计第 7 节六行例子和第 13 节「时钟」各条全部有测试且通过；不引入新依赖。

### T2 GitLab 周报查询

- 文件：`src/gitlab/api.ts`，`tests/gitlab-report.test.ts`。
- 内容：`ReportIssue` 类型、`map.ts` 的 `mapReportIssue`、`reportIssues` 与 `labelEvents`，带查询键白名单、允许集合检查、截断而不抛错的分页。
- 验收：第 13 节「GitLab 查询」各条通过；`assertAllowed` 的路径白名单不变；已有测试（46 个通过、1 个集成测试跳过）仍通过。

### T3 统计与正文

- 文件：`src/report/collect.ts`、`src/report/render.ts`、`tests/report-collect.test.ts`、`tests/report-render.test.ts`、`tests/fixtures/report/*`。
- 内容：第 5 节的全部统计、第 6 节的正文、比较用文本。`collect.ts` 通过 `ReportSource` 接口取数，`GitLabApi` 是它的生产实现。
- 验收：第 13 节「采集」「统计与正文」「比较」各条通过；样本生成的正文与 `expected-section.txt` 逐字相同，状态模式和开关模式各一份期望文本；`render.ts` 不做任何 I/O。

### T4 企业微信 HTTP 客户端

- 文件：`src/wecom/http.ts`、`src/errors.ts`、`src/messages.ts`、`src/service.ts`（错误码映射）、`tests/helpers/fake-wecom.ts`、`tests/wecom-http.test.ts`。
- 内容：第 10 节的白名单、超时、重试、`access_token` 缓存、`errcode` 映射、日志脱敏，以及新增错误码。
- 验收：第 13 节「企业微信 HTTP」与「秘密」各条通过；企业微信客户端的构造参数里没有 `allowSelfSigned`。

### T5 文档定位与小节替换

- 文件：`src/wecom/docs.ts`、`tests/wecom-docs.test.ts`。
- 内容：主设计第 7 节「文档放在哪里、叫什么」「官方接口」「替换哪一节」。替换函数按标题工作（`replaceSection(doc, title, text, policy)`，`policy` 为「不同才替换」或「不存在才写」），周报和月报共用。
- 验收：第 13 节「文档」各条通过；用 `月报 2026-11` 标题调用同一个替换函数也通过范围测试；对假企业微信跑两遍同一份正文，第二遍没有 `batch_update`；任何失败路径都没有 `delete_content` 发出。

### T6 月报

- 文件：`src/report/monthly.ts`、`tests/report-monthly.test.ts`。
- 内容：从文档全文解析周小节四项计数、渲染月报正文。纯函数，不联系企业微信；写入由 T7 调用 T5 的 `replaceSection` 完成。
- 验收：第 13 节「月报」各条通过；输出与主设计第 7 节月报样例逐字一致；解析时忽略快照和负责人两段。

### T7 编排、Remote 与连接健康

- 文件：`src/report/run.ts`、`src/operations.ts`、`src/service.ts`、`src/remote.ts`、`src/model.ts`、`tests/report-run.test.ts`、`tests/remote.test.ts`。
- 内容：`reportStart`、`reportStatus`、后台任务与串行队列、`asOf` 校验、最近一次结果、`connection()` 的企业微信健康和 `lastReport`。
- 验收：第 13 节「编排」「连接健康」通过；`tests/remote.test.ts` 的方法清单包含两个新方法；Remote 返回值通过 `src/remote.ts` 的 zod 描述符校验；周报过程对 GitLab 只有 GET。

### T8 预览界面

- 文件：`src/client/view.tsx`、`src/client/index.tsx`、`tests/view.test.tsx`。
- 内容：第 7 节的按钮状态、`ReportDialog`（含轮询与进度）、标题栏最近结果。
- 验收：第 13 节「界面」各条通过；文案全部是中文；`npm run build` 生成的 `lib/client.js` 能被现有 `tests/bundle.test.ts` 加载。

### T9 定时器、补跑与文档收尾

- 文件：`src/report/schedule.ts`、`src/index.ts`、`tests/report-schedule.test.ts`、`README.md`、`docs/superpowers/specs/2026-11-18-keel-design.md`。
- 内容：第 11 节的定时与补跑；按第 12 节修改主设计；README 增加「企业微信周报」一节（配置、权限、预览、定时只在 `dsh web` 运行时有效）。
- 验收：第 13 节「定时」通过；卸载插件后没有残留定时器（测试里用注入的 `setTimeout`/`clearTimeout` 计数）；README 与主设计不再写「下一版」；在测试企业微信空间手动跑一次立即生成：每个项目一份文档，标题 `周报 F`，再跑一次显示「已跳过」，`dsh` 日志里搜不到 Secret 和 `access_token`。

## 15. 已确认的决定

1. 周报只写企业微信文档，不做群机器人推送（原可选任务 R1 取消）。
2. 保留「按负责人」一段。
