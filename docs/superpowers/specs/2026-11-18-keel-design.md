# Keel 设计

本文是 Keel 第一版的产品与技术设计，供后续实现使用。本文件所在的变更只加入设计说明，不加入插件代码。

Keel 是一个 DeepSeek Harness（DSH）插件，安装到团队已有的 `web` profile。它在 DSH Web UI 里提供「项目看板」，并把同一组操作暴露给 DSH agent 的工具。团队规模按 5 到 15 人设计。需求、任务、截止日期和风险都落在团队自建 GitLab 的 Issue 上。GitLab 是唯一事实来源。

## 1. 背景、目标与非目标

### 背景

团队已经用自建 GitLab 管理需求、任务、进度和风险，但没有统一的方式在看板上标记截止日期和风险。成员需要在 DSH 里直接看到这些议题，而不是再维护一份表格或另一套任务系统。DSH 的扩展方式是 Cordis 插件：插件导出 `apply(ctx)`，通过 `ctx` 注册能力，用 bundle 的 `dsh.bundle` 和 `cordis.patch.yml` 插入组合，再用 `dsh plugin --profile web add` 装进 `web` profile。

### 目标

第一版做成下面这些事：

1. 在 DSH Web UI 增加「项目看板」。列按 GitLab Issue 的 `state` 划分，只有「打开」和「已关闭」。
2. 在卡片上设置截止日期，并立刻写回该 Issue 的 `due_date`。
3. 在卡片上设置风险：低、中、高，或未评估。风险写回三个约定标签，并立刻生效。
4. 看板可以按负责人、标签、仓库筛选。
5. Agent 可以用工具列出高风险议题和逾期议题，也可以执行看板上的同一组读、写操作。
6. 全组共用一份 GitLab 连接配置。写入直接打到 GitLab。插件不保存第二份议题台账。

### 非目标

第一版不做这些事，实现时也不要预留半套行为：

- 双向表格同步。
- 把 GitLab Board、Milestone、Merge Request 做成一等对象。看板不读取 Board 的列，也不创建 Milestone。
- 同时配置多个互无隶属关系的 GitLab 组，或按大规模多组部署。
- 依赖 ChunSun、`dsh-pm` 或 `dsh-agent-team`。Keel 只依赖 DSH 本体公开的插件、工具、凭据、审批、设置和 Web 插槽，以及 GitLab REST API。
- 在 Keel 里新建、改标题、改描述、改负责人、评论、排序持久化，或管理机密开关。
- 每人单独走 GitLab OAuth。第一版是组级共享令牌。
- Webhook、离线队列、本地冲突合并。

后文第 9 节把这些边界再列成实现时的禁止项。

## 2. 用户与核心流程

### 谁在用

- 团队成员：在浏览器里打开 DSH Web UI，使用「项目看板」查看和更新议题。
- 配置者：团队里负责 DSH 的人，一次性填好 GitLab 源站、组路径和令牌。全组之后都用这一份连接。
- Agent：在 DSH 会话里调用 Keel 工具，查询高风险和逾期议题；写入前必须经过 DSH 的用户批准。

看板上的人并不以自己的 GitLab 身份调用 API。GitLab 审计里显示的是这枚共享令牌的身份。这是组级配置的直接结果。

### 看看板

1. 成员在左侧栏点「项目看板」。主区域从当前会话换成看板。点回会话面板会离开看板，看板不占用会话正文。
2. 看板请求 GitLab，按当前筛选条件分别拉出打开的议题和已关闭的议题。
3. 每张卡片显示标题、仓库路径、`#iid`、负责人、截止日期、风险和其他标签。打开且被 GitLab 判为逾期的卡片带逾期标记。
4. 面板保持打开时，每 10 秒按当前筛选重新拉取。面板不可见时不拉取。成员也可以按「刷新」立刻拉取。

### 设置截止日期

1. 成员在卡片上选择一个公历日期，或选择清除。
2. 卡片该字段进入「保存中」，在 GitLab 返回前不显示成功。
3. Host 读取该 Issue 的当前 `due_date`。已经是目标值就不发更新。
4. 否则 `PUT` 该 Issue 的 `due_date`。日期使用 `YYYY-MM-DD`。清除时发送空字符串，GitLab 将其写成 `null`。省略该字段表示不修改，所以清除不能靠省略字段完成。
5. 成功后用响应体替换这张卡片。失败则恢复到这次保存前接口确认过的值，并在卡片上显示错误。

### 设置风险

1. 成员选择「低」「中」「高」或「未评估」。
2. 卡片进入「保存中」。
3. Host 读取当前标签。若三个约定标签已经正好是目标集合，就不发更新。
4. 否则一次 `PUT`。选中低、中或高时，`add_labels` 只放目标标签，`remove_labels` 放另外两个。选中未评估时不发送 `add_labels`，`remove_labels` 放上全部三个约定标签。请求里不出现 `labels` 参数，因为空的 `labels` 会清掉议题上的全部标签。
5. 成功后用响应体替换卡片。无关标签保持原样。

### 在列之间移动

把卡片从「打开」拖到「已关闭」会关闭议题；反向拖动会重新打开。同一列内松手不产生请求，也不改变顺序。每张卡片另有「移动到打开」「移动到已关闭」，供键盘操作走同一条写入。已经处于目标状态时不发 `state_event`。

