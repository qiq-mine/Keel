# Keel 设计

本文是 Keel 第一版的产品与技术设计，供后续实现使用。本文件所在的变更只更新设计说明，不加入插件代码。

Keel 是一个 DeepSeek Harness（DSH）插件，安装到团队已有的 `web` profile。它在 DSH Web UI 里提供项目看板，把同一组读、写操作暴露给 DSH agent 的工具，并按仓库把周报、月报追加到企业微信文档。团队规模按 5 到 15 人设计。需求、任务、截止日期、风险和状态都以团队自建 GitLab 的 Issue 为唯一事实来源。企业微信文档是周报导出，不是第二份议题台账。

看板的交互取自这些已有插件里值得留下的部分：`dsh-glab-kanban`、`dsh-ui-kanban`、`dsh-task-board`。留下的是状态列、右侧详情、列表、筛选和把一条议题送进会话。Keel 不依赖这些包，不采用它们的本地任务账本，也不把 Jira 当成数据源。

## 1. 背景、目标与非目标

### 背景

团队已经用自建 GitLab 管理需求、任务、进度和风险，但没有统一的方式在看板上划分状态、标记截止日期和风险，也没有把每周变化写进一份长期保留的企业微信文档。成员需要在 DSH 里直接处理这些议题，而不是再维护一份表格或另一套任务系统。DSH 的扩展方式是 Cordis 插件：插件导出 `apply(ctx)`，通过 `ctx` 注册能力，用 bundle 的 `dsh.bundle` 和 `cordis.patch.yml` 插入组合，再用 `dsh plugin --profile web add` 装进 `web` profile。

### 目标

第一版做成下面这些事：

1. 在 DSH Web UI 增加「项目看板」。列优先使用约定状态标签：`status::todo`、`status::doing`、`status::blocked`、`status::done`。拖拽以及键盘上的同等操作写回这些标签。某个项目的议题上一个这些标签都没有时，该项目回退为「打开」「已关闭」两列，写回 Issue 的 `state`。
2. 在卡片和右侧详情抽屉里设置截止日期，并立刻写回该 Issue 的 `due_date`。
3. 在卡片和抽屉里设置风险：低、中、高，或未评估。风险写回 `risk::low`、`risk::medium`、`risk::high`，并立刻生效。
4. 从看板新建议题，字段是标题、负责人、状态、截止日期和风险，一次写到 GitLab。
5. 看板顶部给出逾期、本周到期、高风险、未评估四项计数，点击即套用对应筛选。筛选还有全文搜索、「只看我的」、一等风险筛选，以及原有的负责人、标签、仓库。
6. 提供看板和列表两种视图。卡片显示评论数和最后更新时间。抽屉展示描述、评论、动态，并可关闭或重新打开议题、在 GitLab 中打开。
7. 可以把一张卡片送到当前会话或一个新会话，只携带这一条议题，供只读分析。Agent 的写入仍须一次 DSH 批准。工具结果在聊天里有可读的议题卡片。Keel 不把整块看板写进每一轮的 system prompt。
8. 设置里配置 GitLab 源站、组路径、令牌和自签证书开关，并显示凭据与连接健康。全组共用这一份 GitLab 连接。
9. 每个 GitLab 仓库对应一份长期保留的企业微信文档。每周五 10:00（Asia/Shanghai）追加该周小节；该月最后一个周五再追加月报。同一周不重复追加。界面上可以立即生成本周周报。

### 非目标

第一版不做这些事，实现时也不要预留半套行为：

- 双向表格同步，以及飞书。
- 把 GitLab Board、Milestone、Merge Request、Epic 或迭代做成一等对象。看板不读取 Board 的列，也不创建或筛选 Milestone。卡片可以只读显示 Issue 响应里已有的里程碑标题。
- 按角色把任务分派给不同 agent，或使用 git worktree。
- 同时配置多个互无隶属关系的 GitLab 组，或按大规模多组部署。
- 依赖 ChunSun、`dsh-pm` 或 `dsh-agent-team`。Keel 只依赖 DSH 本体公开的插件、工具、凭据、审批、会话、设置和 Web 插槽，以及 GitLab REST API 和企业微信官方 HTTP API。
- 在 Keel 里改标题、改描述、改已有议题的负责人、发表评论、上传设计稿、记录工时，或管理机密开关。新建议题时可以指定负责人；那一次写入之后，更换负责人仍不在第一版。
- 每人单独走 GitLab OAuth。第一版是组级共享令牌。
- 把 Webhook 当作同步手段。看板靠打开面板时的拉取和 10 秒刷新。
- 在本地用 SQLite、`tasks.json` 或其他文件保存第二份议题台账。

后文第 10 节把这些边界再列成实现时的禁止项。

## 2. 用户与核心流程

### 谁在用

- 团队成员：在浏览器里打开 DSH Web UI，使用「项目看板」查看和更新议题，或把一条议题送到会话里分析。
- 配置者：团队里负责 DSH 的人，一次性填好 GitLab 源站、组路径、令牌、自签证书开关，以及企业微信的企业 ID、应用 Secret、空间和目录。全组之后都用这一份连接。
- Agent：在 DSH 会话里调用 Keel 的只读工具分析议题。写入 GitLab 前必须经过 DSH 的一次批准。Agent 没有写企业微信文档的工具。

看板上的人并不以自己的 GitLab 身份调用 API。GitLab 审计里显示的是这枚共享令牌的身份。这是组级配置的直接结果。「只看我的」里的「我」也是这枚令牌对应的用户，不是浏览器登录态。

### 看看板

1. 成员在左侧栏点「项目看板」。主区域从当前会话换成看板。点回会话面板会离开看板，看板不占用会话正文。
2. 看板先判定每个相关项目用状态列还是打开/已关闭列，再按当前筛选拉取议题。
3. 每张卡片显示标题、仓库路径、`#iid`、负责人、截止日期、风险、状态或开关、评论数、最后更新时间、其他标签。响应里带了里程碑时，卡片另显示里程碑标题。打开且被 GitLab 判为逾期的卡片带逾期标记。
4. 面板保持打开时，每 10 秒按当前筛选重新拉取。面板不可见时不拉取。成员也可以按「刷新」立刻拉取。

### 设置截止日期

1. 成员在卡片或抽屉上选择一个公历日期，或选择清除。
2. 该字段进入「保存中」，在 GitLab 返回前不显示成功。
3. Host 读取该 Issue 的当前 `due_date`。已经是目标值就不发更新。
4. 否则 `PUT` 该 Issue 的 `due_date`。日期使用 `YYYY-MM-DD`。清除时发送空字符串，GitLab 将其写成 `null`。省略该字段表示不修改，所以清除不能靠省略字段完成。
5. 成功后用响应体替换这张卡片和抽屉。失败则恢复到这次保存前接口确认过的值，并显示错误。

### 设置风险

1. 成员选择「低」「中」「高」或「未评估」。
2. 字段进入「保存中」。
3. Host 读取当前标签。若三个约定标签已经正好是目标集合，就不发更新。
4. 否则一次 `PUT`。选中低、中或高时，`add_labels` 只放目标标签，`remove_labels` 放另外两个。选中未评估时不发送 `add_labels`，`remove_labels` 放上全部三个约定标签。请求里不出现 `labels` 参数，因为空的 `labels` 会清掉议题上的全部标签。
5. 成功后用响应体替换卡片和抽屉。无关标签保持原样。

### 设置状态

状态标签和 Issue 的 `state` 是两件独立的事。把卡片拖到「完成」只写 `status::done`，不关闭议题。在抽屉里关闭议题只写 `state_event=close`，不改状态标签。

1. 成员把卡片拖到另一状态列，或在焦点卡片上按 `1` 到 `4`，或使用「移动到待办 / 进行中 / 阻塞 / 完成」。拖到「未分状态」或在抽屉里选择「不设置状态」表示去掉四个状态标签。
2. 字段进入「保存中」。同一列内松手不发请求，也不改变顺序。
3. Host 读取当前标签。约定状态标签已经正好是目标集合时不发更新。
4. 否则一次 `PUT`。目标是四个标签之一时，`add_labels` 只放该标签，`remove_labels` 放另外三个。目标是未分状态时不发送 `add_labels`，`remove_labels` 放上全部四个。请求里不出现 `labels`。
5. 成功后用响应体替换卡片。这次写入不带 `state_event`。

开关模式项目上的列间移动仍只写 `state_event`：拖到「已关闭」或使用「移动到已关闭」发送 `close`，反向发送 `reopen`。已经处于目标状态时不发请求。开关模式里按下 `1` 到 `4` 仍按上面的规则写入状态标签。写入成功后，该项目下一次判定会变成状态模式。

状态列里的卡片不能拖进「打开」或「已关闭」。开关列里的卡片不能拖进状态列。跨模式时卡片回到原处，不发请求。要给开关模式的议题加上状态标签，使用 `1` 到 `4`、卡片菜单或抽屉里的状态控件。

### 关闭与重新打开

抽屉里的「关闭议题」和「重新打开议题」走 `setState`。卡片在开关模式下列间拖拽走同一条写入。状态模式下列间拖拽不走这条写入。

### 新建议题

1. 成员按 `c` 或标题栏的「新建议题」。右侧抽屉切换到新建表单，不是居中对话框。
2. 表单字段：仓库、标题、负责人、状态、截止日期、风险。仓库必填；当前筛选已经是单个仓库时，默认选中它，仍可改。标题必填，去掉首尾空白后长度 1 到 255。负责人可空。状态可空，空表示不写状态标签。截止日期可空。风险默认未评估。
3. 提交前，若状态或风险需要约定标签，三个风险标签和四个状态标签必须已经在组上存在。缺标签时不发 `POST`，错误为 `keel/labels-missing`。
4. `POST /projects/:id/issues`。正文只含本次有值的字段：`title`；有负责人时 `assignee_ids` 为仅含该 id 的数组；有截止日期时 `due_date` 为 `YYYY-MM-DD`；状态和风险至少有一个需要标签时，`labels` 为这些标签名用逗号连接。未评估、不设置状态、未填日期都不占字段。
5. 成功后刷新看板，抽屉改为这条新议题的详情。失败时表单保留成员刚填写的内容，并显示错误。新建表单的内容只留在浏览器内存里，不写本地文件。

### 筛选与工作台摘要

筛选栏改变任何一项都从第一页重新查询。摘要在筛选栏上方。

| 控件 | 默认 | 行为 |
| --- | --- | --- |
| 逾期 / 本周到期 / 高风险 / 未评估 | 都不按下 | 按下一项就只保留该项。再按一次取消。四项的数字本身不受这组选择、不受风险筛选、不受标签筛选影响。 |
| 搜索 | 空 | 去掉首尾空白后非空时传 `search`，并传 `in=title,description`。空则省略这两个参数。输入停止 300 毫秒后查询。 |
| 只看我的 | 关 | 打开时 `assignee_id` 固定为 `GET /user` 返回的令牌用户。负责人下拉显示该用户并禁用。 |
| 风险 | 全部 | 全部不附加风险条件。低、中、高各自 AND 上对应的一个风险标签。未评估使用 `not[labels]=risk::low,risk::medium,risk::high`。 |
| 负责人 | 全部 | 选中一人时传该成员的 `assignee_id`。选「未指派」时传 `assignee_id=None`。只看我的打开时这个控件不再生效。 |
| 标签 | 不限制 | 选中的标签名用逗号连接，传给 `labels`。GitLab 要求议题同时带上每一个标签。 |
| 仓库 | 全部仓库 | 全部仓库走组议题接口。选中一个仓库后走该项目的议题接口。 |

