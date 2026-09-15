# @zzerx/dsh-plugin-daily-log

> 侧边栏图标：设置面板侧边栏默认给所有分区一个通用齿轮（外壳的图标是硬编码 id 映射，槽位没有图标入口），本插件用一层作用域 DOM 补丁把「工作报告」换成自己的图标，做法同 `dsh-skill-hub`；补丁失败只退回齿轮，不影响功能。

每日工作日志：聚合 **Git 提交** 与 **本地 agent 对话**（deepseek / claude / codex），按**自定义模板**生成日报 / 周报 / 月报。不再只面向开发者 —— 非开发者也能用本地对话记录做工作总结。

## 功能

- **多源采集**：Git 仓库（`git log` 白名单 + execFile 防注入）、Claude Code（`~/.claude/projects/**/*.jsonl`）、Codex（`~/.codex/sessions/**`）、DeepSeek harness（`DSH_HOME` 会话日志）。
- **对话式生成**：在聊天里说「帮我生成本周周报」，agent 先确认时间范围与项目、扫描 Git 提交与本地 agent 对话，再亲自按模板结构把活动归纳成业务化报告（合并同功能提交、归类到核心产出/问题修复/技术优化等章节）；经你确认后保存到报告历史并可导出 .md。
- **报告历史 + 导出**：历史报告可查看 / 删除，一键导出 .md 到本地目录。
- **默认仅本人提交**：Git 渠道默认按提交身份过滤 —— 设置 `authorEmail` 优先，未配置时回落各仓库生效的 `git config user.email`，因此默认只产出本人提交；项目级 `author` 可覆盖，填 `*` / `all` 放开全作者。对话渠道没有作者维度，不受影响。
- **agent 工具**：会话里自然语言「帮我生成本周周报」，经 `daily_log_*` 工具完成（`daily_log_list_sources` / `daily_log_scan` / `daily_log_prepare_report` / `daily_log_save_report` / `daily_log_export_report` 等）。
- **上下文可控的取数**：会话渠道按条产出（单人一周可达数百条），因此扫描默认只给**分组级索引** —— `level=index` 的渲染行数只与「会话 / 分支」数量有关，与消息条数无关；需要细节时 `level=summary` 取每组「首问 + 末答」，`level=raw` 才是逐条明细（可配 `session_id` / `keywords` 下钻）。被折叠的分组会**显式列出名称与条数**，不会静默丢弃。
- **注入内容剥离**：宿主往会话里塞的包裹块（IDE 打开的/选中的文件、环境与权限说明、AGENTS.md 提示、技能基目录、命令回显、任务通知、`[Request interrupted]`）在解析阶段剥离或丢弃；它们常与真实提问同处一条消息，因此先剥壳、剥完为空才丢整条。只按白名单标签匹配 —— 正文里出现 `<name>` / `<div>` 这类正常尖括号内容不会被误伤。

## 工具按需注入（默认不注册）

本插件的 agent 工具**默认不进入模型上下文**：新会话只挂 1 个常驻派发器工具 `daily_log`，systemPrompt 里也只有一句短指针；15 个 `daily_log_*` 工具在**按需启用**时才注入本会话（这个机制叫「按需注入」）。

详细工作流引导段（811 字符）**不走 systemPrompt**：agent 作用域只有 `tools`、没有 prompt 段通道，注册进去会被静默丢弃（真机实测）。因此引导改走**对话本身** —— 它随 `daily_log` 的启用结果，或随 `/report` 的续接消息（用户原话在前、引导在后，不重述需求）一起进入本会话，模型读到的仍是全文。

两种启用方式，任选其一：

1. **敲 `/report` 指令**：例如 `/report 生成这周的周报`。指令会把需求续成一条用户消息交给模型，模型随即拿到 15 个工具并开始干活，**不用你再重述一遍需求**（万一自动续接失败，会明确提示你把需求再说一次）。注意 **`/report` 要带需求**：裸敲 `/report`（不带参数）不会产生模型轮次，那一轮自然也没有可投递引导的对话通道 —— 引导会在你之后正常提需求、模型经 `daily_log` 启用时随结果一并给出。
2. **让模型自己启用**：直接说「帮我生成这周的周报」，模型先调用 `daily_log` 派发器把整组工具启用起来，紧接着就能调用 `daily_log_scan` 等工具。启用后在该会话内保持可见 —— 不会用完自动回收，也不跨会话泄漏。