### 筛选

筛选栏有三项，改变任何一项都从第一页重新查询：

| 筛选项 | 默认 | 行为 |
| --- | --- | --- |
| 负责人 | 全部 | 选中一人时传该成员的 `assignee_id`。选「未指派」时传 `assignee_id=None`。 |
| 标签 | 不限制 | 选中的标签名用逗号连接，传给 `labels`。GitLab 要求议题同时带上每一个标签。 |
| 仓库 | 全部仓库 | 全部仓库走组议题接口。选中一个仓库后走该项目的议题接口。 |

风险没有单独的筛选项。要看高风险议题，在标签里选 `risk::high`。三个风险标签都出现在标签列表中。

筛选条件只放在浏览器当前这块看板的视图状态里。刷新页面后回到默认筛选。它们不写回 GitLab，也不是议题数据的副本。

### Agent 查询

成员可以让 agent 列出高风险或逾期议题。Agent 调用只读工具，Host 按第 5 节的固定查询访问 GitLab，把结果返回给模型。Agent 要改截止日期、风险或状态时，调用对应的写工具；写工具在联系 GitLab 之前进入 DSH 批准，成员允许这一次之后才发出 `PUT`。

## 3. 作为 DSH 插件的架构

### 三种对象

按 DSH 的打包与安装模型，Keel 分三层，并且只有 bundle 会被 `dsh plugin add` 激活：

| 对象 | Keel 里的职责 |
| --- | --- |
| Host 模块 | 在 DSH 进程内导出 `apply(ctx, config)`，注册工具、持有 GitLab 访问、提供 Remote 服务。 |
| Web 客户端 | 导出浏览器侧 `apply(ctx)`，向已有插槽注册「项目看板」。 |
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

行的 `name` 必须等于安装后的包名，这样 Node 能解析到包入口。补丁不写 GitLab 地址和令牌。配置默认值放在 Host 模块导出的 Schema 上；用户后来在 profile 自己的 `cordis.patch.yml` 里覆盖时，DSH 会整段替换该行的 `config`，所以用户的覆盖文件要写上仍需保留的字段。

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

同一份 `package.json` 还要有 `engines.dsh`。通过第 8 节时，把它写成当时 `dsh --version` 的次版本区间：版本 `X.Y.Z` 对应 `>=X.Y.0 <X.(Y+1).0`。DSH 启动器会拒绝不满足该区间的安装。发布提交里带上已构建的 `lib/`，不设置会在 `dsh plugin add` 时执行的 `prepare`，这样 pnpm 不需要 `allowBuilds`。依赖使用已发布的版本，不使用 `workspace:`。

### Host

Host 入口：

```js
export const name = 'keel'
export const inject = ['tools', 'credentials']

export function apply(ctx, config) {
  // 注册 KeelService，并在 ctx.effect 里注册工具与释放定时器和连接。
}
```

`inject` 使 Cordis 等到 `tools` 和 `credentials` 可用后才调用 `apply`。工具用 `@deepseek-ai/dsh-tools` 的 `defineTool`，再 `ctx.tools.register`。注册放在 `ctx.effect` 里，插件卸载时注册表会去掉这些工具。模块求值期间不访问网络、不读令牌、不定时器。

`Config` 用 `@deepseek-ai/schemastery` 导出同名接口和 Schema。三个字段都是 volatile，设置页修改后下一次操作就能读到新值，不需要为了改地址而重装插件：

| 字段 | 类型 | 默认 | 校验 |
| --- | --- | --- | --- |
| `baseUrl` | volatile string | 空字符串 | 空表示未配置。非空时必须是绝对源站：协议只允许 `http:` 或 `https:`，无用户信息、无查询、无片段，路径为空或 `/`。保存时去掉末尾斜杠。 |
| `groupPath` | volatile string | 空字符串 | 空表示未配置。非空时是 GitLab 组路径，例如 `acme/platform`。不允许前导或尾随斜杠，不允许出现 `://`。 |
| `tokenRef` | volatile string | `KEEL_GITLAB_TOKEN` | 必须是凭据引用：以字母或下划线开头，其余为字母、数字或下划线。这是 POSIX 环境变量名形式的 `CredentialRef`，不是令牌本身。 |

操作开始时读取 `config.baseUrl.get()`、`config.groupPath.get()` 和 `config.tokenRef.get()`。令牌通过 `ctx.credentials.resolve(tokenRef)` 现取。解析结果不放进字段、不写日志、不跨操作缓存。`resolve` 得到的空值视为未配置。

`KeelService` 继承 `TypertRemoteService`，命名空间是 `keel`。对 Web 开放的方法标 `@Remote`。生成的描述符放在包的 `./remote` 导出。Keel 不把自己加进官方 `dsh-api-remotes` 组装包。

### Web 客户端

客户端 `inject` 包含 `slots`、`locale`、`remote` 和 `layout`。`apply` 里先 `ctx.remote.$mount` 挂上 Keel 的 `./remote` 贡献，之后调用 `ctx.remote.keel` 的具体方法。组件不直接拿 `ctx`，也不在浏览器里保存 GitLab 令牌。

面板沿用 DSH 侧栏的成对插槽，和官方 `ui-sidebar` 的约定一致，也和仓内 `ui-schedule` 把任务页放进主区域的做法一致：

