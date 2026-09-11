# @zzerx/dsh-plugin-daily-log

每日工作日志：聚合 **Git 提交** 与 **本地 agent 对话**（deepseek / claude / codex），按**自定义模板**生成日报 / 周报 / 月报。不再只面向开发者 —— 非开发者也能用本地对话记录做工作总结。

## 功能

- **多源采集**：Git 仓库（`git log` 白名单 + execFile 防注入）、Claude Code（`~/.claude/projects/**/*.jsonl`）、Codex（`~/.codex/sessions/**`）、DeepSeek harness（`DSH_HOME` 会话日志）。
- **对话式生成**：在聊天里说「帮我生成本周周报」，agent 先确认时间范围与项目、扫描 Git 提交与本地 agent 对话，再亲自按模板结构把活动归纳成业务化报告（合并同功能提交、归类到核心产出/问题修复/技术优化等章节）；经你确认后保存到报告历史并可导出 .md。
- **报告历史 + 导出**：历史报告可查看 / 删除，一键导出 .md 到本地目录。
- **默认仅本人提交**：Git 渠道默认按提交身份过滤 —— 设置 `authorEmail` 优先，未配置时回落各仓库生效的 `git config user.email`，因此默认只产出本人提交；项目级 `author` 可覆盖，填 `*` / `all` 放开全作者。对话渠道没有作者维度，不受影响。
- **agent 工具**：会话里自然语言「帮我生成本周周报」，经 `daily_log_*` 工具完成（`daily_log_list_sources` / `daily_log_scan` / `daily_log_prepare_report` / `daily_log_save_report` / `daily_log_export_report` 等）。
- **上下文可控的取数**：会话渠道按条产出（单人一周可达数百条），因此扫描默认只给**分组级索引** —— `level=index` 的渲染行数只与「会话 / 分支」数量有关，与消息条数无关；需要细节时 `level=summary` 取每组「首问 + 末答」，`level=raw` 才是逐条明细（可配 `session_id` / `keywords` 下钻）。被折叠的分组会**显式列出名称与条数**，不会静默丢弃。
- **注入内容剥离**：宿主往会话里塞的包裹块（IDE 打开的/选中的文件、环境与权限说明、AGENTS.md 提示、技能基目录、命令回显、任务通知、`[Request interrupted]`）在解析阶段剥离或丢弃；它们常与真实提问同处一条消息，因此先剥壳、剥完为空才丢整条。只按白名单标签匹配 —— 正文里出现 `<name>` / `<div>` 这类正常尖括号内容不会被误伤。

## 作者过滤（默认仅本人提交）

Git 提交的作者过滤按以下优先级取值，三级皆空时不过滤：

1. 项目级 `author`（`daily_log_add_source` 的 `author` 参数）；
2. 设置 `forge-studio-daily-log.authorEmail`（设置页可填）；
3. 各仓库生效的 `git config user.email`（仓库 local 优先，回落全局身份）。

填 `*` 或 `all` 可显式放开全作者（想收录团队提交时使用）。

## 架构

- host：`src/index.ts` 打开 `daily_log` 域（storage-domain 三表 sources/reports/templates）→ 提供 `ctx.dailyLog` 服务（Typert remote 直连）→ 注册设置命名空间 → 装配数据源 provider + agent 工具桥。
- 数据源：`src/sources/{git,claude,codex,dsh}.ts`（`claude`/`codex` 共用 `conversation-jsonl.ts` 解析器；`dsh.ts` 自带多帧 zstd 解码与注入源过滤）；扫描结果经 `src/agent/scan-render.ts` 分层渲染（index / summary / raw）后交给 agent。
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
