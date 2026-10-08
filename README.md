# dsh-forge-studio

聚合多个独立 dsh 日常插件的 monorepo。每个功能一个 `packages/plugin-<name>`，统一命名 `@zzerx/dsh-plugin-<name>`，发布到 npm 的公开包。

## 插件

| 包名 | 说明 |
|---|---|
| [`@zzerx/dsh-plugin-notes`](packages/plugin-notes) | 便签版，支持任务泳道，定时任务等 |
| [`@zzerx/dsh-plugin-daily-log`](packages/plugin-daily-log) | 工作报告，将git提交信息以及agent对话历史总结成报告 | 
| [`@zzerx/dsh-plugin-memory`](packages/plugin-memory) | 记忆与进化：支持全局/项目记忆 | 
| [`@zzerx/dsh-plugin-usage-billing`](packages/plugin-usage-billing) | 用量与计费显示 | 



## 安装

已发布的四个插件直接装进你的 profile，重启宿主后生效：

```bash
dsh plugin --profile web add @zzerx/dsh-plugin-notes
dsh plugin --profile web add @zzerx/dsh-plugin-daily-log
dsh plugin --profile web add @zzerx/dsh-plugin-memory
dsh plugin --profile web add @zzerx/dsh-plugin-usage-billing

# 桌面版则直接输入包名安装
@zzerx/dsh-plugin-notes
...
```

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
scripts/
  tsdown.client.mjs      客户端包共享构建预设
  client-bundle-css.spec.ts  样式编译契约与类名门禁
docs/superpowers/        设计与计划留档（plans / specs）
```

## 约定

- [CLAUDE.md](CLAUDE.md) —— 硬性规则：一个功能一个包、依赖只指向 Service Definition、持久化只走 `ctx.storage`。
- [CONVENTIONS.md](CONVENTIONS.md) —— 目录与命名：文件自报家门，页面按「视图 / 样式 / 逻辑」三件套拆。
- 任何 `*.log`（调试 / 安装 / 构建 / 测试输出）一律落盘到 `.research/logs/`，不放仓库根目录或 `packages/` 源码目录。

## License

各插件包均为 MIT。