- 向根作用域列表 `sidebar.panellist` 注册一行。`id` 为 `keel`，`order` 为 `20`，`label` 为「项目看板」。
- 向根作用域 keyed 插槽 `main` 注册看板主体，`key` 与上面的 `id` 同为 `keel`。
- 两个注册都包在 `ctx.slots.inject(...)` 里，随插槽声明的生命周期挂上和卸下。

`MainPanelId` 使用字符串 `keel`。选中该行时，布局服务把主区域切到这个 `main` 键。缺少 `main` 注册时 DSH 会拒绝切换，因此两个注册必须同时存在。卸载插件会去掉这一行和主体。

客户端构建要符合该 `engines.dsh` 版本的 Web loader。成功与否以第 8 节「面板真实出现并完成一次写入」为准。

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

移除插件只卸下 DSH 里的注册，不修改 GitLab 上的议题、标签和截止日期。

### 进程内模块

```text
Web 客户端
  sidebar.panellist + main 插槽「项目看板」
  ctx.remote.keel.*          只传 JSON，不传令牌
        │
Host  KeelService
  工具 keel_*                读工具直接执行；写工具先走批准
  允许的 GitLab REST 调用
        │
自建 GitLab  /api/v4         唯一事实来源
```

浏览器里的筛选、页码、保存中的字段和错误文案是视图状态。判断「现在的截止日期是哪一天」时以 GitLab 响应为准。写操作在更新前会再 `GET` 一次该 Issue，不拿看板上一次列表的缓存当依据。

## 4. GitLab 集成

### 连接

`baseUrl` 是自建 GitLab 的源站，例如 `https://gitlab.example.com`。请求 URL 是 `baseUrl + /api/v4 + 路径`。HTTP 客户端关闭自动跳转：响应是 3xx 时视为失败，错误为「地址被重定向，请把 baseUrl 写成最终源站」，并且不把令牌发到另一个主机。

认证头是 `PRIVATE-TOKEN`。令牌使用组访问令牌；满足同一角色和范围的个人访问令牌也能通过连接检查。Keel 不解析令牌前缀，只看 API 结果。

令牌要求：

- 范围包含 `api`。只有 `read_api` 时，GET 可以被接受，POST 和 PUT 得到 403。
- 在目标组上至少是 Reporter。Reporter 可以查看议题、修改议题元数据、关闭和重新打开议题，以及创建组标签。Guest 不能修改已有议题的标签和截止日期。
- 全组一枚令牌，放在 DSH 凭据库，由 `tokenRef` 指向。

连接检查按这个顺序做：`GET /groups/:id`，再拉取允许的项目集合，再补齐三个风险标签，然后才列议题。组接口失败时不创建标签。

### 允许的端点

Host 只请求下列路径。其他路径在发出前就被拒绝。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/groups/:id` | 确认组存在，读取 `full_path` 和 `name`。 |
| `GET` | `/groups/:id/projects` | 建立允许写入的项目集合。 |
| `GET` | `/groups/:id/members/all` | 负责人下拉。 |
| `GET` | `/groups/:id/labels` | 标签下拉，以及确认风险标签。 |
| `POST` | `/groups/:id/labels` | 缺少约定风险标签时创建组标签。 |
| `GET` | `/groups/:id/issues` | 未选仓库时列出议题。 |
| `GET` | `/projects/:id/issues` | 选中一个仓库时列出议题。 |
| `GET` | `/projects/:id/issues/:issue_iid` | 写入前读取这一条议题。 |
| `PUT` | `/projects/:id/issues/:issue_iid` | 写截止日期、风险标签或状态。 |

`:id` 在组路径上使用 URL 编码后的 `groupPath`（`acme/platform` 写成 `acme%2Fplatform`）。项目 id 使用数字 `project_id`。`PUT` 的正文只允许 `due_date`、`add_labels`、`remove_labels`、`state_event` 这四个字段里的本次需要的那些。

每个请求超时 15 秒。`per_page` 最大 100。翻页跟随响应头 `x-next-page`，直到该头为空，或已经取了 20 页（2000 条）。议题列表和单条读取都带 `with_labels_details=true`。

### 项目边界

GitLab 的 `GET /groups/:id/issues` 在服务端写死 `include_subgroups: true`，会返回该组以及子组项目中的议题。Keel 不提供关闭子组的开关。v1 仍然只有一个组路径，不接受第二个组。

允许的项目集合来自：

```text
GET /groups/:id/projects?include_subgroups=true&with_shared=false&archived=false&simple=true&per_page=100
```

`with_shared=false` 排除只是分享进组、并不属于该组及子组的项目。`archived=false` 与议题接口默认跳过归档项目对齐。这个集合超过 2000 个项目时，看板显示「项目列表超过 2000 个，超出第一版支持的组规模」，不展示残缺看板，写工具返回 `keel/outside-group`。

选中「全部仓库」时调用组议题接口，并丢掉 `project_id` 不在允许集合里的议题。选中一个仓库时，先确认它在允许集合里，再调用该项目的议题接口。写入前同样确认 `project_id` 在允许集合里，否则不发 `PUT`。

### 列与字段

GitLab Issue 的 `state` 只有 `opened` 和 `closed`。看板因此只有两列：

| 列 | 查询 |
| --- | --- |
| 打开 | `state=opened`，`order_by=updated_at`，`sort=desc` |
| 已关闭 | `state=closed`，同样按 `updated_at` 降序 |

打开列从第 1 页连续取到最后一页，上限 2000 条。达到上限时列头写明「只显示最近更新的 2000 条打开议题」。已关闭列默认只请求第 1 页，最多 100 条。这一页还有下一页时，列头写明「最近更新的 100 条已关闭议题」，并显示「加载更早的已关闭议题」；已经是最后一页时，列头只显示实际条数。再加载之后，列头改为当前已加载条数。继续加载最多到 20 页。筛选一变，已关闭列回到第 1 页。

卡片不按 `relative_position` 排序，Keel 也不写这个字段。列内顺序就是本次查询的 `updated_at` 降序。

议题类型 `issue`、`incident`、`test_case`、`task` 都显示。类型不是 `issue` 时，卡片标出 GitLab 返回的 `issue_type`。`confidential` 为真时卡片标出「保密」。Keel 不提供修改类型或机密状态的控件。

### 截止日期

| 看板 | GitLab `due_date` |
| --- | --- |
| 未设置 | `null` |
| 具体日期 | `YYYY-MM-DD` |
| 清除 | `PUT` 字段 `due_date` 为空字符串，响应里为 `null` |

逾期不在本地用时区另算。打开列上的逾期标记，来自同一次筛选条件下附加 `state=opened` 与 `due_date=overdue` 的查询结果。某个 `(project_id, iid)` 出现在该结果里，对应的打开卡片就标为逾期。已关闭的议题即使日期已过也不标逾期。逾期查询同样最多 2000 条；超过时横幅写明「逾期标记不完整」，只标记已经返回的那些。Agent 的逾期工具直接使用这个 GitLab 过滤条件，不读取看板内存。

### 风险标签

约定的三个标签名，大小写敏感，必须完全一致：

| 看板选项 | 标签 | 新建时的颜色 | 说明 |
| --- | --- | --- | --- |
| 低 | `risk::low` | `#1F883D` | Keel 风险：低 |
| 中 | `risk::medium` | `#D4A017` | Keel 风险：中 |
| 高 | `risk::high` | `#CF222E` | Keel 风险：高 |
| 未评估 | 三个标签都不在议题上 | 不创建第四个标签 | 空状态，不是 `risk::none` |

