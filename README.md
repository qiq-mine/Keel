# Keel

Keel 是装进团队 DeepSeek Harness（DSH）`web` profile 的插件。它给 5 到 15 人的团队一块「项目看板」，用来看需求、任务、截止日期、风险和状态。

看板的事实来源是团队自建的 GitLab。状态列使用约定标签 `status::todo`、`status::doing`、`status::blocked`、`status::done`。某个仓库的议题上还没有这些标签时，看板回退为「打开」和「已关闭」。截止日期写回 Issue 的 `due_date`，风险写回 `risk::low`、`risk::medium`、`risk::high`。Keel 不另建一套本地台账。

同时支持按仓库长期保留的企业微信周报与月报。每个 GitLab 仓库在企业微信微盘指定目录下对应一份文档，每周五 10:00（Asia/Shanghai）自动追加周报小节，月末最后一个周五自动追加月报；也可在看板界面上先预览再写入。

完整设计见 [docs/superpowers/specs/2026-11-18-keel-design.md](docs/superpowers/specs/2026-11-18-keel-design.md) 和 [docs/superpowers/specs/2026-11-18-keel-weekly-report-design.md](docs/superpowers/specs/2026-11-18-keel-weekly-report-design.md)。实现计划见 [docs/superpowers/plans/2026-11-18-keel-board-core.md](docs/superpowers/plans/2026-11-18-keel-board-core.md)。

## 安装

在能访问这个包的目录执行：

```sh
dsh plugin --profile web add ./
```

安装某个已经固定的公开提交：

```sh
dsh plugin --profile web add github:qiq-mine/Keel#<40位commit>
```

包里已经带上构建好的 `lib/`，安装时不会跑 `prepare`，因此不需要在 profile 里为这个包打开 `allowBuilds`。

装好之后确认组合里有这一层：

```sh
dsh --profile web --dump-config
```

输出中应能看到名为 `keel` 的补丁层，以及 id 为 `keel` 的行。已经在跑的 `dsh web` 要重新启动，新的 bundle 才会进进程。

卸下插件只去掉 DSH 里的注册，不修改 GitLab 上的议题、标签和截止日期：

```sh
dsh plugin --profile web remove keel
```

## 连接

左侧栏点「项目看板」。还没配好时，主区域是连接表单，不是空列。

- GitLab 源站只填源站，例如 `https://gitlab.example.com`。不要带路径、账号或查询参数。
- 组路径只填路径，例如 `acme/platform`，不要填整段网址。
- 「允许自签证书」默认关闭。打开后只放宽这个 GitLab 源站的信任库校验，主机名仍然要和证书匹配。企业微信不使用这个开关。
- 令牌用该组的组访问令牌，角色不低于 Reporter，范围包含 `api`。令牌写进 DSH 凭据库，配置里只保留引用名，默认是 `KEEL_GITLAB_TOKEN`。

`baseUrl`、`groupPath`、`tokenRef`、`allowSelfSigned` 和企业微信的非秘密字段也会出现在 DSH 对该插件行的设置表单里。令牌和应用 Secret 不是配置字段。

## 看板和工具

有状态标签的仓库显示待办、进行中、阻塞、完成和未分状态。还没有状态标签的仓库显示打开和已关闭。卡片和右侧抽屉可以改截止日期、风险和状态。抽屉里可以关闭或重新打开议题，描述、评论和动态只读。里程碑标题只显示。

顶部有逾期、本周到期、高风险、未评估四项计数。筛选还有搜索、只看我的、风险、负责人、标签和仓库。看板和列表共用这套筛选。

`c` 打开新建议题，`/` 聚焦搜索，`1` 到 `4` 设置状态，Enter 打开抽屉，Esc 关闭抽屉或快捷键说明。焦点在输入框里时，除 Esc 以外的快捷键不触发。

「送到会话分析」把这一条议题放进当前会话或一个新会话，供只读分析。

Agent 可以使用 `keel_list_issues`、`keel_list_high_risk`、`keel_list_overdue`、`keel_list_due_this_week`、`keel_list_unassessed`、`keel_get_issue`、`keel_list_notes`。`keel_create_issue`、`keel_set_due_date`、`keel_set_risk`、`keel_set_status`、`keel_set_state` 在真正写入前会请求一次 DSH 批准，只有 `allowed-once` 才会发请求。

## 企业微信周报

Keel 支持按仓库长期维护一份企业微信文档，记录各周的交付变化与状态分布。

- **配置**：在连接表单或 DSH 设置中配置企业 ID（`wecomCorpId`）、微盘空间（`wecomSpaceId`）、微盘目录（`wecomFatherId`）以及应用 Secret（保存在 DSH 凭据库，默认引用名 `KEEL_WECOM_SECRET`）。
- **权限**：企业微信自建应用必须具备微文档（`wedoc`）和微盘（`wedrive`）权限。
- **手动预览与写入**：点击看板标题栏的「立即生成本周周报」，会弹出预览对话框，展示各仓库本周的四项指标、当前快照（进行中/阻塞/高风险）和按负责人分布。确认无误后点击「写入企业微信」执行写入；正文相同则跳过。
- **定时与补跑**：在 `dsh web` 运行期间，每周五 10:00（Asia/Shanghai）自动执行周报生成并写入；月末最后一个周五自动聚合月报。进程启动时若刚过周五（周一 10:00 前），会自动执行补跑。定时器仅在进程运行时有效。

## 开发

```sh
npm install
npm run build
npm test
npm run lint
```

默认测试不访问真实 GitLab。要对一个一次性项目做实连，设置 `KEEL_GITLAB_TEST_BASE_URL`、`KEEL_GITLAB_TEST_GROUP` 和 `KEEL_GITLAB_TEST_TOKEN`。没提供这三个变量时，集成测试会跳过。