风险筛选是一等控件。看高风险议题不需要到标签列表里找 `risk::high`。标签列表里仍然出现风险标签和状态标签；成员若两者一起选，条件按 AND 合并。例如风险选「高」且标签里又选了 `risk::low`，结果为空，看板不偷偷丢掉其中一个条件。

摘要四项的统计范围是当前仓库、当前负责人（含「只看我的」）和当前搜索。计数使用响应头 `x-total`。没有该头时逐页累加，最多 20 页；第 20 页仍有下一页时，数字旁显示「不完整」。

| 摘要 | 附加查询 | 含义 |
| --- | --- | --- |
| 逾期 | `state=opened`，`due_date=overdue` | GitLab 服务器时区里，截止日期早于今天的打开议题。 |
| 本周到期 | `state=opened`，`due_date=week` | GitLab 服务器时区的本周一至本周日，且议题仍打开。这不是企业微信周报使用的上海时区周一至周五窗口。 |
| 高风险 | `state=opened`，`labels=risk::high` | 带 `risk::high` 的打开议题。同时带其他风险标签的议题也算，卡片上另标冲突。 |
| 未评估 | `state=opened`，`not[labels]=risk::low,risk::medium,risk::high` | 三个约定风险标签一个都没有的打开议题。 |

`not[labels]` 的含义以 GitLab `Issuables::LabelFilter#issuables_without_selected_labels` 为准：列出的标签一个都不能有。它不是「四个标签同时都有才排除」。

筛选、视图种类、摘要按下状态和搜索词只放在浏览器当前这块看板的内存里。刷新页面后回到默认值。它们不写回 GitLab，也不是议题数据的副本。

### 详情抽屉

点卡片、在列表里点一行，或在焦点卡片上按 Enter，从右侧打开抽屉。抽屉不是居中对话框，没有要点遮罩才能消失的模态层。宽度至少 768px 时，抽屉宽 420px，看板留在左侧并变窄。窄于 768px 时，抽屉盖住主区域，看板仍留在下面；Esc 或「关闭抽屉」回到看板。

抽屉里可以改截止日期、风险和状态，可以关闭或重新打开，可以在 GitLab 中打开，可以送到会话。描述、评论和动态只读。里程碑标题只显示，不能改，也不能按它筛选。

### 送到会话分析

卡片和抽屉都有「送到会话分析」，下面两项：

- 「当前会话」：客户端把侧栏里正在选中的会话 id 交给 Host。Keel 不另存一份会话目录。没有选中会话时这一项禁用。
- 「新会话」：Host 用 `ctx.agents.create` 建会话。`meta.agentPreset` 使用客户端传来的当前会话 preset；客户端没有这个名字时使用 `standard`。Keel 不写死模型名。

两种目的地都在会话上调用 `followup`，消息源是 `kind: 'user'`，因为这是成员按下的动作。消息正文只有这一条议题，格式固定如下。描述超过 8000 个字符时截断，并接上 `（描述已截断，请用工具读取全文）`。

```text
请只读分析这个 GitLab 议题。不要修改议题，除非我在批准里明确允许一次写入。

仓库：{projectPath}
议题：#{iid}
标题：{title}
开关：{state}
状态标签：{status 或 未分状态}
截止日期：{dueDate 或 未设置}
风险：{risk 或 未评估}
负责人：{姓名列表或 未指派}
链接：{webUrl}

描述：
{description}

请用 Keel 的只读工具核对最新内容后再分析。
```

Host 在组这条消息之前用 `GET` 取最新的单条议题，不使用看板上一次列表里的旧描述。成功后 Remote 返回 `{ sessionId }`。客户端把主区域切回会话面板并选中该会话。创建或 `followup` 失败时不切换，看板显示错误。

这条消息不是 system prompt。Keel 不注册会在每轮把看板、议题列表或周报写进 system prompt 的贡献。模型需要别的议题时，只能再调用只读工具。

### 立即生成本周周报

标题栏和设置里都有「立即生成本周周报」。GitLab 未连接或企业微信未配置时按钮禁用，并写明原因。按下后立刻对允许集合里的每个未归档项目跑第 7 节的同一次生成，不等到周五。生成过程中按钮不可再次按下。结束后按项目列出「已写入」「已跳过」或失败文案。这份结果只留在当前页面内存里。

### Agent 查询

成员可以让 agent 列出议题、高风险、逾期、本周到期或未评估议题，也可以读取单条议题和评论。只读工具不进入批准。Agent 要新建、改截止日期、改风险、改状态或改开关时，调用对应的写工具；写工具在联系 GitLab 之前进入 DSH 批准，成员允许这一次之后才发出写入。拒绝或无人批准时，GitLab 不变。

## 3. 作为 DSH 插件的架构

### 三种对象

按 DSH 的打包与安装模型，Keel 分三层，并且只有 bundle 会被 `dsh plugin add` 激活：

| 对象 | Keel 里的职责 |
| --- | --- |
| Host 模块 | 在 DSH 进程内导出 `apply(ctx, config)`，注册工具、持有 GitLab 与企业微信访问、提供 Remote 服务、武装周五定时器。 |
| Web 客户端 | 导出浏览器侧 `apply(ctx)`，向已有插槽注册「项目看板」和工具结果卡片。 |
| Bundle | `package.json` 的 `dsh.bundle.patch` 指向包内的 `cordis.patch.yml`，把插件行插入 profile 组合。 |

`web` profile 是用户机器上 `$DSH_HOME/profiles/web` 里已有的组合，由 `dsh.profile.bundles` 按顺序叠加各 bundle 的补丁。Keel 不发布 profile，也不修改 `@deepseek-ai/dsh-base` 或 `@deepseek-ai/dsh-api-remotes` 的源码。

### 包身份

npm 包名是 `keel`。不使用 `@deepseek-ai` 作用域。Cordis 行 id、Host 导出的 `name`、服务名和面板 id 都是 `keel`。

`cordis.patch.yml` 是包根目录下的 YAML 数组，只插入一行：

```yaml
- insert:
    - id: keel
      name: keel
```

行的 `name` 必须等于安装后的包名，这样 Node 能解析到包入口。补丁不写 GitLab 地址、企业微信地址和任何秘密。配置默认值放在 Host 模块导出的 Schema 上；用户后来在 profile 自己的 `cordis.patch.yml` 里覆盖时，DSH 会整段替换该行的 `config`，所以用户的覆盖文件要写上仍需保留的字段。

`package.json` 至少声明：

```json
{
  "name": "keel",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "main": "./lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./remote": "./lib/remote.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",
    "lib/client.js",
    "lib/remote.js",
    "cordis.patch.yml",
    "README.md",
    "LICENSE"
  ],
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-runtime"]
    }
  }
}
```

同一份 `package.json` 还要有 `engines.dsh`。实现第 9 节的成功标准时，把它写成当时 `dsh --version` 的次版本区间：版本 `X.Y.Z` 对应 `>=X.Y.0 <X.(Y+1).0`。DSH 启动器会拒绝不满足该区间的安装。发布提交里带上已构建的 `lib/`，不设置会在 `dsh plugin add` 时执行的 `prepare`，这样 pnpm 不需要 `allowBuilds`。依赖使用已发布的版本，不使用 `workspace:`。

### Host

Host 入口：

```js
export const name = 'keel'
export const inject = ['tools', 'credentials', 'agents']

export function apply(ctx, config) {
  // 注册 KeelService，并在 ctx.effect 里注册工具、武装定时器、释放连接。
}
```

`inject` 使 Cordis 等到 `tools`、`credentials` 和 `agents` 可用后才调用 `apply`。工具用 `@deepseek-ai/dsh-tools` 的 `defineTool`，再 `ctx.tools.register`。注册和定时器都放在 `ctx.effect` 里，插件卸载时去掉。模块求值期间不访问网络、不读令牌、不定时器。

`Config` 用 `@deepseek-ai/schemastery` 导出同名接口和 Schema。下面的字段都是 volatile，设置页修改后下一次操作就能读到新值：

| 字段 | 类型 | 默认 | 校验 |
| --- | --- | --- | --- |
| `baseUrl` | volatile string | 空字符串 | 空表示未配置。非空时必须是绝对源站：协议只允许 `http:` 或 `https:`，无用户信息、无查询、无片段，路径为空或 `/`。保存时去掉末尾斜杠。 |
| `groupPath` | volatile string | 空字符串 | 空表示未配置。非空时是 GitLab 组路径，例如 `acme/platform`。不允许前导或尾随斜杠，不允许出现 `://`。 |
| `tokenRef` | volatile string | `KEEL_GITLAB_TOKEN` | 凭据引用：以字母或下划线开头，其余为字母、数字或下划线。这是 `CredentialRef`，不是令牌本身。 |
| `allowSelfSigned` | volatile boolean | `false` | 只影响发往 `baseUrl` 的 GitLab HTTPS。`true` 时接受不在信任库中的证书，但仍校验主机名与证书的 CN 或 SAN 一致。不设置 `NODE_TLS_REJECT_UNAUTHORIZED`。企业微信始终校验证书。 |
| `wecomCorpId` | volatile string | 空字符串 | 空表示企业微信未配置。非空时是企业 ID，只含字母、数字和连字符，长度 1 到 64。 |
| `wecomSecretRef` | volatile string | `KEEL_WECOM_SECRET` | 与 `tokenRef` 相同的凭据引用形式。指向应用 Secret，不是 Secret 本身。 |
| `wecomSpaceId` | volatile string | 空字符串 | 空表示未配置。非空时是文档所在空间的 `spaceid`，长度 1 到 128，不含空白。 |
| `wecomFatherId` | volatile string | 空字符串 | 空表示未配置。非空时是该空间里存放项目文档的目录 `fileid`。文档放在空间根目录时，这个值与 `wecomSpaceId` 相同。 |

操作开始时读取这些字段的 `.get()`。GitLab 令牌通过 `ctx.credentials.resolve(tokenRef)` 现取。企业微信 Secret 通过 `ctx.credentials.resolve(wecomSecretRef)` 现取。解析结果不放进配置字段、不写日志、不返回给浏览器。`resolve` 得到的空值视为未配置。

`KeelService` 继承 `TypertRemoteService`，命名空间是 `keel`。对 Web 开放的方法标 `@Remote`。生成的描述符放在包的 `./remote` 导出。Keel 不把自己加进官方 `dsh-api-remotes` 组装包。

### Web 客户端

客户端 `inject` 包含 `slots`、`locale`、`remote` 和 `layout`。`apply` 里先 `ctx.remote.$mount` 挂上 Keel 的 `./remote` 贡献，之后调用 `ctx.remote.keel` 的具体方法。组件不直接拿 `ctx`，也不在浏览器里保存 GitLab 令牌或企业微信 Secret。

面板沿用 DSH 侧栏的成对插槽，和官方 `ui-sidebar` 的约定一致：

- 向根作用域列表 `sidebar.panellist` 注册一行。`id` 为 `keel`，`order` 为 `20`，`label` 为「项目看板」。
- 向根作用域 keyed 插槽 `main` 注册看板主体，`key` 与上面的 `id` 同为 `keel`。
- 两个注册都包在 `ctx.slots.inject(...)` 里，随插槽声明的生命周期挂上和卸下。

`MainPanelId` 使用字符串 `keel`。选中该行时，布局服务把主区域切到这个 `main` 键。缺少 `main` 注册时 DSH 会拒绝切换，因此两个注册必须同时存在。卸载插件会去掉这一行和主体。