连接检查时 `GET /groups/:id/labels?search=risk::&only_group_labels=true&include_ancestor_groups=false&include_descendant_groups=false`。某个名字不存在就 `POST /groups/:id/labels`，正文含 `name`、上表的 `color` 和 `description`。标签已经存在时不修改颜色和说明，避免覆盖团队后来改过的外观。并发创建得到「已存在」时再 `GET` 一次，名字在即可。

GitLab 的作用域标签（同名 `key::` 互斥）属于 Premium / Ultimate。Keel 不依赖这项能力。互斥由上面的 `add_labels` 与 `remove_labels` 在一次 `PUT` 里完成，Free 和 Premium 实例行为一致。

读取时的显示规则：

- 三个约定标签一个都没有：未评估。
- 恰好一个：显示对应的低、中或高。
- 多于一个：按高、中、低取最高的一个显示，并标「风险标签重复」。
- 存在其他以 `risk::` 开头、但不是这三个名字的标签：不把它当成低中高，卡片标「未识别的风险标签」，原标签仍留在标签区。

下一次把风险设为低、中或高时，`PUT` 会去掉三个约定标签里未被选中的那两个。选择「未评估」时去掉全部三个约定标签。两种写入都不删除那三个名字以外的标签。Keel 不在读取时偷偷改标签。

`add_labels` 在标签不存在时会新建项目级标签。因此风险写入前，三个组标签必须已经存在。创建组标签得到 403 时，读取仍可用，风险写入失败，错误码 `keel/labels-missing`，看板提示令牌不能创建组标签。Keel 不用项目级标签顶上。

### 同步与冲突

没有第二份事实来源，所以也不做版本向量或三方合并。

- 人在看板上的保存、拖拽，以及 agent 被批准后的写工具，都在返回成功之前完成 GitLab 的 `GET` 和必要的 `PUT`。
- 发起操作的界面用 `PUT` 的响应体更新那一张卡片。没有 `PUT` 的相同值读取，用 `GET` 的响应体更新。
- 其他打开着看板的客户端靠 10 秒拉取看到变化。拉取到的列表整列替换当前视图，但某张卡片若正有未完成的写入，则先保留它的保存中状态，等这次写入结束再用写入结果覆盖。
- 两个人先后改同一字段时，后一次成功的 `PUT` 留下。Keel 不弹出「对方已修改，请合并」。
- 截止日期、风险、状态三次写入互不覆盖对方的字段，因为每次 `PUT` 只带自己的参数。
- 列表缓存在面板卸载、筛选变更和插件卸载时丢掉。进程内不做议题数据库，不写本地文件来记住议题。

读请求遇到 429 时，等待 `Retry-After` 秒数，没有该头就等待 1 秒，然后重试一次。写请求不重试。其他失败不重试。

