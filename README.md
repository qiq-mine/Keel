# Keel

Keel 是装进团队 DeepSeek Harness（DSH）`web` profile 的插件。它给 5 到 15 人的团队一块「项目看板」，用来看需求、任务、截止日期和风险。

看板的事实来源是团队自建的 GitLab。第一版只读写 GitLab Issue：列按议题状态划分，截止日期写回 Issue 的 `due_date`，风险写回约定标签 `risk::low`、`risk::medium`、`risk::high`。Keel 不另建一套本地台账。

完整的产品与技术设计见 [docs/superpowers/specs/2026-11-18-keel-design.md](docs/superpowers/specs/2026-11-18-keel-design.md)。

本仓库当前包含这份设计说明与 MIT 许可证。插件包还没有放进仓库。
