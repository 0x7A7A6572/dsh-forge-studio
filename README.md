# dsh-forge-studio

聚合多个独立 dsh 日常插件的 monorepo。每个功能一个 `packages/plugin-<name>`，统一命名 `@zzerx/dsh-plugin-<name>`，发布到 npm 的公开包。

## 插件

| 包 | 说明 | 版本 | 状态 |
|---|---|---|---|
| [`@zzerx/dsh-plugin-notes`](packages/plugin-notes) | 便签板：侧栏 / 输入栏 / 回复下方三处入口记一笔，纸卡墙 · 行式列表 · 任务泳道三视图；便签能变任务交给 AI 在指定工作区执行，或按日程定时跑；Markdown、贴图、WebDAV 备份 | 0.4.1 | ✅ 已发布 |
| [`@zzerx/dsh-plugin-daily-log`](packages/plugin-daily-log) | 工作日志：把 Git 提交与本地 agent 对话（DeepSeek / Claude / Codex）汇总成日报 · 周报 · 月报；agent 工具按需注入，默认只挂 1 个 `daily_log` 派发器 | 0.4.0 | ✅ 已发布 |
| [`@zzerx/dsh-plugin-memory`](packages/plugin-memory) | 记忆与进化：跨会话记住偏好、身份与项目决策（全局 / 项目双作用域），开场自动注入，实体与边的记忆图谱；入口是设置面板一级「记忆」分区 | 0.4.1 | ✅ 已发布 |
| [`@zzerx/dsh-plugin-usage-billing`](packages/plugin-usage-billing) | 用量与计费：从既有会话日志聚合真实 token 用量，按事件发生时刻的价格写时锁定费用；侧栏 / 输入框下方两个入口 + 点击弹层 + 设置页用量视图 | 1.1.0 | ✅ 已发布 |
| [`@zzerx/dsh-plugin-home-studio`](packages/plugin-home-studio) | 工作台：聚合日常功能入口的骨架包，host / client 均为空占位，UI 待填充 | 0.2.0 | 🚧 骨架，未发布、未接入本地 profile |

> 版本列 = 本仓库该包 `package.json` 的版本（含尚未发布的那一版）；`状态` 列说的是有没有上 npm。

## 安装

已发布的四个插件直接装进你的 profile，重启宿主后生效：

```bash
dsh plugin --profile <你的 profile 名> add @zzerx/dsh-plugin-notes
dsh plugin --profile <你的 profile 名> add @zzerx/dsh-plugin-daily-log
dsh plugin --profile <你的 profile 名> add @zzerx/dsh-plugin-memory
dsh plugin --profile <你的 profile 名> add @zzerx/dsh-plugin-usage-billing
```

只剩[工作台](packages/plugin-home-studio/README.md)还没上 npm，只能在本地以 `link:` 方式挂进 profile，步骤见它的 README。
本仓库的 `.dsh-home/profiles/web/package.json` 就是这么挂的（含前面的四个）。

## 本地开发

```bash
pnpm install   # 装 workspace（含本地 dsh CLI）
pnpm dev       # 起 dsh web：$DSH_HOME=.dsh-home，端口 3180
```

| 命令 | 作用 |
|---|---|
| `pnpm dsh <args>` | 直接调 dsh CLI，例如 `pnpm dsh plugin --profile web list` |
| `pnpm build` | 递归构建全部插件：tsdown 出 `lib/index.js` + `lib/client.js` + `lib/types` |
| `pnpm typecheck` | 递归 `tsc --noEmit` |
| `pnpm lint` / `pnpm lint:fix` | oxlint（规则清单见 `.oxlintrc.json`） |
| `pnpm test` | vitest 跑 `scripts/**/*.spec.ts`：客户端样式编译契约 + module.css 外来类名门禁 |
| `pnpm check` | lint → typecheck → test → build，提交前一次过 |

单个包开发时用 pnpm 过滤：

```bash
pnpm --filter @zzerx/dsh-plugin-notes typecheck
pnpm --filter @zzerx/dsh-plugin-notes build
```

## 目录

```
packages/
  plugin-notes/          便签板
  plugin-daily-log/      工作日志
  plugin-memory/         记忆与进化
  plugin-usage-billing/  用量与计费
  plugin-home-studio/    工作台（骨架）
scripts/
  tsdown.client.mjs      客户端包共享构建预设（客户端 CSS 走 lightningcss）
  client-bundle-css.spec.ts  样式编译契约与类名门禁
docs/superpowers/        设计与计划留档（plans / specs）
.dsh-home/               本地开发用的 DSH_HOME（profile: web）
```

## 约定

- [CLAUDE.md](CLAUDE.md) —— 硬性规则：一个功能一个包、依赖只指向 Service Definition、持久化只走 `ctx.storage`。
- [CONVENTIONS.md](CONVENTIONS.md) —— 目录与命名：文件自报家门，页面按「视图 / 样式 / 逻辑」三件套拆。
- 任何 `*.log`（调试 / 安装 / 构建 / 测试输出）一律落盘到 `.research/logs/`，不放仓库根目录或 `packages/` 源码目录。

## License

各插件包均为 MIT。