| HTTP | 看板文案 | 工具码 |
| --- | --- | --- |
| 无法连接或超时 | 无法连接 GitLab | `keel/gitlab-unavailable` |
| 3xx | 地址被重定向，请把 baseUrl 写成最终源站 | `keel/gitlab-unavailable` |
| 401 | 令牌无效或已过期 | `keel/unauthorized` |
| 403 | 令牌权限不足 | `keel/forbidden` |
| 404 | 组、项目或议题不存在，或当前令牌看不到它 | `keel/not-found` |
| 429 | GitLab 限流，请稍后再试 | `keel/rate-limited` |
| 其他 5xx | GitLab 暂时不可用 | `keel/gitlab-unavailable` |
| 配置不完整 | 尚未配置 GitLab 连接 | `keel/not-configured` |
| 项目不在允许集合 | 该仓库不在已配置的组内 | `keel/outside-group` |
| 风险标签无法就绪 | 令牌不能创建组标签 | `keel/labels-missing` |
| 参数不合法 | 输入不符合约定格式 | `keel/invalid-input` |

错误文案里不回显令牌、`PRIVATE-TOKEN` 或 `Authorization` 头。日志只记录方法、路径和状态码。

## 5. 数据模型与 API / 工具

### 视图模型

下面的结构是 GitLab 响应的投影，不是要落库的表。列表接口和写接口都返回它。

```ts
interface KeelIssue {
  projectId: number
  projectPath: string
  iid: number
  title: string
  state: 'opened' | 'closed'
  issueType: string
  confidential: boolean
  dueDate: string | null
  overdue: boolean
  risk: 'low' | 'medium' | 'high' | null
  riskConflict: boolean
  labels: { name: string; color: string | null }[]
  assignees: { id: number; username: string; name: string }[]
  webUrl: string
  updatedAt: string
}
```

字段来源：

- `projectId`、`iid`、`title`、`state`、`issueType`、`confidential`、`webUrl`、`updatedAt` 分别来自 Issue 的 `project_id`、`iid`、`title`、`state`、`issue_type`、`confidential`、`web_url`、`updated_at`。
- `projectPath` 来自允许项目集合里的 `path_with_namespace`。集合里没有这条路径时，使用 Issue `references.full` 里 `#` 之前的路径。
- `dueDate` 来自 `due_date`，没有日期时为 `null`。
- `overdue` 在列表结果里按第 4 节判断：同一次筛选加上 `due_date=overdue` 的结果集包含该 `(projectId, iid)` 时为 `true`。单条写入的返回值另算：`state` 不是 `opened` 或 `dueDate` 为 `null` 时为 `false`；否则请求 `GET /projects/:id/issues?state=opened&due_date=overdue&iids[]=<iid>&per_page=1`，响应中有这条议题则为 `true`。这次操作只改了风险时不发该请求，沿用写入前的 `overdue`。
- `risk` 与 `riskConflict` 按第 4 节的标签规则从 `labels` 算出。
- `labels` 保留 GitLab 返回的全部标签，包括三个风险标签。颜色来自 `with_labels_details=true` 的 `color`；响应没有颜色时为 `null`。
- `assignees` 来自 `assignees` 数组的 `id`、`username`、`name`。

卡片的稳定键是 `${projectId}:${iid}`。`iid` 只在项目内唯一。

### Remote 方法

Web 客户端只调用这些方法。方法返回 `KeelIssue` 或下面的列表结构，不返回令牌。

| 方法 | 作用 |
| --- | --- |
| `connection()` | 返回 `{ configured, baseUrl, groupPath, groupFullPath, tokenConfigured, tokenMasked, labelsReady }`。`tokenMasked` 来自 `credentials.describe` 的掩码，没有值时为 `null`。 |
| `setToken(value)` | `credentials.set(tokenRef, value)`。`value` 为空则拒绝。响应只有 `{ configured: true }`。 |
| `clearToken()` | `credentials.unset(tokenRef)`。 |
| `listMembers()` | 允许集合所用的组成员，供负责人下拉。超过 2000 人时失败，不返回半截名单。 |
| `listLabels()` | 标签下拉。超过 2000 个时失败。 |
| `listProjects()` | 允许的项目集合，元素为 `{ projectId, projectPath }`。 |
| `listIssues(query)` | 看板两列使用的查询。 |
| `setDueDate({ projectId, iid, dueDate })` | `dueDate` 为 `YYYY-MM-DD` 或空字符串。 |
| `setRisk({ projectId, iid, risk })` | `risk` 为 `low`、`medium`、`high` 或 `none`。`none` 表示未评估。 |
| `setState({ projectId, iid, state })` | `state` 为 `opened` 或 `closed`，对应 `state_event` 的 `reopen` 或 `close`。 |

`listIssues` 的查询：

```ts
interface KeelListQuery {
  state: 'opened' | 'closed'
  assigneeId?: number | 'None'
  labels?: string[]
  projectId?: number
  page: number
  perPage: number
}
```

`perPage` 只允许 1 到 100。`listIssues` 一次只返回 GitLab 的一页。看板打开列从 `page=1`、`perPage=100` 连续请求，直到 `nextPage` 为 `null`，或已经拿到第 20 页。已关闭列先只请求第 1 页；每按一次「加载更早的已关闭议题」再请求下一页，最多 20 页。响应：

```ts
interface KeelListPage {
  issues: KeelIssue[]
  page: number
  perPage: number
  nextPage: number | null
  truncated: boolean
}
```