每个 Keel 工具再向 keyed 插槽 `tool.call.toolview` 注册一张结果卡片，键是工具名。卡片从已持久化的 `tool/result` 内容解析 JSON。解析失败时退回 DSH 的通用行。Host 上的展示函数不会出现在浏览器里，因此第一版不靠 `presentResult` 画这张卡片。

客户端构建要符合该 `engines.dsh` 版本的 Web loader。成功与否以第 9 节的成功标准为准。

### 安装

插件包就绪之后，在能访问该包的目录执行：

```sh
dsh plugin --profile web add ./
```

装已固定的公开提交时：

```sh
dsh plugin --profile web add github:qiq-mine/Keel#<40位commit>
```

`dsh plugin --profile web add` 把参数交给 profile 目录里的 pnpm，并因为包声明了 `dsh.bundle`，把 `keel` 追加到 `dsh.profile.bundles`。随后执行：

```sh
dsh --profile web --dump-config
```

输出中要能看到名为 `keel` 的补丁层和 id 为 `keel` 的行。已在运行的 `dsh web` 要重新启动，新的 bundle 层才会进入进程内组合。移除用：

```sh
dsh plugin --profile web remove keel
```

移除插件只卸下 DSH 里的注册和定时器，不修改 GitLab 上的议题，也不删除企业微信里已经写过的文档。

### 进程内模块

```text
Web 客户端
  sidebar.panellist + main 插槽「项目看板」
  tool.call.toolview           聊天里的议题卡片
  ctx.remote.keel.*            只传 JSON，不传令牌或 Secret
        │
Host  KeelService
  工具 keel_*                   读工具直接执行；写 GitLab 的工具先走批准
  周五 10:00 Asia/Shanghai      只读 GitLab，写入企业微信文档
        │
        ├── 自建 GitLab  /api/v4          议题的唯一事实来源
        └── qyapi.weixin.qq.com           周报导出，不回写议题
```

浏览器里的筛选、页码、视图种类、保存中的字段和错误文案是视图状态。判断「现在的截止日期是哪一天」时以 GitLab 响应为准。写操作在更新前会再 `GET` 一次该 Issue，不拿看板上一次列表的缓存当依据。

进程内存里可以有：当次列表响应、企业微信 `access_token` 直到过期前 120 秒、本次进程已经解析出的 `docid`、最近一次周报结果。这些都不是议题台账，也不能代替文档里的周报标题来判断这一周是否写过。进程一停就丢，下次从 GitLab 和企业微信目录重新得到。Keel 不把它们写进 SQLite、`tasks.json` 或插件目录里的同步账本。

## 4. GitLab 集成

### 连接

`baseUrl` 是自建 GitLab 的源站，例如 `https://gitlab.example.com`。请求 URL 是 `baseUrl + /api/v4 + 路径`。HTTP 客户端关闭自动跳转：响应是 3xx 时视为失败，错误为「地址被重定向，请把 baseUrl 写成最终源站」，并且不把令牌发到另一个主机。

`baseUrl` 使用 `https:` 且 `allowSelfSigned` 为 `false` 时，TLS 沿用 Node 的默认信任库。证书不受信任时失败，错误码 `keel/gitlab-tls`，文案是「GitLab 证书不受信任。若这是自建证书，请在设置里打开允许自签证书。」`allowSelfSigned` 为 `true` 时，仅这个 GitLab 客户端允许不在信任库中的证书，主机名仍必须命中证书的 CN 或 SAN。`http:` 不涉及这项校验。企业微信客户端不读取 `allowSelfSigned`。

认证头是 `PRIVATE-TOKEN`。令牌使用组访问令牌；满足同一角色和范围的个人访问令牌也能通过连接检查。Keel 不解析令牌前缀，只看 API 结果。

令牌要求：

- 范围包含 `api`。只有 `read_api` 时，GET 可以被接受，POST 和 PUT 得到 403。
- 在目标组上至少是 Reporter。Reporter 可以查看议题、修改议题元数据、创建议题、关闭和重新打开议题，以及创建组标签。Guest 不能修改已有议题的标签和截止日期，也不能创建议题。
- 全组一枚令牌，放在 DSH 凭据库，由 `tokenRef` 指向。

连接检查按这个顺序做：`GET /user`，`GET /groups/:id`，再拉取允许的项目集合，再补齐三个风险标签和四个状态标签，然后才列议题。组接口失败时不创建标签。`GET /user` 的 `id`、`username`、`name` 留在进程内存，供「只看我的」使用。

### 允许的端点

Host 只请求下列路径。其他路径在发出前就被拒绝。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/user` | 令牌用户，供「只看我的」。 |
| `GET` | `/groups/:id` | 确认组存在，读取 `full_path` 和 `name`。 |
| `GET` | `/groups/:id/projects` | 建立允许写入的项目集合。 |
| `GET` | `/groups/:id/members/all` | 负责人下拉。 |
| `GET` | `/groups/:id/labels` | 标签下拉，以及确认约定标签。 |
| `POST` | `/groups/:id/labels` | 缺少约定风险或状态标签时创建组标签。 |
| `GET` | `/groups/:id/issues` | 未选仓库时列出议题、判定列模式、计算摘要。 |
| `GET` | `/projects/:id/issues` | 选中一个仓库时列出议题，或周报按项目统计。 |
| `POST` | `/projects/:id/issues` | 从看板或已批准的工具新建议题。 |
| `GET` | `/projects/:id/issues/:issue_iid` | 写入前读取这一条议题，或打开抽屉。 |
| `PUT` | `/projects/:id/issues/:issue_iid` | 写截止日期、风险标签、状态标签或开关。 |
| `GET` | `/projects/:id/issues/:issue_iid/notes` | 抽屉里的评论和动态。 |
| `GET` | `/projects/:id/issues/:issue_iid/resource_label_events` | 周报里的高风险变动。 |

`:id` 在组路径上使用 URL 编码后的 `groupPath`（`acme/platform` 写成 `acme%2Fplatform`）。项目 id 使用数字 `project_id`。`PUT` 的正文只允许 `due_date`、`add_labels`、`remove_labels`、`state_event` 这四个字段里的本次需要的那些。`POST` 新建议题的正文只允许 `title`、`assignee_ids`、`labels`、`due_date` 里本次有值的那些。

每个请求超时 15 秒。`per_page` 最大 100。翻页跟随响应头 `x-next-page`，直到该头为空，或已经取了 20 页（2000 条）。议题列表和单条读取都带 `with_labels_details=true`。

### 项目边界

GitLab 的 `GET /groups/:id/issues` 在服务端写死 `include_subgroups: true`，会返回该组以及子组项目中的议题。Keel 不提供关闭子组的开关。v1 仍然只有一个组路径，不接受第二个组。

允许的项目集合来自：

```text
GET /groups/:id/projects?include_subgroups=true&with_shared=false&archived=false&simple=true&per_page=100
```

`with_shared=false` 排除只是分享进组、并不属于该组及子组的项目。`archived=false` 与议题接口默认跳过归档项目对齐。这个集合超过 2000 个项目时，看板显示「项目列表超过 2000 个，超出第一版支持的组规模」，不展示残缺看板，写工具返回 `keel/outside-group`。周报同样不跑。

选中「全部仓库」时调用组议题接口，并丢掉 `project_id` 不在允许集合里的议题。选中一个仓库时，先确认它在允许集合里，再调用该项目的议题接口。写入前同样确认 `project_id` 在允许集合里，否则不发 `POST` 或 `PUT`。

### 列模式

四个状态标签，大小写敏感，必须完全一致：

| 列名 | 标签 | 新建时的颜色 | 说明 | 快捷键 |
| --- | --- | --- | --- | --- |
| 待办 | `status::todo` | `#57606A` | Keel 状态：待办 | `1` |
| 进行中 | `status::doing` | `#0969DA` | Keel 状态：进行中 | `2` |
| 阻塞 | `status::blocked` | `#BC4C00` | Keel 状态：阻塞 | `3` |
| 完成 | `status::done` | `#1A7F37` | Keel 状态：完成 | `4` |

一个允许项目是状态模式，当且仅当下面四次查询至少一次返回了议题：

```text
GET /projects/:id/issues?state=all&labels=status::todo&per_page=1
GET /projects/:id/issues?state=all&labels=status::doing&per_page=1
GET /projects/:id/issues?state=all&labels=status::blocked&per_page=1
GET /projects/:id/issues?state=all&labels=status::done&per_page=1
```

四次都是空列表时，该项目是开关模式，列只有「打开」和「已关闭」。标签已经在组上建好、但还没有任何议题贴上它们，仍然是开关模式。

选中单个仓库时，只对这个仓库做上面的判定，看板只渲染一种模式。

选中全部仓库时，改为四次组查询，每次 `state=all`、`labels` 为其中一个状态标签、`per_page=100`，翻页最多 20 页。出现过的 `project_id` 属于状态模式，允许集合里的其他项目属于开关模式。某一组查询在第 20 页仍有下一页时，不渲染列，横幅为「状态标签议题超过 2000 条，无法判定列模式」。两种模式都存在时，看板同时显示五个状态列和两个开关列。状态模式项目的议题只进入状态列；开关模式项目的议题只进入打开或已关闭。

状态模式的五列是：待办、进行中、阻塞、完成、未分状态。前四列的查询带对应的单个 `labels`。未分状态的查询是：

```text
state=all&not[labels]=status::todo,status::doing,status::blocked,status::done
```

全部仓库时，未分状态的结果还要丢掉开关模式项目的议题，那些议题已经在打开或已关闭里。

读取状态标签：

- 四个约定标签一个都没有：未分状态。`status` 为 `null`。
- 恰好一个：进入对应列。
- 多于一个：按完成、阻塞、进行中、待办的优先级取一个列，并标「状态标签重复」。优先级只决定显示位置，读取时不改标签。
- 存在其他以 `status::` 开头、但不是这四个名字的标签：不把它当成四列之一。卡片标「未识别的状态标签」，原标签仍留在标签区。

开关模式的两列：

| 列 | 查询 |
| --- | --- |
| 打开 | `state=opened`，`order_by=updated_at`，`sort=desc` |
| 已关闭 | `state=closed`，同样按 `updated_at` 降序 |

状态模式各列使用 `state=all`，同样按 `updated_at` 降序。已关闭的议题留在它的状态列里，卡片另标「已关闭」。Keel 不按 `relative_position` 排序，也不写这个字段。

打开列、每一个状态列和未分状态列都从第 1 页连续取到最后一页，上限 2000 条。达到上限时列头写明「只显示最近更新的 2000 条」。已关闭列默认只请求第 1 页，最多 100 条。这一页还有下一页时，列头写明「最近更新的 100 条已关闭议题」，并显示「加载更早的已关闭议题」；已经是最后一页时，列头只显示实际条数。继续加载最多到 20 页。筛选一变，已关闭列回到第 1 页。

议题类型 `issue`、`incident`、`test_case`、`task` 都显示。类型不是 `issue` 时，卡片标出 GitLab 返回的 `issue_type`。`confidential` 为真时卡片标出「保密」。Keel 不提供修改类型或机密状态的控件。

### 截止日期

| 看板 | GitLab `due_date` |
| --- | --- |
| 未设置 | `null` |
| 具体日期 | `YYYY-MM-DD` |
| 清除 | `PUT` 字段 `due_date` 为空字符串，响应里为 `null` |

