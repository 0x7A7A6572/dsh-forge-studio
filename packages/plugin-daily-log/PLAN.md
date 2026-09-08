# @zzerx/dsh-plugin-daily-log —— 迁移与实现规划

> 2026-09-08 更新：生成语义已按 docs/superpowers/specs/2026-09-08-daily-log-conversational-generation-design.md
> 重构为「对话式生成」——确定性 mustache 渲染已移除，实施计划见 docs/superpowers/plans/2026-09-08-daily-log-conversational-generation.md。

> 目标：把原项目 `D:\codes\commit-log-daily`（Git 聚合 + 自然语言生成日报/周报/月报的
> Agent CLI TUI）抽取设计，重构为 deepseek harness 插件（Web GUI 形态）。LangChain 部分
> 由 dsh 自带 agent 装配替代；页面从 Ink TUI 重构为 Web 面板；并扩展数据源：除扫 Git 外，
> 还能扫本地 agent 对话（deepseek / claude / codex）做工作总结，受众不再局限于开发者。

---

## 1. 原项目设计抽取（commit-log-daily v2.2.0）

### 1.1 功能面（feature map）

| 功能 | 原实现 | 迁移判定 |
|------|--------|----------|
| 多仓库聚合 | 手动添加 + 目录扫描导入（findGitRepos） | 保留，走 host 服务 |
| 智能归纳 | 两阶段 Agent（collect → generate），业务化描述、合并同功能提交 | 保留，改写为 dsh 系统提示/工具，无需自建状态机 |
| 对话摘要压缩 | langgraph condense / SummaryMemory | **删除**——dsh 自带 compaction（dsh-compaction-basic） |
| 报告导出 | writeFile 写 .md 到输出目录 | 保留，改走 dsh fs 工具 / 或插件自有导出端点 |
| 会话持久化 | sql.js（SQLite WASM） | **删除**——dsh 自带 session 持久化（dsh-session-persistence-jsonl / dsh-session-query-sqlite） |
| 配置系统 | JSON + Zod + 环境变量三层 | 保留语义，改走 ctx.settings 命名空间 |
| 报告模板 | 模板文件（default 内置 + 自定义 .md，mustache 占位符） | 保留，改为 storage 记录 |
| 安全检查 | safeMode + git 子命令白名单 | 保留，白名单逻辑照搬；shell 执行改走 dsh sandbox |

### 1.2 原架构要点

- **两阶段工作流**：collect（数据收集工具）→ generate（生成工具）。原实现靠
  `[PHASE:generate]` 标记 + 三个条件（dateRange/projects/commits 非空）+ 10 轮工具调用循环。
  迁移后**不需要自建阶段状态机**——直接给 agent 一组「数据源扫描工具 + 一个生成工具」，
  由 dsh 的 agent loop 自行编排；系统提示里写明「先收集再生成」的约束即可。
- **数据收集工具**：scanGit（`git log --all --format=`，白名单，execFile 防注入）、
  scanUncommitted、findGitRepos、listProjects/addProject/removeProject、getConfig/setConfig。
- **生成工具**：generateReport（返回组装指令而非调 LLM）、writeFile（落盘 .md）。
- **模板系统**：内置 default + 用户 .md，mustache 风格占位符（`{{reportType}} {{dateRange}} {{author.name}} {{#projects}}...{{/projects}}`）。
- **系统提示**：BASE（数据驱动/诚实/尊重用户/逐步推进 + 中文 CLI 风格）+ collect/generate 阶段提示。

---

## 2. 迁移映射：LangChain → dsh 自带 agent

| 原 LangChain 件 | dsh 等价物 | 说明 |
|-----------------|-----------|------|
| @langchain/core tools（tool() + zod schema） | `defineTool`（@deepseek-ai/dsh-tools）+ JSON schema | 参照 plugin-notes 的 notes_* 工具 |
| LangGraph 两阶段状态机 | 无需——agent loop + 系统提示约束 | 删掉 graph.ts / base.ts / condense.ts |
| checkpoint-sqlite / session db | dsh-session（持久化/查询/标题均自带） | 删除 session/ 目录 |
| safety-llm / exec 工具 | dsh bash/pwsh sandbox + 工具 guard | 白名单逻辑保留为 guard |
| OpenAI 兼容模型配置 | dsh LLM 路由（模型选择走宿主） | 无需插件自配 API key |
| TUI（Ink + React 19） | Web GUI（React 18，参照 plugin-notes 的 DOM 注入） | 页面重构是主要工作量 |