`truncated` 在这一页的 `page` 为 20 且 GitLab 仍给出下一页时为 `true`，其余情况为 `false`。打开列此时显示「只显示最近更新的 2000 条打开议题」。已关闭列达到同样上限时停止加载，并写明只显示最近更新的 2000 条已关闭议题。

`setDueDate`、`setRisk`、`setState` 被人从看板调用时不经过 agent 批准。成员的选择、清除或拖放就是这次写入的确认。它们仍然做项目边界检查，并且只在 GitLab 成功后返回。

### Agent 工具

工具用 `defineTool` 注册。描述使用中文，并写明标签名和枚举，避免模型自造标签。

只读工具不进入批准：

| 工具 | 参数 | 查询 |
| --- | --- | --- |
| `keel_list_issues` | `state` 默认 `opened`；可选 `assigneeId`、`labels`、`projectId`；`page` 默认 1；`perPage` 默认 20，最大 100 | 与看板相同的组或项目接口 |
| `keel_list_high_risk` | `page`、`perPage`，默认同上 | `state=opened`，`labels=risk::high`，`order_by=updated_at`，`sort=desc` |
| `keel_list_overdue` | `page`、`perPage`，默认同上 | `state=opened`，`due_date=overdue`，`order_by=due_date`，`sort=asc` |

三个只读工具都返回 `KeelListPage`。高风险和逾期工具不接受额外筛选，这样「高风险」「逾期」的含义固定。带有多个风险标签但包含 `risk::high` 的议题会出现在高风险结果里，并且 `riskConflict` 为 `true`。

写工具：

| 工具 | 参数 | GitLab |
| --- | --- | --- |
| `keel_set_due_date` | `projectId`，`iid`，`dueDate`（`YYYY-MM-DD` 或空字符串） | 与 Remote `setDueDate` 相同 |
| `keel_set_risk` | `projectId`，`iid`，`risk`（`low`、`medium`、`high`、`none`） | 与 Remote `setRisk` 相同 |
| `keel_set_state` | `projectId`，`iid`，`state`（`opened`、`closed`） | 与 Remote `setState` 相同 |

写工具成功时返回更新后的 `KeelIssue`。

同一插件监听 `tools/pre-execute`。工具名是 `keel_set_due_date`、`keel_set_risk` 或 `keel_set_state` 时，返回：

```ts
{ kind: 'ask', reason, displayReason }
```

`reason` 是审计用的单行文本，包含工具名、`projectPath` 或 `projectId`、`iid` 和目标值。`displayReason` 同时给出 `zh` 和 `en`，例如「Keel 将把 acme/app#12 的风险设为高」。其他工具调用 `next()`，不拦截。

DSH 的批准结果只有 `allowed-once` 才继续执行。`rejected`、`cancelled`、`unavailable`，以及会话策略 `never`，都不访问 GitLab。`ask` 在缺少批准服务时按 DSH 的规则失败关闭。Keel 不把「始终允许该工具」写进自己的配置。

人在看板上的 Remote 写入不经过 `tools/pre-execute`。

## 6. 看板界面

主区域自上而下是：标题栏、筛选栏、两列看板。宽度小于 768px 时两列改为上下排列，筛选栏的三个控件各占一行。这个宽度与 DSH 侧栏改为抽屉的断点一致。

### 标题栏

- 标题文字是「项目看板」。
- 连接正常时显示 GitLab 组的 `full_path`。
- 状态为「已连接」「未配置」或「连接失败」三者之一。
- 显示最近一次成功拉取的本地时间。
- 「刷新」按钮立即按当前筛选拉取。正在拉取时按钮不可重复触发。

### 未配置

`baseUrl`、`groupPath` 有空值，或当前 `tokenRef` 解析不到令牌时，主区域不显示空列，而显示连接表单：

- GitLab 源站。
- 组路径，说明文字给出例子 `acme/platform`，并写明只填路径，不填整段网址。
- 令牌。输入框是密码框，提交后清空。旁边显示 `credentials.describe` 的掩码；未配置时显示「尚未保存令牌」。
- 说明：令牌保存在 DSH 凭据库，配置里只保留引用名 `tokenRef`。请使用该组的组访问令牌，角色不低于 Reporter，范围包含 `api`。
- 「保存并连接」先通过设置接口写 `baseUrl` 和 `groupPath`，再调用 `setToken`，然后跑连接检查。
- 「清除令牌」调用 `clearToken`。

`baseUrl` 和 `groupPath` 也出现在 DSH 对该插件行的设置表单里，因为它们是 volatile Config。令牌值不是 Config 字段，设置表单里看不到它。

### 筛选栏

三个控件都有可见标签：「负责人」「标签」「仓库」。

- 负责人的选项是「全部」「未指派」，然后是 `listMembers()` 的 `name` 与 `username`。
- 标签是多选，选项来自 `listLabels()`，选项文字是标签名。
- 仓库的选项是「全部仓库」，然后是 `listProjects()` 的 `projectPath`。

成员、标签或项目列表因为超过 2000 而失败时，对应控件显示错误并不提供残缺选项。另外两个筛选项和未使用该失败维度的看板仍可使用。标签列表失败时，不能靠手工输入半个标签名去查询。

### 列与卡片