逾期不在本地用时区另算。打开中的逾期标记，来自同一次筛选条件下附加 `state=opened` 与 `due_date=overdue` 的查询结果。某个 `(project_id, iid)` 出现在该结果里，对应卡片就标为逾期。已关闭的议题即使日期已过也不标逾期。逾期查询同样最多 2000 条；超过时横幅写明「逾期标记不完整」，只标记已经返回的那些。摘要「逾期」和 `keel_list_overdue` 直接使用这个 GitLab 过滤条件。

「本周到期」使用 GitLab 的 `due_date=week`，边界是 GitLab 应用时区的本周一到本周日。Keel 不用 Asia/Shanghai 再算一套看板周界。

### 风险标签

约定的三个标签名，大小写敏感，必须完全一致：

| 看板选项 | 标签 | 新建时的颜色 | 说明 |
| --- | --- | --- | --- |
| 低 | `risk::low` | `#1F883D` | Keel 风险：低 |
| 中 | `risk::medium` | `#D4A017` | Keel 风险：中 |
| 高 | `risk::high` | `#CF222E` | Keel 风险：高 |
| 未评估 | 三个标签都不在议题上 | 不创建第四个标签 | 空状态，不是 `risk::none` |

连接检查时，风险标签查询 `GET /groups/:id/labels?search=risk::&only_group_labels=true&include_ancestor_groups=false&include_descendant_groups=false`。状态标签把 `search` 换成 `status::`。某个约定名字不存在就 `POST /groups/:id/labels`，正文含 `name`、上表或状态表的 `color` 和 `description`。标签已经存在时不修改颜色和说明。并发创建得到「已存在」时再 `GET` 一次，名字在即可。

GitLab 的作用域标签（同名 `key::` 互斥）属于 Premium / Ultimate。Keel 不依赖这项能力。互斥由 `add_labels` 与 `remove_labels` 在一次 `PUT` 里完成。

读取风险：

- 三个约定标签一个都没有：未评估。
- 恰好一个：显示对应的低、中或高。
- 多于一个：按高、中、低取最高的一个显示，并标「风险标签重复」。
- 存在其他以 `risk::` 开头、但不是这三个名字的标签：不把它当成低中高，卡片标「未识别的风险标签」，原标签仍留在标签区。

下一次把风险设为低、中或高时，`PUT` 会去掉三个约定标签里未被选中的那两个。选择「未评估」时去掉全部三个。两种写入都不删除那三个名字以外的标签。状态写入同样只增删四个状态标签。Keel 不在读取时偷偷改标签。

`add_labels` 在标签不存在时会新建项目级标签。因此风险或状态写入前，对应的组标签必须已经存在。创建组标签得到 403 时，读取仍可用，相关写入失败，错误码 `keel/labels-missing`。Keel 不用项目级标签顶上。开关模式的关闭和重新打开不需要这些标签。

### 评论、动态与描述里的图片

抽屉打开时 `GET` 单条议题拿 `description`，再 `GET /projects/:id/issues/:issue_iid/notes?order_by=created_at&sort=asc&per_page=100`。`system` 为假的是评论，为真的是动态。最多 20 页。还有更多时，抽屉写「更早的评论未加载」。

描述和评论按 Markdown 显示，但浏览器不替 GitLab 去拉私有图片，也不通过 DSH 代理图片字节：

- 图片地址是相对路径，或者解析后的源站与当前 `baseUrl` 相同：不渲染 `<img>`。显示链接「图片：{alt}（在 GitLab 中打开）」。相对路径先按 `baseUrl` 拼成绝对地址。链接在新标签打开，`rel` 为 `noopener`。
- `data:` 图片不渲染，只留下 alt 文本。
- 其他 `http:` 或 `https:` 图片可以渲染为图片。

负责人使用首字母头像，不请求 `avatar_url`。名字里有汉字时取第一个汉字。否则按空白分成词，有两个及以上的词时取每个词的首字母，最多两个，并转成大写。只有一个词时取前两个字符。名字为空时改用 `username` 的前两个字符。

### 同步与冲突

没有第二份事实来源，所以也不做版本向量或三方合并。

- 人在看板上的保存、拖拽、新建，以及 agent 被批准后的写工具，都在返回成功之前完成 GitLab 的读取和必要的写入。
- 发起操作的界面用写入的响应体更新那一张卡片。没有写入的相同值读取，用 `GET` 的响应体更新。
- 其他打开着看板的客户端靠 10 秒拉取看到变化。拉取到的列表整列替换当前视图，但某张卡片若正有未完成的写入，则先保留它的保存中状态，等这次写入结束再用写入结果覆盖。
- 两个人先后改同一字段时，后一次成功的 `PUT` 留下。Keel 不弹出「对方已修改，请合并」。
- 截止日期、风险、状态、开关四次写入互不覆盖对方的字段，因为每次 `PUT` 只带自己的参数。
- 列表缓存在面板卸载、筛选变更和插件卸载时丢掉。

读请求遇到 429 时，等待 `Retry-After` 秒数，没有该头就等待 1 秒，然后重试一次。写请求不重试。其他失败不重试。

| HTTP 或情况 | 看板文案 | 工具码 |
| --- | --- | --- |
| 无法连接或超时 | 无法连接 GitLab | `keel/gitlab-unavailable` |
| TLS 证书不受信任 | GitLab 证书不受信任。若这是自建证书，请在设置里打开允许自签证书。 | `keel/gitlab-tls` |
| 3xx | 地址被重定向，请把 baseUrl 写成最终源站 | `keel/gitlab-unavailable` |
| 401 | 令牌无效或已过期 | `keel/unauthorized` |
| 403 | 令牌权限不足 | `keel/forbidden` |
| 404 | 组、项目或议题不存在，或当前令牌看不到它 | `keel/not-found` |
| 429 | GitLab 限流，请稍后再试 | `keel/rate-limited` |
| 其他 5xx | GitLab 暂时不可用 | `keel/gitlab-unavailable` |
| 配置不完整 | 尚未配置 GitLab 连接 | `keel/not-configured` |
| 项目不在允许集合 | 该仓库不在已配置的组内 | `keel/outside-group` |
| 约定标签无法就绪 | 令牌不能创建组标签 | `keel/labels-missing` |
| 参数不合法 | 输入不符合约定格式 | `keel/invalid-input` |
| 企业微信未配置 | 尚未配置企业微信 | `keel/wecom-not-configured` |
| 企业微信认证失败 | 企业微信应用 Secret 无效 | `keel/wecom-unauthorized` |
| 企业微信 无权限 | 应用缺少文档或微盘权限 | `keel/wecom-forbidden` |
| 同名文档多于一份 | 目录里有多份同名项目文档 | `keel/wecom-ambiguous-doc` |
| 无法解析 docid | 找到了同名文档，但读不出 docid | `keel/wecom-docid-unreadable` |
| 文档索引对不上 | 文档节点位置无法安全替换 | `keel/wecom-doc-index` |
| 企业微信限流 | 企业微信限流，请稍后再试 | `keel/wecom-rate-limited` |
| 企业微信其他失败 | 企业微信暂时不可用 | `keel/wecom-unavailable` |
| 没有会话服务或指定会话不可用 | 无法把议题送到会话 | `keel/session-unavailable` |

错误文案里不回显 GitLab 令牌、企业微信 Secret、`access_token`、`PRIVATE-TOKEN` 或 `Authorization` 头。日志只记录方法、路径和状态码。

## 5. 数据模型与 API / 工具

### 视图模型

下面的结构是 GitLab 响应的投影，不是要落库的表。列表接口和写接口都返回它。`description` 只在单条读取、新建成功和送到会话之前的读取里出现。

```ts
interface KeelIssue {
  projectId: number
  projectPath: string
  iid: number
  title: string
  state: 'opened' | 'closed'
  status: 'todo' | 'doing' | 'blocked' | 'done' | null
  statusConflict: boolean
  issueType: string
  confidential: boolean
  dueDate: string | null
  overdue: boolean
  risk: 'low' | 'medium' | 'high' | null
  riskConflict: boolean
  labels: { name: string; color: string | null }[]
  assignees: { id: number; username: string; name: string }[]
  milestoneTitle: string | null
  commentCount: number
  webUrl: string
  updatedAt: string
  description?: string
}
```

字段来源：

- `projectId`、`iid`、`title`、`state`、`issueType`、`confidential`、`webUrl`、`updatedAt` 分别来自 Issue 的 `project_id`、`iid`、`title`、`state`、`issue_type`、`confidential`、`web_url`、`updated_at`。
- `projectPath` 来自允许项目集合里的 `path_with_namespace`。集合里没有这条路径时，使用 Issue `references.full` 里 `#` 之前的路径。
- `status` 与 `statusConflict` 按第 4 节从 `labels` 算出。没有约定状态标签时 `status` 为 `null`。
- `dueDate` 来自 `due_date`，没有日期时为 `null`。
- `overdue` 在列表结果里按第 4 节判断。单条写入的返回值另算：`state` 不是 `opened` 或 `dueDate` 为 `null` 时为 `false`；否则请求 `GET /projects/:id/issues?state=opened&due_date=overdue&iids[]=<iid>&per_page=1`，响应中有这条议题则为 `true`。这次操作只改了风险或状态标签时不发该请求，沿用写入前的 `overdue`。
- `risk` 与 `riskConflict` 按第 4 节从 `labels` 算出。
- `labels` 保留 GitLab 返回的全部标签，包括约定标签。颜色来自 `with_labels_details=true` 的 `color`；响应没有颜色时为 `null`。
- `assignees` 来自 `assignees` 数组的 `id`、`username`、`name`。
- `milestoneTitle` 来自 `milestone.title`。`milestone` 为空时为 `null`。Keel 不另调里程碑接口。
- `commentCount` 来自 `user_notes_count`。这个数不含系统动态。
- `description` 来自单条议题的 `description`。列表投影省略它。

卡片的稳定键是 `${projectId}:${iid}`。`iid` 只在项目内唯一。

评论投影：

```ts
interface KeelNote {
  id: number
  system: boolean
  body: string
  authorName: string
  createdAt: string
}
```

`authorName` 来自 note 的 `author.name`，没有作者时为空字符串。`createdAt` 来自 `created_at`。

### Remote 方法

Web 客户端只调用这些方法。方法不返回令牌或 Secret。

| 方法 | 作用 |
| --- | --- |
| `connection()` | 返回连接与健康信息，见下文。 |
| `setToken(value)` | `credentials.set(tokenRef, value)`。`value` 为空则拒绝。响应只有 `{ configured: true }`。 |
| `clearToken()` | `credentials.unset(tokenRef)`。 |
| `setWecomSecret(value)` | `credentials.set(wecomSecretRef, value)`。`value` 为空则拒绝。响应只有 `{ configured: true }`。 |
| `clearWecomSecret()` | `credentials.unset(wecomSecretRef)`。 |
| `listMembers()` | 允许集合所用的组成员。超过 2000 人时失败，不返回半截名单。 |
| `listLabels()` | 标签下拉。超过 2000 个时失败。 |
| `listProjects()` | 允许的项目集合，元素为 `{ projectId, projectPath }`。 |
| `columnModes(projectId?)` | 列模式。传入 `projectId` 时只判定该项目；不传时按第 4 节对组做四次状态标签查询。返回 `{ modes: { projectId, columnMode }[], truncated }`。`columnMode` 为 `status` 或 `state`。`truncated` 为真时看板不渲染列。 |
| `listIssues(query)` | 某一列或列表视图的一页。 |
| `summary(query)` | 四项摘要计数。 |
| `getIssue({ projectId, iid })` | 单条议题，含 `description`。 |
| `listNotes({ projectId, iid, page })` | 一页评论和动态。 |
| `createIssue(input)` | 新建议题。 |
| `setDueDate({ projectId, iid, dueDate })` | `dueDate` 为 `YYYY-MM-DD` 或空字符串。 |
| `setRisk({ projectId, iid, risk })` | `risk` 为 `low`、`medium`、`high` 或 `none`。`none` 表示未评估。 |
| `setStatus({ projectId, iid, status })` | `status` 为 `todo`、`doing`、`blocked`、`done` 或 `none`。`none` 表示去掉四个状态标签。 |
| `setState({ projectId, iid, state })` | `state` 为 `opened` 或 `closed`。 |
| `analyzeIssue({ projectId, iid, sessionId, agentPreset })` | 把这一条议题送到会话。`sessionId` 为空字符串时新建会话。 |
| `generateReports()` | 立即生成本周周报，规则与周五任务相同，窗口终点按第 7 节的手动规则。 |
| `checkWecom()` | 只做企业微信认证和目录列举，不创建文档、不写正文。 |