---

## 3. 目标插件架构

### 3.1 命名与目录（第一步：纠错）

- 现目录 `packages/plgin-daily-log/`、文件 `READEME.md` 均为笔误，按 CLAUDE.md 规范改为：
  - 目录：`packages/plugin-daily-log/`
  - 文件名：`README.md`
  - 包名：`@zzerx/dsh-plugin-daily-log`（package.json `name`）
- 本规划文件即落于此目录，实施时先做 rename，再按下方结构铺骨架。

### 3.2 包结构（对齐 plugin-notes 范式）

```
packages/plugin-daily-log/
├── package.json            # exports . / ./client / ./package.json；dsh.bundle.patch + dsh.client
├── cordis.patch.yml        # - insert: [{ id: daily-log, name: '@zzerx/dsh-plugin-daily-log' }]
├── README.md
├── scripts/build.mjs       # 同 plugin-notes（esbuild/tsup → lib/index.js + lib/client.js + lib/types）
├── tsconfig.json / tsconfig.tests.json
├── src/
│   ├── index.ts            # host apply：开域 → 注册 DailyLogService → 设置 → agent 桥
│   ├── domain.ts           # storage-domain：sources/reports/templates
│   ├── service.ts          # DailyLogService extends TypertRemoteService（key 'dailyLog'）
│   ├── settings.ts         # settings 命名空间（输出目录/作者名/邮箱/安全模式等）
│   ├── types.ts            # 共享类型 + 品牌 ID + 枚举
│   ├── sources/            # 数据源 provider 抽象（见 §4）
│   │   ├── provider.ts     # WorkSourceProvider 接口 + 发现/诊断
│   │   ├── git.ts          # Git 提交源（safeGitExecute + 白名单）
│   │   ├── claude.ts       # ~/.claude/projects/**/*.jsonl
│   │   ├── codex.ts        # ~/.codex/sessions/**
│   │   └── dsh.ts          # DSH_HOME session 日志（JSONL）
│   └── agent/
│       ├── tools.ts        # daily_log_* 工具（scan/collect/generate/export/template）
│       └── reference.ts    # 系统提示分区（可选）
└── src/client/
    ├── index.ts            # client apply：挂远程命名空间 + 侧栏入口 + 中间列面板 + 设置卡片
    ├── core/remote.ts      # Typert remote 手写贡献（ctx.remote.dailyLog.*）
    ├── core/sidebar-entry.ts   # 侧栏「工作报告」入口行（照抄 plugin-notes 的 DOM 注入/自愈）
    ├── core/panel-mount.ts     # 中间列接管（照抄 plugin-notes，SIBLING 协调加 daily-log 属性）
    └── views/              # 面板 React 视图
        ├── board.tsx       # 主视图：数据源列表 + 扫描 + 生成 + 报告预览
        ├── sources.tsx     # 数据源管理（Git 仓库 / agent 对话目录）
        ├── reports.tsx     # 历史报告列表 + 查看/导出/删除
        └── templates.tsx   # 报告模板管理
```

### 3.3 host 侧能力

1. **storage domain（domain.ts）**——per-record 布局，版本 1：
   - `sources`：数据源记录（id/type/git|claude|codex|dsh/label/path/author/createdAt/updatedAt）
   - `reports`：生成报告记录（id/title/markdown/sourceIds/dateRange/createdAt）
   - `templates`：报告模板（id/name/content/isBuiltin/isDefault/updatedAt）
2. **DailyLogService（service.ts，`ctx.dailyLog`）**——Typert remote 服务（key `dailyLog`）：
   - 数据源 CRUD：listSources/addSource/removeSource/discoverSources（目录扫描发现）
   - 扫描：scanSource(id, {since,until,author}) → 结构化活动条目（提交/对话轮次）
   - 生成：generateReport(input) → 调用宿主 agent 生成？**否**——见下方设计决策
   - 导出：exportReport(id) → 写 .md 到配置输出目录（或经 ctx.fs）
   - 模板 CRUD：listTemplates/createTemplate/updateTemplate/deleteTemplate/setDefaultTemplate
