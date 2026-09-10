# dsh-forge-studio

聚合多个独立 dsh 日常插件的 monorepo。每个功能一个 `packages/plugin-<name>`，统一命名 `@zzerx/dsh-plugin-<name>`。

## 插件

| 包 | 说明 | 状态 |
|---|---|---|
| [`@zzerx/dsh-plugin-notes`](packages/plugin-notes) | 便签板：纸卡墙 / 列表 / 任务泳道三视图，Markdown、贴图、AI 联动执行 | ✅ |
| [`@zzerx/dsh-plugin-daily-log`](packages/plugin-daily-log) | 工作日志：聚合 Git 提交 + 本地 agent 对话，模板化生成日报/周报/月报 | ✅ |
| [`@zzerx/dsh-plugin-home-studio`](packages/plugin-home-studio) | 工作台：聚合日常功能入口的骨架包，待填充 | 🚧 |

## 安装

```bash
dsh plugin --profile <你的profile名> add @zzerx/dsh-plugin-notes
dsh plugin --profile <你的profile名> add @zzerx/dsh-plugin-daily-log
dsh plugin --profile <你的profile名> add @zzerx/dsh-plugin-home-studio
```

## 本地开发

```bash
pnpm install   # 装 workspace（含本地 dsh CLI）
pnpm dev       # 启动 dsh web（DSH_HOME=.dsh-home，profile=web）
pnpm test      # 全 workspace vitest
```

## 目录

```
packages/
  plugin-notes/        便签
  plugin-daily-log/    工作日志
  plugin-home-studio/  工作台（骨架）
```