`connection()` 的返回：

```ts
interface KeelConnection {
  configured: boolean
  baseUrl: string
  groupPath: string
  groupFullPath: string | null
  allowSelfSigned: boolean
  tokenConfigured: boolean
  tokenMasked: string | null
  labelsReady: boolean
  gitlabHealth: 'unconfigured' | 'ok' | 'error'
  gitlabHealthDetail: string | null
  wecomConfigured: boolean
  wecomCorpId: string
  wecomSpaceId: string
  wecomFatherId: string
  wecomSecretConfigured: boolean
  wecomSecretMasked: string | null
  wecomHealth: 'unconfigured' | 'ok' | 'error'
  wecomHealthDetail: string | null
  lastReport: {
    at: string
    written: number
    skipped: number
    failed: number
  } | null
}
```

`tokenMasked` 和 `wecomSecretMasked` 来自 `credentials.describe` 的掩码，没有值时为 `null`。`labelsReady` 在七个约定组标签都能被列出时为 `true`。`lastReport` 只存在于本进程内存，重启后为 `null`。

`listIssues` 的查询：

```ts
interface KeelListQuery {
  scope: 'opened' | 'closed' | 'status' | 'unscoped' | 'all'
  status?: 'todo' | 'doing' | 'blocked' | 'done'
  assigneeId?: number | 'None'
  labels?: string[]
  risk?: 'low' | 'medium' | 'high' | 'none'
  search?: string
  summary?: 'overdue' | 'due_this_week' | 'high_risk' | 'unassessed'
  projectId?: number
  page: number
  perPage: number
}
```

`scope` 决定开关或状态查询：`opened` 与 `closed` 用于开关列；`status` 必须同时给出 `status` 字段；`unscoped` 是未分状态；`all` 是列表视图。`summary` 为四项之一时再 AND 上第 2 节的对应条件。`risk: 'none'` 是未评估，不是一个标签名。`perPage` 只允许 1 到 100。响应：

```ts
interface KeelListPage {
  issues: KeelIssue[]
  page: number
  perPage: number
  nextPage: number | null
  truncated: boolean
  total: number | null
}
```

`truncated` 在这一页的 `page` 为 20 且 GitLab 仍给出下一页时为 `true`。`total` 来自 `x-total`，没有该头时为 `null`。

`summary` 的查询不含 `summary` 自身、不含 `risk`、不含 `labels`，以免四项数字被自己滤成空。其余筛选保留。

```ts
interface KeelSummary {
  overdue: { count: number; complete: boolean }
  dueThisWeek: { count: number; complete: boolean }
  highRisk: { count: number; complete: boolean }
  unassessed: { count: number; complete: boolean }
}
```

`createIssue` 的输入：

```ts
interface KeelCreateInput {
  projectId: number
  title: string
  assigneeId?: number
  status?: 'todo' | 'doing' | 'blocked' | 'done'
  dueDate?: string
  risk?: 'low' | 'medium' | 'high'
}
```

省略 `status` 表示不设置状态。省略 `risk` 表示未评估。省略 `dueDate` 表示不设置日期。

`setDueDate`、`setRisk`、`setStatus`、`setState`、`createIssue` 和 `generateReports` 被人从看板调用时不经过 agent 批准。成员的选择就是这次动作的确认。它们仍然做项目边界检查，并且只在上游成功后返回。`generateReports` 对 GitLab 只读。

`generateReports` 返回每个允许项目一条：

```ts
interface KeelReportProjectResult {
  projectId: number
  projectPath: string
  weekly: 'written' | 'skipped' | 'failed'
  monthly: 'written' | 'skipped' | 'not-due' | 'failed'
  docUrl: string | null
  error: string | null
}
```

`skipped` 只表示正文相同，或补跑时标题已经存在。某一项目失败时，`weekly` 为 `failed`，`error` 是第 4 节的文案，`docUrl` 能解析到才填，并且不再写该项目的月报，`monthly` 也是 `failed`。其他项目继续。

### Agent 工具

工具用 `defineTool` 注册。描述使用中文，并写明标签名和枚举，避免模型自造标签。

只读工具不进入批准：

| 工具 | 参数 | 查询 |
| --- | --- | --- |
| `keel_list_issues` | 与 `KeelListQuery` 相同，但 `page` 默认 1，`perPage` 默认 20、最大 100，`scope` 默认 `opened` | 与看板相同的组或项目接口 |
| `keel_list_high_risk` | `page`、`perPage` | `state=opened`，`labels=risk::high`，`order_by=updated_at`，`sort=desc`。不接受其他筛选。 |
| `keel_list_overdue` | `page`、`perPage` | `state=opened`，`due_date=overdue`，`order_by=due_date`，`sort=asc`。不接受其他筛选。 |
| `keel_list_due_this_week` | `page`、`perPage` | `state=opened`，`due_date=week`，`order_by=due_date`，`sort=asc`。不接受其他筛选。 |
| `keel_list_unassessed` | `page`、`perPage` | `state=opened`，`not[labels]=risk::low,risk::medium,risk::high`，`order_by=updated_at`，`sort=desc`。不接受其他筛选。 |
| `keel_get_issue` | `projectId`，`iid` | 单条议题，含描述。 |
| `keel_list_notes` | `projectId`，`iid`，`page` 默认 1 | 一页笔记。 |

高风险、逾期、本周到期、未评估这四个工具的含义固定，所以不接受额外筛选。带有多个风险标签但包含 `risk::high` 的议题会出现在高风险结果里，并且 `riskConflict` 为 `true`。

写工具：

| 工具 | 参数 | GitLab |
| --- | --- | --- |
| `keel_create_issue` | 与 `KeelCreateInput` 相同 | 与 Remote `createIssue` 相同 |
| `keel_set_due_date` | `projectId`，`iid`，`dueDate` | 与 Remote `setDueDate` 相同 |
| `keel_set_risk` | `projectId`，`iid`，`risk` | 与 Remote `setRisk` 相同 |
| `keel_set_status` | `projectId`，`iid`，`status` | 与 Remote `setStatus` 相同 |
| `keel_set_state` | `projectId`，`iid`，`state` | 与 Remote `setState` 相同 |

写工具成功时返回更新后的 `KeelIssue`。第一版没有写企业微信的工具，也没有把整块看板作为参数的工具。

同一插件监听 `tools/pre-execute`。工具名是 `keel_create_issue`、`keel_set_due_date`、`keel_set_risk`、`keel_set_status` 或 `keel_set_state` 时，返回：

```ts
{ kind: 'ask', reason, displayReason }
```

`reason` 是审计用的单行文本，包含工具名、`projectPath` 或 `projectId`、`iid`（新建时没有 iid）和目标值。`displayReason` 同时给出 `zh` 和 `en`。新建的中文例句是「Keel 将在 acme/app 新建议题「登录失败」」。改风险的中文例句是「Keel 将把 acme/app#12 的风险设为高」。其他工具调用 `next()`，不拦截。

DSH 的批准结果只有 `allowed-once` 才继续执行。`rejected`、`cancelled`、`unavailable`，以及会话策略 `never`，都不访问 GitLab。`ask` 在缺少批准服务时按 DSH 的规则失败关闭。Keel 不把「始终允许该工具」写进自己的配置。

人在看板上的 Remote 写入不经过 `tools/pre-execute`。周五周报和「立即生成」也不经过它。

### 聊天里的工具卡片

`tool.call.toolview` 的卡片只展示，不提供写入按钮，避免绕过批准。

- 列表结果：每条显示标题、`projectPath#iid`（指向 `webUrl` 的链接）、开关、状态、风险、截止日期。逾期的打开议题写出「逾期」。
- 单条议题：同样这些字段，另加负责人。描述不整段铺进卡片。
- 笔记结果：每条显示作者、时间、正文的前 140 个字符，并标明是评论还是动态。
- 错误：显示工具码对应的中文文案。

模型仍然收到原来的 JSON 文本。卡片是同一份结果的另一种视图。

## 6. 看板界面

主区域自上而下是：标题栏、摘要条、筛选栏、看板或列表。抽屉从右侧进入，不替换这块结构。宽度小于 768px 时，筛选控件各占一行，状态列改为上下排列。这个宽度与 DSH 侧栏改为抽屉的断点一致。

### 标题栏

- 标题文字是「项目看板」。
- 连接正常时显示 GitLab 组的 `full_path`。
- GitLab 健康为「已连接」「未配置」或「连接失败」三者之一。企业微信健康用同样的三个词，单独一行，不和 GitLab 混成一个状态。
- 显示最近一次成功拉取的浏览器本地时间，格式 `YYYY-MM-DD HH:mm:ss`。
- 「刷新」立即按当前筛选拉取。正在拉取时按钮不可重复触发。
- 「看板」和「列表」切换视图，默认看板。
- 「新建议题」打开新建抽屉。
- 「立即生成本周周报」按第 7 节执行。
- 「快捷键」打开快捷键说明。说明是看板里的一块面板，不是对话框。

### 未配置与设置

`baseUrl`、`groupPath` 有空值，或当前 `tokenRef` 解析不到令牌时，主区域不显示空列，而显示连接表单：

- GitLab 源站。
- 组路径。说明文字给出例子 `acme/platform`，并写明只填路径，不填整段网址。
- 「允许自签证书」，默认关闭。说明：只放宽这个 GitLab 源站的信任库校验，主机名仍然要匹配，不影响企业微信。
- GitLab 令牌。输入框是密码框，提交后清空。旁边显示掩码；未配置时显示「尚未保存令牌」。
- 说明：令牌保存在 DSH 凭据库，配置里只保留引用名。请使用该组的组访问令牌，角色不低于 Reporter，范围包含 `api`。
- 企业微信企业 ID、空间 `spaceid`、目录 `fatherid`、应用 Secret。Secret 同样是密码框。说明写明：Secret 只进凭据库；目录放在空间根上时，`fatherid` 填同一个 `spaceid`；文档名由仓库路径生成，不在这里手填每一份文档。
- 「保存并连接」先通过设置接口写非秘密字段，再保存两枚秘密，然后跑 GitLab 连接检查。企业微信四项都有值时再跑 `checkWecom`。企业微信留空时，GitLab 看板仍可使用。
- 「清除令牌」和「清除企业微信 Secret」分开。

这些非秘密字段也出现在 DSH 对该插件行的设置表单里。两个秘密都不是 Config 字段，设置表单里只能看到掩码和健康，看不到原值。

健康的判定：