每列有列名和已加载条数。打开列在 `truncated` 时追加「只显示最近更新的 2000 条打开议题」。已关闭列在仍有下一页且未到第 20 页时显示「加载更早的已关闭议题」；到达截断时改为「只显示最近更新的 2000 条已关闭议题」。没有议题时，列内显示「没有议题」。

卡片内容：

- 标题。
- `projectPath` 与 `#iid`。这个控件是指向 `webUrl` 的链接，在新标签打开，`rel` 为 `noopener`。打开链接不离开看板。
- 负责人姓名。没有负责人时显示「未指派」。
- 截止日期控件：日期选择器加上「清除」。
- 风险控件：未评估、低、中、高。重复或未识别时在控件旁显示第 4 节的标记。
- 其余标签做成色块；三个约定风险标签不再在这里重复一遍。
- 逾期的打开卡片写出「逾期」二字，不只靠颜色区分。
- 非 `issue` 类型和「保密」以短标签标出。

保存中的控件禁用，文案是「保存中」。失败时该字段回到保存前的确认值，卡片底部显示第 4 节的文案和「重试」。成功只在响应到达后呈现。看板上不显示一个本地先勾上、等同步再确认的状态。

拖拽的目标是另一列的列体。拖到同一列或列外则取消。拖动期间不调用接口。

### 刷新节奏

面板被选中后立即拉取，之后每 10 秒拉取一次。上一次拉取还没结束就跳过这个节拍。写入进行中不让这次拉取覆盖该卡片。成员切走面板时，`ctx.effect` 或面板卸载回调清掉这个定时器。插件卸载同样清掉。

## 7. 权限、凭据与安全

### 令牌放在哪里

DSH 的凭据缝把秘密关在配置外面。`cordis.patch.yml` 和设置文档只保存 `tokenRef` 这个环境变量式引用。令牌值由 `ctx.credentials.set` 写入当前凭据提供者。本地提供者的存储位置是 `$DSH_HOME/.credentials.yaml`。设置接口对客户端的读取会去掉秘密；Keel 的 Remote 读取也不返回令牌，只返回 `describe` 的 `configured`、`masked` 和 `writable`。

每次 GitLab 调用重新 `resolve`。在连接页更换令牌后，下一次调用使用新值，不需要重启 `dsh web`。更换 `tokenRef` 这个名字不会把旧键里的值复制过去，必须重新输入令牌。Keel 不列举或删除引用名以外的凭据。

### 谁可以写

| 路径 | 何时真正 `PUT` |
| --- | --- |
| 看板 Remote | 成员完成日期选择、风险选择或列移动。不弹第二层 DSH 批准框。 |
| Agent 写工具 | `tools/pre-execute` 返回 `ask`，且本次批准结果为 `allowed-once`。 |
| 读取、连接检查、创建缺失的风险标签 | 不走 agent 批准。创建标签只在连接检查里按三个固定名字执行。 |

共享令牌的权限就是看板和 agent 的权限上限。令牌能做的事比 Keel 实际调用的多，因此 Host 用第 4 节的路径白名单和 `PUT` 字段白名单收紧行为，而不是假设 GitLab 令牌本身只有 Issue 范围。

### 失败时关闭

- 未配置、项目不在组内、批准没有明确允许，都不发写入。
- 不跟随跨主机重定向。
- 不把令牌写进工具结果、Remote 响应、看板状态、仓库文件或日志。
- 不在模块导入时读取 `process.env` 里的令牌。需要令牌时只走 `credentials.resolve`。
- 卸载时释放定时器、未完成请求的 `AbortSignal`、工具注册和插槽。卸载不回滚已经写到 GitLab 的变更。

## 8. 测试与第一版成功标准

### 自动测试

单元测试覆盖纯逻辑，不连接真实 GitLab：

- `baseUrl`、`groupPath`、`tokenRef` 的接受与拒绝，包括带用户信息的 URL、带路径的 URL、整段组网址、以及空令牌。
- 风险解析：无标签、单一标签、两个以上约定标签时取高者并标冲突、未知 `risk::` 标签。
- 风险 `PUT` 在设为低、中或高时只含目标 `add_labels` 和另外两个 `remove_labels`；设为未评估时只含三个 `remove_labels`。两种请求都不包含 `labels`。
- 清除截止日期发送空字符串；不修改时不发 `PUT`。
- `state_event` 只使用 `close` 和 `reopen`。
- 项目不在允许集合时写入被拒绝。
- 错误对象和日志样例里搜索不到测试令牌。
- 分页在 `x-next-page` 为空时停止，第 20 页仍有下一页时把打开列标为截断。

契约测试使用固定的 GitLab JSON 样本，断言投影后的 `KeelIssue`。样本放在测试目录，不从网络现拉。

默认测试命令不访问真实 GitLab。另有一个需要环境变量 `KEEL_GITLAB_TEST_BASE_URL`、`KEEL_GITLAB_TEST_GROUP` 和 `KEEL_GITLAB_TEST_TOKEN` 的集成测试，对一个一次性项目执行：创建缺失标签、设置日期、设置风险、关闭、重新打开、确认无关标签还在。没提供这三个变量时跳过，不作为默认失败。

客户端测试覆盖：默认筛选、标签 AND 的查询参数、保存中不会在响应前变成成功、失败后恢复原值、同一列放下不发请求。

### 成功标准

