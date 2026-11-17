# Keel

Keel 是装进团队 DeepSeek Harness（DSH）`web` profile 的插件。它给 5 到 15 人的团队一块「项目看板」，用来看需求、任务、截止日期、风险和状态，并把每个仓库的周报、月报追加到一份长期保留的企业微信文档。

看板的事实来源是团队自建的 GitLab。第一版读写 GitLab Issue：状态列使用约定标签 `status::todo`、`status::doing`、`status::blocked`、`status::done`，项目的议题上还没有这些标签时回退为打开和已关闭；截止日期写回 Issue 的 `due_date`；风险写回 `risk::low`、`risk::medium`、`risk::high`。企业微信文档只是周报导出。Keel 不另建一套本地台账。

完整的产品与技术设计见 [docs/superpowers/specs/2026-11-18-keel-design.md](docs/superpowers/specs/2026-11-18-keel-design.md)。

本仓库当前包含这份设计说明与 MIT 许可证。插件包还没有放进仓库。
