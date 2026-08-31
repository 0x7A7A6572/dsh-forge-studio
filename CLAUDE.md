# dsh-desk-studio

用 dsh 插件范式重做 Forge Studio 功能（F1 便签/F2 天气/F3 翻译/F4 提醒/F5 定时任务/F7 设置）。

## 命令
- `pnpm install` — 装 workspace（含本地 dsh CLI）
- `pnpm dev` — 启动 dsh web（`$DSH_HOME=.dsh-home`，profile=web）
- `pnpm dsh -- <args>` — 直接调 dsh CLI（如 `pnpm dsh plugin --profile web list`）
- `pnpm test` — 全 workspace vitest

## 硬性规则
- 每个功能一个 `packages/plugin-<name>`，命名 `@forge-studio/dsh-plugin-<name>`。
- 依赖只指向 Service Definition 包；client 对跨插件值一律 type-only import。
- 数据持久化只用 `ctx.storage`（storage-json），不自造。
- 会话事件是 UI 唯一数据源；UI 节点只从事件流折叠渲染。
- `$DSH_HOME=.dsh-home`（仓库内，已 gitignore）；dsh 运行时锁 0.1.1-rc.2。
- npm 包版本显式锁死，不用 `^`/`@latest`（npmmirror 镜像 latest 标签过期）。