下面每一条都在团队实际使用的 `dsh web` 上可以核验。`engines.dsh` 写成这次 `dsh --version` 的次版本区间。

1. `dsh plugin --profile web add` 之后，`dsh --profile web --dump-config` 出现 `keel` 层和 id 为 `keel` 的行。重启 `dsh web` 后插件处于加载状态。
2. 左侧栏有「项目看板」。点开后主区域是两列：打开、已关闭。配置为空时看到的是连接表单，不是空列。
3. 填入一个自建 GitLab 的源站、一个组路径和一枚符合第 4 节的令牌后，看板列出该组及子组里、且属于允许项目集合的 Issue。归档项目不出现。
4. 把一张卡片的截止日期设为某一天，GitLab 上该 Issue 的 `due_date` 变为这一天，卡片与响应一致。清除之后 `due_date` 为 `null`。
5. 把风险设为高，该 Issue 带有 `risk::high`，不带 `risk::low` 和 `risk::medium`，原有的其他标签还在。设为未评估后三个约定标签都消失。
6. 把卡片拖到另一列，或使用「移动到已关闭」「移动到打开」，GitLab 的 `state` 相应变为 `closed` 或 `opened`。
7. 负责人、标签、仓库三个筛选会改变发往 GitLab 的查询。标签筛选是 AND。仓库筛选不会查询允许集合之外的项目。
8. `keel_list_high_risk` 的结果与 `state=opened` 且 `labels=risk::high` 的 GitLab 查询一致。`keel_list_overdue` 与 `state=opened` 且 `due_date=overdue` 的查询一致。
9. 在批准结果变成 `allowed-once` 之前，三个写工具不产生 GitLab `PUT`。拒绝或无人批准时议题不变。
10. `dsh --profile web --dump-config`、工具输出、浏览器里的 Remote 响应和插件日志都不含令牌明文。
11. 停用或移除插件后，侧栏入口、主面板、工具和 10 秒拉取都消失。GitLab 上已写过的日期、标签和状态保持原样。
12. 插件目录和 `$DSH_HOME` 里不存在以 Keel 命名的议题数据库或同步账本。议题内容只出现在当次请求的内存响应里。

## 9. 第一版不做

实现时遇到下列需求，保持现状并改文档后再做，不在第一版里部分实现：

- 与表格、CSV 或另一套看板的双向同步。
- 把 GitLab Board 的列表、Milestone、Merge Request、Epic 或迭代当成 Keel 的对象。Issue 响应里如果带着 milestone 字段，卡片忽略它。
- 配置多个顶层组，或按部门做组目录。一个 `groupPath` 加上它的子组就是全部范围。
- 引用或嵌入 ChunSun、`dsh-pm`、`dsh-agent-team` 的服务、路由或数据。
- 新建议题、编辑标题或描述、改负责人、写评论、上传设计稿、记录工时。
- 拖拽排序并写回 `relative_position`。
- 按人分别授权的 GitLab 登录。
- Webhook、长轮询以外的推送，或短于 10 秒的固定拉取。10 秒是打开面板时的间隔，不是可配置项。
- 在读取时自动改正重复的风险标签。
- 为风险创建 `risk::none` 或其他第四个等级。

## 依据

DSH 的插件形状以这些公开文档为准：

- [打包并安装插件](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)：`dsh.bundle`、`cordis.patch.yml`、profile 的 `dsh.profile.bundles`，以及 `dsh plugin --profile <name> add`。
- [插件配置](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/config) 与 [配置表单](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-settings-card)：导出 Schema `Config`，volatile 字段用 `.get()` 读取。
- [编写工具](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool)：`inject = ['tools']`，`ctx.tools.register(defineTool(...))`。
- [工具子系统](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools)：`tools/pre-execute` 返回 `ask`，只有 `allowed-once` 继续执行。
- [用户批准](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/approval)：批准结果是 `allowed-once`、`rejected`、`cancelled` 或 `unavailable`。
- [用户凭据](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/credentials)：配置保存 `CredentialRef`，`ctx.credentials.resolve` 每次操作读取，空值视为未配置。
- [Web Client 插槽](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/slots) 与 [ui-sidebar](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/client/ui-sidebar/README.md)：`sidebar.panellist` 的 `id` 对应 `main` 插槽的同一个键。
- [API Gateway](https://deepseek-harness.github.io/deepseek-harness/en/reference/api-gateway)：`@Remote` 方法经 `ctx.remote.$mount` 挂到客户端，不改官方组装包。

GitLab 行为以这些文档和实现为准：

- [Issues API](https://docs.gitlab.com/api/issues/)：组与项目的议题列表、`due_date`、`add_labels`、`remove_labels`、`state_event`。空的 `labels` 会移除全部标签，所以 Keel 不发送它。
- GitLab `lib/api/issues.rb` 对组议题路由写死 `include_subgroups: true`。
- [Group labels API](https://docs.gitlab.com/api/group_labels/) 与 [Labels](https://docs.gitlab.com/user/project/labels/)：组标签的创建；`key::value` 的互斥属于 Premium / Ultimate。
- [权限](https://docs.gitlab.com/user/permissions/)：修改议题元数据、关闭议题和创建标签至少需要 Reporter。
- [REST 认证](https://docs.gitlab.com/api/rest/authentication/)：`PRIVATE-TOKEN` 头。