3. **设置（settings.ts）**：命名空间 `daily-log`，字段：输出目录、作者名、作者邮箱、
   默认时间范围、安全模式开关（对齐原 AppConfig 的 author/report/safety，去掉 model——
   模型路由走宿主，插件不自配 API key）。
4. **agent 工具（agent/tools.ts）**——`daily_log_*` 前缀，`ctx.inject(['tools'], ...)` 条件挂载：
   - `daily_log_list_sources` / `daily_log_scan`（读）
   - `daily_log_generate`：把收集到的结构化活动条目 + 模板交给 LLM 生成报告（生成工具本身
     不调 LLM，只返回组装指令，与原 generateReport 同构）
   - `daily_log_export` / `daily_log_add_source` / `daily_log_template_*`（写，走
     `tools/pre-execute` ask + guard，参照 plugin-notes）
   - guard：agent 不得删除 origin='user' 的模板/报告；不得改安全模式关闭
5. **系统提示分区（agent/reference.ts，可选）**：`ctx.inject(['systemPrompt'], ...)` 注入
   「数据驱动 + 业务化归纳 + 中文输出 + 模板章节」约束（吸收原 BASE/GENERATE 提示精华）。

### 3.4 client 侧（Web GUI）

- **远程通道**：`ctx.remote.dailyLog.*`（手写 Typert contribution，对齐 host 方法名/形参名）。
- **侧栏入口**：`sidebar-entry.ts` 注入「工作报告」行（照抄 plugin-notes 的 DOM 注入 +
  MutationObserver 自愈 + 折叠 rail 样式；图标 lucide `CalendarClock` 或 `NotebookText`）。
- **中间列面板**：`panel-mount.ts` 接管中间列；`<html data-dsh-dailylog-active>` 属性 +
  sibling 驱逐（与 taskboard/notes 共用 `dsh-panel-activate` 广播，SIBLING 列表互认）。
- **视图**：主视图（源列表 + 时间范围选择 + 「扫描并生成」按钮 + 报告 Markdown 预览 +
  导出/复制）、源管理、报告历史、模板管理。
- **不做斜杠命令**：config/projects/history/templates 均为页面操作——本插件是独立 GUI
  面板，此类非常用操作不入侵斜杠菜单（dsh 会话里无需斜杠入口）。
- **设置卡片**：注册到插件设置页（或面板内弹窗，参照 plugin-notes 二选一；建议面板内
  弹窗，与便签一致的体验）。

---

## 4. 核心扩展：多源工作日志（不止 Git）

抽象一个 `WorkSourceProvider` 接口，`type ∈ {git, claude, codex, dsh}`，统一产出
「活动条目」`ActivityEntry { ts, source, title, body, kind } `，供生成阶段汇总：

| 源 | 采集目标 | 真实落点（已探明本机） |
|----|----------|------------------------|
| git | 提交历史 | 各仓库 `git log --all --since --until --author`（白名单 + execFile，沿用原 safeGitExecute） |
| claude | Claude Code 会话 | `~/.claude/projects/<project-slug>/*.jsonl`（含 tool-results 子目录，按 mtime 过滤时间窗） |
| codex | Codex 会话 | `~/.codex/sessions/**`（rollout/transcript JSONL；实施时精确定位） |
| dsh | deepseek harness 会话 | `DSH_HOME` 会话日志（dsh-session-log-deepseek / dsh-session-persistence-jsonl 的 JSONL） |

关键设计：
- **provider 可插拔**：新增来源只需实现 `discover()` + `scan(range)`，不改 service 主体。
- **发现诊断**：`discoverSources` 返回「找到/未找到 + 候选路径 + 可读性诊断」（借鉴
  dsh-skill-hub 的 discovery diagnostics 体验）。
- **隐私与边界**：agent 对话源只读（read-only），解析失败单源降级、不拖垮整次扫描。
- **受众扩展**：非开发者可用 claude/codex/dsh 源生成「工作/学习总结」，git 源供开发者。

---

## 5. 实施任务分解（借鉴原项目 3-task SDD 节奏）

