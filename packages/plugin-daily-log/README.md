# @zzerx/dsh-plugin-daily-log

每日工作日志：聚合 **Git 提交** 与 **本地 agent 对话**（deepseek / claude / codex），按**自定义模板**生成日报 / 周报 / 月报。不再只面向开发者 —— 非开发者也能用本地对话记录做工作总结。

## 功能

- **多源采集**：Git 仓库（`git log` 白名单 + execFile 防注入）、Claude Code（`~/.claude/projects/**/*.jsonl`）、Codex（`~/.codex/sessions/**`）、DeepSeek harness（`DSH_HOME` 会话日志）。
- **对话式生成**：在聊天里说「帮我生成本周周报」，agent 先确认时间范围与项目、扫描 Git 提交与本地 agent 对话，再亲自按模板结构把活动归纳成业务化报告（合并同功能提交、归类到核心产出/问题修复/技术优化等章节）；经你确认后保存到报告历史并可导出 .md。
- **报告历史 + 导出**：历史报告可查看 / 删除，一键导出 .md 到本地目录。
- **agent 工具**：会话里自然语言「帮我生成本周周报」，经 `daily_log_*` 工具完成（`daily_log_list_sources` / `daily_log_scan` / `daily_log_prepare_report` / `daily_log_save_report` / `daily_log_export_report` 等）。

## 架构

- host：`src/index.ts` 打开 `daily_log` 域（storage-domain 三表 sources/reports/templates）→ 提供 `ctx.dailyLog` 服务（Typert remote 直连）→ 注册设置命名空间 → 装配数据源 provider + agent 工具桥。
- client：`src/client/index.ts` 挂 `ctx.remote.dailyLog.*` 远程通道 → 侧栏入口行（DOM 注入 + MutationObserver 自愈）→ 中间列面板接管（`dsh-panel-activate` 广播 + 多面板互斥）。

## 启用进 web profile

把 `@zzerx/dsh-plugin-daily-log` 加进 `.dsh-home/profiles/web/package.json` 的 `dsh.profile.bundles` 列表后执行：

```bash
pnpm --filter @zzerx/dsh-plugin-daily-log build
pnpm install   # 更新 profile 锁文件
pnpm dev
```

## 开发

```bash
pnpm --filter @zzerx/dsh-plugin-daily-log typecheck   # tsc --noEmit（host + tests）
pnpm --filter @zzerx/dsh-plugin-daily-log test        # vitest（domain/service/template/reference + git 集成）
pnpm --filter @zzerx/dsh-plugin-daily-log build       # lib/index.js + lib/client.js + lib/types
```

## 模板（LLM 引导）

模板是「指令段（可选） + <!-- DATA --> + 骨架段」的 Markdown：两者都会作为结构引导注入生成阶段的提示，AI 按骨架章节撰写正文（不是占位符替换）。内置 default 提供五节骨架（核心产出 / 问题修复 / 技术优化 / 其他工作 / 下一步计划）；模板页可创建/编辑两段式自定义模板。