- GitLab「已连接」：`GET /user` 和 `GET /groups/:id` 都成功，并且允许项目集合没有超过 2000。标签创建失败时仍是「已连接」，同时 `labelsReady` 为假，风险和状态写入会失败。
- 企业微信「已连接」：`gettoken` 成功，并且 `file_list` 对配置的空间和目录返回 `errcode` 0。这一步不要求目录里已经有文档。

### 摘要条

四枚按钮的文字是「逾期」「本周到期」「高风险」「未评估」，各带数字。加载完成前数字位置是「…」，不用 0 充当未知。`complete` 为假时数字后加「不完整」。当前按下的一枚使用 `aria-pressed=true`。

### 筛选栏

控件都有可见标签：「搜索」「只看我的」「风险」「负责人」「标签」「仓库」。

- 搜索是单行输入框。`/` 把焦点移到这里。
- 只看我的是复选框。令牌用户还没取到时复选框禁用。
- 风险是单选：全部、未评估、低、中、高。
- 负责人的选项是「全部」「未指派」，然后是 `listMembers()` 的 `name` 与 `username`。
- 标签是多选，选项来自 `listLabels()`，选项文字是标签名。
- 仓库的选项是「全部仓库」，然后是 `listProjects()` 的 `projectPath`。

成员、标签或项目列表因为超过 2000 而失败时，对应控件显示错误并不提供残缺选项。标签列表失败时，不能靠手工输入半个标签名去查询。

### 看板、列表与卡片

每列有列名和已加载条数。没有议题时，列内显示「没有议题」。

列表视图是一张表，列是标题、仓库、编号、状态或开关、负责人、截止日期、风险、评论数、更新时间。排序固定为 `updated_at` 降序，使用 `scope=all` 加当前筛选。每页 100 条，可继续加载，最多 2000 条。列表不支持拖拽。点一行打开抽屉。

卡片和列表行的内容：

- 标题。
- `projectPath` 与 `#iid`。这个控件是指向 `webUrl` 的链接，在新标签打开，`rel` 为 `noopener`。
- 负责人姓名和首字母头像。没有负责人时显示「未指派」。
- 截止日期控件：日期选择器加上「清除」。
- 风险控件：未评估、低、中、高。重复或未识别时在控件旁显示第 4 节的标记。
- 状态控件：未分状态、待办、进行中、阻塞、完成。开关模式的卡片也有这组控件。
- 评论数，使用 `commentCount`，0 也显示「0」。
- 最后更新时间，把 `updatedAt` 换到 Asia/Shanghai，显示 `MM-DD HH:mm`。悬停标题是同一时区的 `YYYY-MM-DD HH:mm`。
- 其余标签做成色块；七个约定标签不再在这里重复一遍。
- 里程碑标题。没有里程碑时不留空位占位文案。
- 逾期的打开卡片写出「逾期」二字，不只靠颜色区分。
- 非 `issue` 类型和「保密」以短标签标出。已关闭议题在状态列里写出「已关闭」。

保存中的控件禁用，文案是「保存中」。失败时该字段回到保存前的确认值，卡片底部显示第 4 节的文案和「重试」。成功只在响应到达后呈现。

拖拽的目标是同一模式里的另一列。拖到同一列、列外或另一模式的列，则取消。拖动期间不调用接口。键盘上的同等操作是：方向键移动焦点，`1` 到 `4` 写入对应状态标签，卡片菜单里的「移动到…」调用同一 Remote 方法。开关列另有「移动到打开」和「移动到已关闭」。

### 快捷键

焦点在 `input`、`textarea`、`select` 或 `contenteditable` 里时，除 Esc 以外的快捷键不触发。

| 键 | 动作 |
| --- | --- |
| `c` | 打开新建议题抽屉。已打开的详情抽屉换成新建表单，未提交的内容丢弃。 |
| `/` | 聚焦搜索框。 |
| `ArrowUp` / `ArrowDown` | 在当前列或列表中移动卡片焦点。 |
| `ArrowLeft` / `ArrowRight` | 在看板的列之间移动焦点。列表视图里这两键不做事。 |
| `Enter` | 打开焦点卡片的抽屉。 |
| `1` | 把焦点卡片或当前抽屉里的议题设为 `status::todo`。新建表单打开时不触发。 |
| `2` | 设为 `status::doing`。 |
| `3` | 设为 `status::blocked`。 |
| `4` | 设为 `status::done`。 |
| `?` | 打开或关闭快捷键说明。 |
| `Esc` | 先关闭快捷键说明；否则若焦点在输入框里则移出；否则关闭抽屉。 |

没有焦点卡片、也没有打开中的议题抽屉时，`1` 到 `4` 不发请求。第一版没有「清除状态」或「关闭议题」的单键。清除状态用拖到「未分状态」或抽屉里的「不设置状态」。关闭议题用抽屉按钮，或在开关模式里拖到「已关闭」。

### 刷新节奏

面板被选中后立即拉取，之后每 10 秒拉取一次。上一次拉取还没结束就跳过这个节拍。写入进行中不让这次拉取覆盖该卡片。成员切走面板时清掉这个定时器。插件卸载同样清掉。10 秒不是可配置项。

## 7. 企业微信周报与月报

企业微信文档记录的是某一次生成时从 GitLab 读到的结果。改文档不会改 Issue。Keel 除了定位小节和汇总月报之外，不读文档来决定议题状态。

### 时钟、周标识和窗口

时区固定为 `Asia/Shanghai`（UTC+8，无夏令时）。计划表达式是 `0 10 * * 5`，也就是每周五 10:00:00.000。

一次运行的周标识 `F` 是运行时刻所属那一周的周五日期。一周从周一算起。运行落在周一至周五时，`F` 是本周五，即使此刻还没到周五。运行落在周六或周日时，`F` 是刚过去的周五。标题日期就是 `F`，格式 `周报 YYYY-MM-DD`，例如 `周报 2026-11-20`。

窗口起点始终是 `F` 所在周的周一 `00:00:00.000`（含）。窗口终点：

- 计划运行和启动补跑：`F` 当天 `10:00:00.000`（含）。
- 立即生成：`min(运行时刻, F 当天 10:00:00.000)`（含）。周五 10:00 之前按下时，终点就是按下的时刻，标题仍然用尚未到来的那个周五。周五 10:00 之后或周末按下时，终点封顶在周五 10:00:00.000。

比较的是绝对时刻。GitLab 返回的 `created_at`、`closed_at`、`updated_at` 和标签事件的 `created_at` 解析成时刻后，与窗口两端做闭区间比较。

可核对的例子：

| 运行时刻（Asia/Shanghai） | 种类 | `F` | 窗口 | 是否写月报 |
| --- | --- | --- | --- | --- |
| 2026-11-20 10:00:00 | 计划 | 2026-11-20 | 2026-11-16 00:00:00 至 2026-11-20 10:00:00 | 否。11 月最后一个周五是 2026-11-27。 |
| 2026-11-18 15:00:30 | 立即生成 | 2026-11-20 | 2026-11-16 00:00:00 至 2026-11-18 15:00:30 | 否。 |
| 2026-11-21 12:00:00 | 立即生成 | 2026-11-20 | 2026-11-16 00:00:00 至 2026-11-20 10:00:00 | 否。 |
| 2026-11-27 10:00:00 | 计划 | 2026-11-27 | 2026-11-23 00:00:00 至 2026-11-27 10:00:00 | 是，`月报 2026-11`。 |
| 2026-11-28 09:00:00 | 立即生成 | 2026-11-27 | 2026-11-23 00:00:00 至 2026-11-27 10:00:00 | 是。 |
| 2026-12-04 10:00:00 | 计划 | 2026-12-04 | 2026-11-30 00:00:00 至 2026-12-04 10:00:00 | 否。这一周归 12 月的周报，不拆进 11 月月报。 |

`F` 是该月最后一个周五，当且仅当 `F` 加 7 天后的日期已经不属于 `F` 的月份。2026-11 的周五是 6、13、20、27，所以只有 2026-11-27。2026-12 的最后一个周五是 2026-12-25。月报归在周五日期所在的月份，不按窗口里的周一另分。

### 定时器与补跑

Host 在 `ctx.effect` 里先按补跑规则处理已经到来的最近一个周五，再武装定时器。下一次指严格晚于现在的那个周五 10:00:00.000。回调距离该时刻不超过 60 秒时，按计划运行：正文相同则跳过，不同则替换该周小节。超过 60 秒时不按计划运行，而按补跑规则处理。跑完后武装再下一个周五。卸载插件时取消定时器。

进程启动时只做补跑判断，不把启动当成计划运行。记 `L` 为不晚于现在的最近一个周五 10:00:00.000。补跑窗口是 `L <= now` 且 `now` 早于 `L` 之后的那个周一 10:00:00.000。窗口内，周标题还不存在才补写该周；周标题已经存在则不替换，避免每次重启都改写文档。若这个周五是该月最后一个周五，月报标题还不存在就补写月报，已经存在则不替换。周一 10:00:00.000 及更晚不再补刚过去的周五。更早漏掉的周不自动回补，第一版也没有按历史周批量回补的入口。

同一进程内周报生成串行。后到的「立即生成」或定时回调等前一次结束再跑。第一版假定一组只跑一个 `dsh web`，不加跨进程锁。

计划运行和立即生成在写入前比较正文。现有小节的纯文本与本次生成的纯文本逐字相同则跳过。不同则只替换该小节。补跑在对应标题已存在时不比较、不替换。

### 文档放在哪里、叫什么

配置给出一个空间和一个目录。每个允许项目对应这个目录里的一份文档，类型是普通文档（`doc_type` 3），不是表格或智能表格。文档名由 `path_with_namespace` 生成：把 `/` 换成 ` - `。`acme/platform/app` 得到 `acme - platform - app`。按 Unicode 码点计，长度不超过 255 时原样使用。超过时，取前 240 个码点，接连字符 `-`，再接该原始路径 UTF-8 字节的 SHA-256 十六进制小写的前 14 位。假定 `create_doc` 把 `doc_name` 原样存成 `file_name`，不截断、不改写 ` - `。查找只做完全匹配。同一次运行在创建成功后直接使用返回的 `docid` 写正文。

查找只认这个目录里 `file_status` 为 1、`file_type` 为 3、`file_name` 与文档名完全一致的条目。零条则创建一份。多于一条则该项目失败，错误 `keel/wecom-ambiguous-doc`，不写任何一条。创建使用返回的 `docid`，不因为响应慢再创建第二份。

### 官方接口

企业微信请求只发往 `https://qyapi.weixin.qq.com`，关闭自动跳转，TLS 使用系统信任库。其他主机在发出前拒绝。Secret 只出现在 `gettoken` 的查询参数里。`access_token` 放在后续请求的查询参数里，缓存在进程内存，到期前 120 秒重新获取，不写盘，不返回浏览器。

本文使用的接口以企业微信开发者中心的自建应用文档为准：