- **Task 0（纠错 + 骨架）**：rename 目录/文件；铺 package.json / cordis.patch.yml /
  tsconfig / build.mjs / 空 host+client apply；typecheck 通过。
- **Task 1（host 域 + 服务 + 设置）**：domain.ts 三表 + DailyLogService CRUD + settings
  命名空间 + Typert remote 端点；vitest 覆盖 CRUD 与 schema 默认值。
- **Task 2（数据源 provider + agent 工具）**：git provider（先做，迁移成本最低）+ 其余
  三源 provider（骨架 + 发现）+ daily_log_* 工具 + guard/ask；测试 git 白名单与解析。
- **Task 3（client UI）**：远程通道 + 侧栏入口 + 中间列面板 + 四个视图 + 设置弹窗；
  对齐 plugin-notes 的 DOM 注入/自愈/多面板互斥。
- **Task 4（生成管线 + 导出 + 模板）**：generate → 导出 .md → 模板 CRUD；端到端验收
  「扫 git 生成周报」「扫 claude 对话生成总结」。

---

## 6. 迁移注意事项与风险

1. **命名纠错先行**：`plgin-daily-log` / `READEME.md` 是笔误，rename 后再铺骨架，
   否则路径/包名不一致会带来连锁问题。
2. **不要自建状态机/会话/摘要**：collect→generate 状态机、SQLite 会话、condense 摘要
   全部由 dsh 自带能力替代，自建会与宿主重复且更难维护。
3. **模型配置下沉**：原「配置 API key」改为走宿主 LLM 路由，插件设置里不出现 API key。
4. **git 执行安全**：沿用原 `safeGitExecute` 白名单（`ALLOWED_GIT_COMMANDS`）与
   `execFile` 数组传参；在 dsh 里优先走 sandbox 约束，白名单作为第二道 guard。
5. **client 挂载用 DOM 注入**：中间列/侧栏是单占位无外部 slot，照抄 plugin-notes 的
   DOM 注入 + MutationObserver 自愈 + 多面板 `dsh-panel-activate` 互斥，勿自造路由。
6. **agent 桥条件挂载**：`tools`/系统提示用 `ctx.inject` 判存（勿用 apply 时一次性
   `ctx.get`），纯 UI 宿主降级为数据后端，不拖垮核心服务（plugin-notes 头注释的教训）。
7. **对话源路径随版本漂移**：claude/codex/dsh 的会话落点可能随版本变化，provider 的
   discover 须做「候选路径多路探测 + 诊断」，不能写死单一路径。
8. **不做偏好学习/记忆**：原「用户偏好学习」本次移除——记忆系统后续单独做；本插件不落
   偏好数据，聚焦「自动收集 → 按模板生成 → 导出」主链路。

---

## 7. 依赖清单（peerDependencies 对齐 plugin-notes）

`@deepseek-ai/cordis@4.0.2`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-brand`、
`@deepseek-ai/dsh-settings`、`@deepseek-ai/dsh-storage-domain`、`@deepseek-ai/dsh-system-prompt`、
`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-typert-protocol`、`@deepseek-ai/dsh-user-approval`、
`@deepseek-ai/schemastery`；client 侧 `react@18` / `react-dom@18` / `lucide-react`；
dev 侧照搬 plugin-notes（esbuild/tsup/typescript/vitest/zod）。

---

## 8. 验收标准（Definition of Done）

核心：**能通过自动收集提交记录/对话，再根据自定义模板生成指定格式的报告；模板在页面上可自定义。**

- **自动收集**：添加 Git 仓库或 agent 对话目录后，一次「扫描」即可自动聚合提交记录
  （git）与本地对话（claude/codex/dsh）为结构化活动条目，无需人工整理。
- **按模板生成**：选定数据源与时间范围后，按所选模板生成报告；模板定义章节结构与
  风格，生成结果严格符合模板格式。
- **模板页面自定义**：页面内可创建/编辑/删除模板、设置默认模板；模板为 Markdown 骨架 +
  占位符，保存后立即用于下一次生成。
- **导出**：生成结果可导出为 .md 到配置的输出目录。
- **工程门槛**：`typecheck` / `test` 全绿；`build` 产出 `lib/index.js + lib/client.js + lib/types`；
  进 web profile 后侧栏出现「工作报告」入口、点开接管中间列。