**开关的位置与作用范围**：设置 → 工作报告 →「注册 /report 指令」（设置项 `forge-studio-daily-log.enableReportCommand`，默认开）。它**只管 `/report` 指令是否注册**，不是本插件的总开关：关掉后模型仍可在需要时经 `daily_log` 自行启用整组工具。

**默认态省下多少**（按本包当前文案实测的字符数换算，token 为估算区间）：

| 项 | 默认态（每轮） | 按需启用后（每轮） |
|---|---|---|
| 15 个 `daily_log_*` 工具完整 schema | 不发送 | 约 1.7–2.4k token |
| 详细引导段（811 字符，随启用结果 / 续接消息进对话） | 不发送 | 约 0.4–0.5k token |
| `daily_log` 派发器定义（513 字符） | 约 0.13k token | 约 0.13k token |
| 常驻短指针（173 字符） | 约 0.12k token | 约 0.12k token |
| **合计** | **约 0.25k token** | **约 2.4–3.1k token** |

即默认态每轮少付约 2.2–2.9k token（≈ 90%）：从「15 个工具的完整 schema + 详细引导段」压到「1 个派发器 + 1 句短指针」。

## 作者过滤（默认仅本人提交）

Git 提交的作者过滤按以下优先级取值，三级皆空时不过滤：

1. 项目级 `author`（`daily_log_add_source` 的 `author` 参数）；
2. 设置 `forge-studio-daily-log.authorEmail`（设置页可填）；
3. 各仓库生效的 `git config user.email`（仓库 local 优先，回落全局身份）。

填 `*` 或 `all` 可显式放开全作者（想收录团队提交时使用）。

## 架构

- host：`src/index.ts` 打开 `daily_log` 域（storage-domain 三表 sources/reports/templates）→ 提供 `ctx.dailyLog` 服务（Typert remote 直连）→ 注册设置命名空间 → 装配数据源 provider + agent 工具桥。
- 数据源：`src/sources/{git,claude,codex,dsh}.ts`（`claude`/`codex` 共用 `conversation-jsonl.ts` 解析器；`dsh.ts` 自带多帧 zstd 解码与注入源过滤）；扫描结果经 `src/agent/scan-render.ts` 分层渲染（index / summary / raw）后交给 agent。
- client：`src/client/index.ts` 挂 `ctx.remote.dailyLog.*` 远程通道 → 在 **dsh 设置面板**注册一级分区「工作报告」（`settings.section`，声明感知注入，与加载顺序无关）。

## 界面（设置里的一级分区）

入口统一收在 **设置 → 工作报告**（不再占用侧栏与会话区）。分区内：

- 顶部「注册 /report 指令」开关：只管指令是否注册，关掉后模型仍可经 `daily_log` 自行启用（见上一节）；开关读写的是本插件设置命名空间，与 host 侧同源，改完即时生效；
- 其下「对话式生成」模块：说明怎么用左侧对话生成，显示当前默认模板与数据源数量，按钮「去对话生成」直接关掉设置回到会话；
- 页签 **报告 / 数据源 / 模板**（带计数）；
- 三页统一走 dsh 的卡片语言（0.5px 描边卡片 + 卡片栅格 + 分组小标题 + 虚线新增位），样式`src/client/views/ui-css.ts`只注入一次，选择器挂在分区根标记下；长正文（报告正文 / 模板预览）在卡片内滚动，展开的报告横跨整行。

视图文件：`views/section.tsx`（分区外壳）/ `sources-view.tsx`（数据源 + 两个弹窗）/ `reports-view.tsx` / `templates-view.tsx` / `parts.tsx`（共用小件）/ `ui-css.ts`（样式）。弹窗走宿主 `Modal` 原语（body portal），内容包一层同根标记以命中分区样式。

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