| 步骤 | 方法与路径 | 文档 |
| --- | --- | --- |
| 取 `access_token` | `GET /cgi-bin/gettoken?corpid=&corpsecret=` | [获取 access_token](https://developer.work.weixin.qq.com/document/path/91039) |
| 按目录列文件 | `POST /cgi-bin/wedrive/file_list` | [获取文件列表](https://developer.work.weixin.qq.com/document/path/96847) |
| 新建文档 | `POST /cgi-bin/wedoc/create_doc` | [新建文档](https://developer.work.weixin.qq.com/document/path/97470) |
| 读取文档数据 | `POST /cgi-bin/wedoc/document/get` | [获取文档数据](https://developer.work.weixin.qq.com/document/path/101188) |
| 替换或追加小节 | `POST /cgi-bin/wedoc/document/batch_update` | [编辑文档内容](https://developer.work.weixin.qq.com/document/path/97626) |

自建应用的 Secret 必须属于「可调用应用」。`wedoc` 接口需要文档权限，`file_list` 需要微盘权限。两项缺一则失败关闭，错误 `keel/wecom-forbidden`，不改用别的产品线顶上。

`create_doc` 的正文是 `spaceid`、`fatherid`、`doc_type` 为 3、`doc_name` 为上面的文档名。不传 `admin_users`。返回的 `docid` 和 `url` 用于这一次写入。官方说明 `docid` 只在创建时返回，而 `file_list` 返回 `fileid` 和微文档 `url`，不返回 `docid`。再次运行时按这个顺序解析，不把 `docid` 写进议题库：

1. 用 `fileid` 调用 `document/get`。`errcode` 为 0 则 `fileid` 就是 `docid`。
2. 否则取 `url` 路径里 `/doc/` 之后、`?`、`#` 或结尾之前的那一段作为 `docid`，再调用 `document/get`。
3. 两次都不行：错误 `keel/wecom-docid-unreadable`，不另建同名文档。

`gettoken`、`file_list` 和 `document/get` 在网络失败或企业微信返回频率限制时，等待 1 秒后重试一次。`create_doc` 不盲重试。它超时或连接失败时，先按文档名再列一次目录；已经出现则使用那一份，仍没有则该项目失败。`batch_update` 官方约定其中一步失败则整批不生效，因此失败时可以再 `document/get` 一次并重试整批一次。第二次仍失败则该项目失败。

`corpId`、Secret、`spaceid`、`fatherid` 任一为空，或 Secret 解析为空：不调用企业微信，错误 `keel/wecom-not-configured`。`gettoken` 的 `errcode` 不是 0，或 `access_token` 为空：错误 `keel/wecom-unauthorized`，不创建、不写入。

### 小节正文

每个项目即使四项都是零，也写入该周小节，这样月报能看见这一周。`confidential` 为真的议题不写标题、编号和链接，只在小节末尾写 `已省略保密议题：N`。

统计都限定在该项目：

- 新建：`state=all`，`created_after` 为窗口起点，`created_before` 为窗口终点，再用时刻闭区间复核。同一议题后来被关闭也仍然留在新建里。
- 关闭：`state=closed`，`updated_after` 为窗口起点，`updated_before` 为本次运行时刻，再保留 `closed_at` 落在窗口内的议题。窗口内关闭后又重新打开的议题，`closed_at` 为空，不计入关闭。
- 逾期：运行此刻 `state=opened` 且 `due_date=overdue` 的议题。这是「生成于」那个时刻的快照，不是窗口终点的回放，也不是「本周新变为逾期」的历史。GitLab 不提供逾期历史。周末补写或立即生成时，「生成于」可以晚于窗口终点。
- 高风险变动：先取 `state=all`、`updated_after` 为窗口起点、`updated_before` 为本次运行时刻的议题，最多 2000 条。对每条读取 `resource_label_events`，保留 `label.name` 正好是 `risk::high`、`action` 为 `add` 或 `remove`、事件 `created_at` 落在窗口内的记录。计数的是事件条数，不是议题条数。同一议题先加上再去掉，计为 2。同一议题下的事件按 `created_at` 升序。

列表按 `iid` 升序。标题里的换行改成空格，去掉首尾空白，超过 120 个字符时保留前 120 个并加 `…`。链接使用响应里的 `web_url`，没有则只写路径和编号。某一列表被 2000 条截断时，在该段标题下加一行 `（本段已截断，只统计了接口返回的前 2000 条）`。

正文是纯文本，行与行之间用 `\n`。计划任务在 2026-11-20 10:00:00 写出来的样子：

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

已省略保密议题：0
```

空列表写 `（无）`。高风险变动下面，每个事件一行，时间用 Asia/Shanghai 的 `YYYY-MM-DD HH:mm:ss`，动作「加上」对应 `add`，「去掉」对应 `remove`。四行计数必须是 `新建：`、`关闭：`、`逾期：`、`高风险变动：` 加非负整数，冒号用全角 `：`。

新文档第一段先写两行页眉，再写小节。页眉不是周报标题：

```text
Keel 周报
acme/app
```

已有文档不改页眉。

### 替换哪一节

`document/get` 返回带 `begin`、`end` 和 `text` 的节点。Keel 按文档顺序拼接文本节点。只有每个文本节点的 `end - begin` 等于该节点 `text` 的长度时才继续；对不上则错误 `keel/wecom-doc-index`，不删除任何内容。

一行是字符串开头或 `\n` 之后、到下一个 `\n` 或结尾的文本。小节从内容等于 `周报 F` 的那一行开始，到下一行内容匹配 `^周报 \d{4}-\d{2}-\d{2}$` 或 `^月报 \d{4}-\d{2}$` 之前结束；没有下一标题就延伸到文档末尾。标题行前后不允许多余空格。

替换使用一次 `batch_update`，带上一次 `document/get` 的 `version`。已有小节时，第一个操作 `delete_content` 覆盖该范围，第二个操作 `insert_text` 在该起点插入新文本。没有该标题时，只在文档末尾 `insert_text`。两次操作都低于官方的单批 30 个上限。不另起一份文档来躲开替换。

### 月报

同一次运行在该项目的周小节得到 `written` 或 `skipped` 之后，若 `F` 是该月最后一个周五，再写月报。`weekly` 为 `failed` 时不写月报。月报只汇总这份文档里、标题日期属于该月的周小节，不重新向 GitLab 要一份月度清单。刚写上的本周小节算在内。计划运行和立即生成按上面的比较规则替换月报。补跑只在月报标题不存在时写入。

从每个匹配的周小节读取四行计数。缺某一行时该数按 0，并在说明里加上 `周报 F 缺少计数，按 0`。`新建合计`、`关闭合计`、`高风险变动合计` 是各周整数相加。高风险合计是次数相加，同一议题跨周重复出现会计多次。`月末逾期` 取该月标题日期最晚的那份周报的逾期数，不是各周逾期相加。

```text
月报 2026-11
来源：本文档中标题日期属于 2026-11 的周报
周次：4
新建合计：3
关闭合计：2
高风险变动合计：5
月末逾期：2
说明：新建合计与关闭合计是各周次数相加。高风险变动合计也是各周次数相加，同一议题跨周会重复计入。月末逾期取该月最后一份周报的逾期数，不是各周相加。

周报 2026-11-06  新建 1  关闭 0  逾期 0  高风险变动 1
周报 2026-11-13  新建 0  关闭 1  逾期 1  高风险变动 0
周报 2026-11-20  新建 1  关闭 0  逾期 1  高风险变动 1
周报 2026-11-27  新建 1  关闭 1  逾期 2  高风险变动 3
```

月报的查找和替换与周报相同，标题是 `月报 YYYY-MM`。不是最后一个周五时，不创建、不替换月报，结果里的 `monthly` 为 `not-due`。人如果改了周报里的计数行，下一次月报会采用改过的数字；下一次替换该周小节时，仍以 GitLab 的重新统计覆盖该周，不覆盖其他周。

## 8. 权限、凭据与安全

### 秘密放在哪里

DSH 的凭据缝把秘密关在配置外面。`cordis.patch.yml` 和设置文档只保存 `tokenRef` 与 `wecomSecretRef`。秘密值由 `ctx.credentials.set` 写入当前凭据提供者。本地提供者的存储位置是 `$DSH_HOME/.credentials.yaml`。设置接口对客户端的读取会去掉秘密；Keel 的 Remote 读取也不返回秘密，只返回 `describe` 的掩码和是否已配置。

每次上游调用重新 `resolve`。在连接页更换秘密后，下一次调用使用新值，不需要重启 `dsh web`。更换引用名不会把旧键里的值复制过去，必须重新输入。Keel 不列举或删除这两个引用名以外的凭据。企业微信 `access_token` 不进入凭据库。

### 谁可以写

| 路径 | 何时真正写上游 |
| --- | --- |
| 看板 Remote 的议题写入 | 成员完成日期、风险、状态、开关、新建或列移动。不弹第二层 DSH 批准框。 |
| Agent 写工具 | `tools/pre-execute` 返回 `ask`，且本次批准结果为 `allowed-once`。 |
| 读取、连接检查、创建缺失的约定标签 | 不走 agent 批准。创建标签只在连接检查里按七个固定名字执行。 |
| 周五定时器、补跑、立即生成 | 不走 agent 批准。对 GitLab 只读，对企业微信按第 7 节写入。未配置或认证失败时不写。 |

共享令牌的权限就是看板和 agent 的 GitLab 权限上限。令牌能做的事比 Keel 实际调用的多，因此 Host 用路径白名单和字段白名单收紧行为。企业微信 Secret 同样只用于第 7 节列出的五个路径。

### 失败时关闭

- 未配置、项目不在组内、批准没有明确允许，都不发 GitLab 写入。
- 企业微信配置或认证不完整时，不创建文档，不改已有文档。
- 不跟随跨主机重定向。
- 不把令牌、Secret 或 `access_token` 写进工具结果、Remote 响应、看板状态、仓库文件或日志。
- 不在模块导入时读取 `process.env` 里的秘密。需要秘密时只走 `credentials.resolve`。
- 不把 GitLab 源站上的上传图片嵌进页面，也不用 Keel 的服务端去下载后转存。
- 卸载时释放定时器、未完成请求的 `AbortSignal`、工具注册和插槽。卸载不回滚已经写到 GitLab 或企业微信的变更。

## 9. 测试与第一版成功标准

### 自动测试

单元测试覆盖纯逻辑，不连接真实 GitLab 或企业微信：

- `baseUrl`、`groupPath`、`tokenRef`、`wecomCorpId`、`wecomSecretRef`、`wecomSpaceId`、`wecomFatherId` 的接受与拒绝，包括带用户信息的 URL、带路径的 URL、整段组网址，以及空令牌。
- `allowSelfSigned` 只传给 GitLab 的 HTTPS 客户端。企业微信客户端的构造参数里看不到这项放宽。
- 风险解析：无标签、单一标签、两个以上约定标签时取高者并标冲突、未知 `risk::` 标签。
- 状态解析：无标签、单一标签、重复时按完成、阻塞、进行中、待办取列并标冲突、未知 `status::` 标签。
- 风险 `PUT` 在设为低、中或高时只含目标 `add_labels` 和另外两个 `remove_labels`；设为未评估时只含三个 `remove_labels`。状态 `PUT` 对四个 `status::` 标签同样处理。这些请求都不包含 `labels`，也都不包含 `state_event`。
- 清除截止日期发送空字符串；不修改时不发 `PUT`。
- `state_event` 只使用 `close` 和 `reopen`。
- 新建请求只含有值的 `title`、`assignee_ids`、`labels`、`due_date`。未评估和不设置状态不产生标签字段。
- 项目不在允许集合时写入被拒绝。
- 列模式：四次状态查询都空则为开关模式；任一次非空则为状态模式。全部仓库时，没有状态标签的项目不进入未分状态列。
- 摘要查询不含风险筛选和标签筛选。未评估使用 `not[labels]=risk::low,risk::medium,risk::high`。本周到期使用 `due_date=week`，并且测试名写明它与周报窗口不是同一个周界。
- GitLab 源站上的 Markdown 图片变成链接，不产生指向该源站的 `<img>`。`data:` 图片不产生 `<img>`。
- 错误对象和日志样例里搜索不到测试令牌、测试 Secret 和测试 `access_token`。
- 分页在 `x-next-page` 为空时停止，第 20 页仍有下一页时把该列标为截断。
- 周标识、窗口和月报判定与第 7 节的六行例子一致，包含两端闭区间：周一 `00:00:00.000` 计入，该时刻减 1 毫秒不计入；周五 `10:00:00.000` 计入，加 1 毫秒不计入。
- 2026-11-27 写月报，2026-11-20 不写。2026-12-04 的窗口从 2026-11-30 开始，月报标题不会是 `月报 2026-11`。
- 同一标题已存在时，替换范围停在下一个 `周报 ` 或 `月报 ` 标题之前。正文相同则不调用 `batch_update`。
- 月报的新建、关闭、高风险变动是各周相加，月末逾期取最后一周的逾期数。缺少计数行时按 0。
- 高风险变动按 `risk::high` 事件条数计数。保密议题只进入省略计数。
- 记 `L` 为不晚于启动时刻的最近一个周五 10:00:00.000。只有 `now` 早于 `L` 之后的那个周一 10:00:00.000 才进入补跑。周标题不存在才补写周小节，已存在则不替换。该周五是月末最后一个周五时，月报标题不存在才补写月报。周一 10:00:00.000 整点不补上一周五。
- 文档名替换斜杠、超长时使用 240 个码点加 14 位哈希。节点 `end - begin` 与文本长度不一致时不产生删除操作。

契约测试使用固定的 GitLab JSON 样本和企业微信 `document/get` 样本，断言投影后的 `KeelIssue` 和替换范围。样本放在测试目录，不从网络现拉。

默认测试命令不访问真实 GitLab 或企业微信。另有一个需要环境变量 `KEEL_GITLAB_TEST_BASE_URL`、`KEEL_GITLAB_TEST_GROUP` 和 `KEEL_GITLAB_TEST_TOKEN` 的集成测试，对一个一次性项目执行：创建缺失标签、新建议题、设置日期、设置风险、设置状态、关闭、重新打开、确认无关标签还在。没提供这三个变量时跳过，不作为默认失败。企业微信不进入默认集成测试。

客户端测试覆盖：默认筛选、标签 AND 与风险筛选同时生效、保存中不会在响应前变成成功、失败后恢复原值、同一列放下不发请求、跨模式拖拽不发请求、搜索在 300 毫秒内合并成一次查询、快捷键在输入框里不触发、抽屉把 GitLab 图片渲染成链接。

### 成功标准

下面每一条都在团队实际使用的 `dsh web` 上可以核验。`engines.dsh` 写成这次 `dsh --version` 的次版本区间。

1. `dsh plugin --profile web add` 之后，`dsh --profile web --dump-config` 出现 `keel` 层和 id 为 `keel` 的行。重启 `dsh web` 后插件处于加载状态。
2. 左侧栏有「项目看板」。配置为空时看到的是连接表单，不是空列。表单含源站、组路径、令牌、允许自签证书，以及企业微信的企业 ID、Secret、空间和目录。秘密只以掩码出现。
3. 填入一个自建 GitLab 的源站、一个组路径和一枚符合第 4 节的令牌后，看板列出该组及子组里、且属于允许项目集合的 Issue。归档项目不出现。没有任何状态标签的项目显示打开和已关闭两列。已有状态标签的项目显示四列状态加上未分状态。
4. 把一张卡片的截止日期设为某一天，GitLab 上该 Issue 的 `due_date` 变为这一天。清除之后 `due_date` 为 `null`。
5. 把风险设为高，该 Issue 带有 `risk::high`，不带 `risk::low` 和 `risk::medium`，原有的其他标签还在。设为未评估后三个约定风险标签都消失。
6. 在状态模式项目里把卡片拖到另一状态列，或对焦点卡片按 `1` 到 `4`，四个约定状态标签里只留下目标那一个，其他名字的标签还在，`state` 不变。拖到「未分状态」后四个状态标签都消失。
7. 在开关模式项目里把卡片拖到另一列，GitLab 的 `state` 变为 `closed` 或 `opened`，状态标签不变。按下 `1` 之后该议题出现 `status::todo`，下一次刷新该项目改为状态列。
8. 抽屉从右侧打开，能看到描述、评论和动态，能改日期、风险和状态，能关闭和重新打开，能打开 GitLab。描述里的 GitLab 上传图片是链接，页面请求里没有把该图片当成 `<img>` 去拉。负责人是首字母，不是头像图片。
9. 新建表单提交后，GitLab 上出现对应的标题、负责人、日期、状态标签和风险标签。未填的项不会把已有约定标签写成空。
10. 摘要四项的数字与第 2 节的查询一致，点击后看板只留下该项，再点一次取消。搜索、「只看我的」和风险筛选会改变查询。标签筛选仍是 AND。仓库筛选不会查询允许集合之外的项目。
11. 卡片上的评论数等于 `user_notes_count`，更新时间是 `updated_at` 在 Asia/Shanghai 的显示。看板和列表使用同一套筛选。`c`、`/`、`1` 到 `4` 和 `Esc` 按第 6 节工作。
12. 「送到会话分析」只把这一条议题放进当前会话或新会话。会话的 system prompt 里没有整块看板。随后的写工具在 `allowed-once` 之前不产生 GitLab 写入。聊天里能看到议题卡片，卡片上没有写入按钮。
13. `keel_list_high_risk`、`keel_list_overdue`、`keel_list_due_this_week`、`keel_list_unassessed` 与第 5 节的固定查询一致。
14. 自签开关关闭时，不受信任的 GitLab 证书被拒绝；打开后同一源站可以完成第 4 节允许的请求，主机名不匹配的证书仍然失败。企业微信仍拒绝不受信任的证书。
15. 配置好的企业微信目录里，每个允许项目最多一份按第 7 节命名的文档。周五 10:00 Asia/Shanghai 的计划运行写入 `周报 F`。同一标题再次运行时不出现第二份相同标题。2026-11-27 这一类最后一个周五还会写入或替换对应的 `月报 YYYY-MM`。立即生成不必等到周五，窗口终点按第 7 节。
16. 企业微信未配置或 Secret 无效时，不创建文档。周报生成不修改 GitLab Issue。
17. `dsh --profile web --dump-config`、工具输出、浏览器里的 Remote 响应和插件日志都不含 GitLab 令牌、企业微信 Secret 或 `access_token`。
18. 停用或移除插件后，侧栏入口、主面板、工具、10 秒拉取和周五定时器都消失。GitLab 上已写过的日期、标签和状态保持原样，企业微信里已写过的文档也还在。
19. 插件目录和 `$DSH_HOME` 里不存在以 Keel 命名的议题数据库、`tasks.json` 或同步账本。议题内容只出现在当次请求的内存响应里。`docid` 不作为议题数据落盘。

## 10. 第一版不做

实现时遇到下列需求，保持现状并改文档后再做，不在第一版里部分实现：

- 与表格、CSV、飞书或另一套看板的双向同步。企业微信文档只导出，不把文档编辑同步回 Issue。
- 把 GitLab Board 的列表、Milestone、Merge Request、Epic 或迭代当成 Keel 的对象。可以显示响应里已有的 `milestone.title`，不为此增加接口、筛选、列或写入。
- 配置多个顶层组，或按部门做组目录。一个 `groupPath` 加上它的子组就是全部范围。
- 引用或嵌入 ChunSun、`dsh-pm`、`dsh-agent-team` 的服务、路由或数据。
- 按角色把议题分派给不同 agent，或为分析创建 git worktree。送到会话只允许成员选择当前会话或一个新会话。
- 编辑已有议题的标题或描述、更换已有负责人、发表评论、上传设计稿、记录工时、修改机密开关或议题类型。
- 拖拽排序并写回 `relative_position`。同一列内松手不发请求。
- 状态列拖拽顺便关闭议题，或关闭议题顺便改 `status::done`。
- 按人分别授权的 GitLab 登录，或按人分别授权的企业微信身份。
- 用 Webhook、长轮询以外的推送，或短于 10 秒的固定拉取代替 10 秒刷新。10 秒不是可配置项。
- 在读取时自动改正重复的风险标签或状态标签。
- 为风险创建 `risk::none`，或为状态创建四个约定名字以外的等级。
- 给 agent 一个写企业微信的工具，或在每一轮 system prompt 里放入看板或周报。
- 把周报写成智能表格、新开一份每周文档，或在漏掉多个周五之后自动逐周回补。
- 用本地数据库记住议题、`docid` 或「这一周已经写过」。幂等只看文档里的标题。

## 依据

DSH 的插件形状以这些公开文档为准：

- [打包并安装插件](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)：`dsh.bundle`、`cordis.patch.yml`、profile 的 `dsh.profile.bundles`，以及 `dsh plugin --profile <name> add`。
- [插件配置](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/config) 与 [配置表单](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-settings-card)：导出 Schema `Config`，volatile 字段用 `.get()` 读取。
- [编写工具](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool)：`inject` 含 `tools`，`ctx.tools.register(defineTool(...))`。
- [工具子系统](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools)：`tools/pre-execute` 返回 `ask`，只有 `allowed-once` 继续执行。
- [用户批准](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/approval)：批准结果是 `allowed-once`、`rejected`、`cancelled` 或 `unavailable`。
- [用户凭据](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/credentials)：配置保存 `CredentialRef`，`ctx.credentials.resolve` 每次操作读取，空值视为未配置。
- [编写工具的 Web 展示](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool)：客户端用 `tool.call.toolview` 从 `tool/result` 绘制卡片。
- [Web Client 插槽](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/slots) 与 [ui-sidebar](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/client/ui-sidebar/README.md)：`sidebar.panellist` 的 `id` 对应 `main` 插槽的同一个键。
- [API Gateway](https://deepseek-harness.github.io/deepseek-harness/en/reference/api-gateway)：`@Remote` 方法经 `ctx.remote.$mount` 挂到客户端，不改官方组装包。
- [会话与 `followup`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-loop/README.md)：`ctx.agents.create` 建立会话，`followup` 送出用户消息。

GitLab 行为以这些文档和实现为准：

- [Issues API](https://docs.gitlab.com/api/issues/)：组与项目的议题列表、`search`、`due_date`、`not`、`add_labels`、`remove_labels`、`state_event`、新建议题。空的 `labels` 会移除全部标签，所以更新时 Keel 不发送它。`due_date=week` 与 `due_date=overdue` 由 GitLab 服务器时区解释。
- GitLab `Issuables::LabelFilter#issuables_without_selected_labels`：`not[labels]` 排除带有所列任一标签的议题。
- GitLab `lib/api/issues.rb` 对组议题路由写死 `include_subgroups: true`。
- [Notes API](https://docs.gitlab.com/api/notes/)：`system` 区分评论和动态。
- [Resource label events API](https://docs.gitlab.com/api/resource_label_events/)：`action` 为 `add` 或 `remove`。
- [Group labels API](https://docs.gitlab.com/api/group_labels/) 与 [Labels](https://docs.gitlab.com/user/project/labels/)：组标签的创建；`key::value` 的互斥属于 Premium / Ultimate。
- [权限](https://docs.gitlab.com/user/permissions/)：创建和修改议题、关闭议题、创建标签至少需要 Reporter。
- [REST 认证](https://docs.gitlab.com/api/rest/authentication/)：`PRIVATE-TOKEN` 头。

企业微信行为以第 7 节表格里的开发者中心文档为准。`create_doc` 在创建时返回 `docid`；`file_list` 对微文档返回 `fileid` 和 `url`。Keel 按第 7 节的顺序把二者解成同一次 `document/get` 能用的 `docid`，解不出就停在该项目。
