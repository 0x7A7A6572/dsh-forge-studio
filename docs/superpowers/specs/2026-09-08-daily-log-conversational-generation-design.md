# plugin-daily-log 对话式生成智能体 — 设计 spec

> 日期：2026-09-08
> 包：`@zzerx/dsh-plugin-daily-log`（packages/plugin-daily-log）
> 分类：architectural（重排生成语义 + agent 工具接口 + 模板格式）
> 状态：设计已获用户认可（2026-09-08 对话拍板），待用户审阅本文档后转实施计划。

## 0. 背景与问题

PLAN.md 的愿景是复刻原项目 `D:/codes/commit-log-daily` 的「对话式生成报告智能体」：
聊天界面一句话（「帮我生成本周周报」）→ agent 收集（collect）→ 亲自撰写业务化报告（generate）→
确认后落盘。但当前实现偏航成了一条 **确定性管线**：GUI「扫描并生成」按钮 →
`service.generateReport` 把扫描条目原样套进 mustache 模板渲染成 Markdown。

由此产生的落差：

1. **生成语义名不副实**：reference.ts / README 承诺「把同功能多次提交合并为业务描述」，实际输出是
   原始提交流水（含 merge/chore），没有任何 LLM 归纳；工具 `daily_log_generate` 也只是确定性渲染。
2. **模板语义错位**：模板 = mustache 数据循环（projects/commits/activities 绑定），而原版模板是
   「`<!-- DATA -->` 指令段 + 骨架段」写给 LLM 的结构引导。
3. **无对话礼仪**：没有 collect 阶段「先确认再扫、信息不足反问」的行为约束。
4. **无落库/导出闭环**：LLM 若真要产出报告，没有 agent 侧保存/导出工具。

## 1. 目标与非目标

### 1.1 目标
把「生成报告」恢复为原版语义，载体为 **DSH 聊天会话**：

- 用户在聊天里说「帮我生成本周周报」→ 宿主 agent 使用 `daily_log_*` 工具走 collect→generate。
- **LLM 亲自撰写报告正文**：按模板结构归类（feat/新增→核心产出、fix→修复、refactor/perf→优化、
  隐性工作→其他工作），同功能多次提交合并为一条业务描述，禁止代码流水账。
- 写完先在聊天展示，**用户确认后**经 `save_report` 落 `reports` 表并可选导出 .md。
- 模板系统切到「LLM 引导」语义（`<!-- DATA -->`），移除 mustache 确定性渲染。
- GUI 面板配套调整：恢复「指南」页作为默认落地页——示例句一键「填入聊天」直写当前会话输入框并收起面板（§5.1），其余页对齐。

### 1.2 非目标（本轮不做）
- DSH 会话渠道（dsh channel）接入——保持现状（候选徽标降级见 §5.2），另行一轮。
- 偏好学习/记忆（原 commit-log-daily 的 prefs）——PLAN.md 已判删，沿用。
- 面板内嵌 agent 会话（GUI 面板里再造聊天宿主）。
- 多阶段硬状态机（原 LangGraph phase 路由）——dsh agent 无阶段状态机，
  用「系统提示分区 + 工具条件」做**软性**阶段约束。
- `scanUncommitted` / shell 执行类工具——「隐性工作」改为提示词层面的**口头询问**
  （用户拍板：数据源不止 git，未提交只是 git 一种；claude/codex/dsh 进行中会话同理，统一口头询问口径）。

## 2. 决策记录（用户拍板）

| # | 分叉 | 决策 |
|---|------|------|
| D1 | 载体 | DSH 聊天会话即入口；GUI 按钮不再承担「生成」语义 |
| D2 | 生成语义 | 纯 LLM 引导生成；**移除 mustache 确定性渲染** |
| D3 | GUI「生成」页 | 引导卡→删除→**恢复为「指南」页**：示例带「填入聊天」动作（conversation.input.setDraft 直写当前会话并收起面板），无剪贴板复制（§5.1 二次修订） |
| D4 | 报告落库 | 模型先展示正文 → **用户确认后**再 `save_report` / 导出 |
| D5 | 隐性工作 | 不做 `scanUncommitted` 工具；提示词要求 agent **口头询问** |
| D6 | dsh 渠道 | 本轮不实现；工作区候选的 DSH 徽标降级（§5.2） |

## 3. 生成语义（服务端）

### 3.1 删除
- `service.generateReport`（确定性渲染管线）。
- `render.ts` 的 `buildRenderData` / `renderTemplate` / `formatDateRange`（后者若仍被标题
  拼接使用则保留函数本体，从渲染职责剥离）。
- `template-default.ts` 旧 mustache 内容；模块改为导出新的默认骨架常量。
- mustache 依赖（devDependencies 清理，含 `@types/mustache`）。

### 3.2 新增 / 调整
- **`parseTemplate(content)`**（照搬原版 `template/resolver.ts` 语义）：
  - 含 `<!-- DATA -->` → 其上为指令段 promptSection，其下为骨架段 skeletonSection；
  - 不含 → 整份视为骨架段，promptSection 为 null。
- **`resolveTemplateForGenerate(templateId?)`**：取模板（缺省默认模板逻辑不变：isDefault → isBuiltin 兜底），
  返回 `{ promptSection: string|null, skeletonSection: string, name }`。内置 default 不特判返回 null
  （**偏离原版说明**：原版对 default 不注入、结构全靠 GENERATE prompt；本插件模板页始终展示 default 记录，
  统一注入其骨架作基线章节，避免页面所见与生成所依不一致。映射规则常驻提示分区 §4，default 骨架只是排版参考）。
- **`prepareReport(input)`**（取代 generate）：返回
  `{ templateName, promptSection?, skeletonSection, range, reportType, sourceCount }`
  即给 LLM 的结构引导 + 选定源计数；**不重新扫描**（agent 的 scan 结果已在对话上下文，这里只解析模板、
  不重复取数）。入参含 reportType/dateRange/sourceIds?/templateId?。
- **`saveReport(input)`**（取代公开 createReport 语义）：入参 = LLM 产出的
  `{ title, markdown, dateRange, sourceIds, templateId?, reportType? }` → 写 `reports` 表。
  `createReport` 降为内部私有/仅内部调用（保留但不出 remote 描述符对外暴露）。
- **`exportReport`** 保持（GUI 已用；agent 侧新增对应工具见 §4.2）。
- 报告记录新增可选字段 **`reportType?`**（storage zod 加 optional；旧记录兼容，无迁移）。
- **内置 default 模板旧内容一次性迁移**：service 构造种子逻辑检测「已存在的 builtin 记录 content 含
  `{{`」→ 以新默认骨架覆盖 content + updatedAt（幂等；旧会话目录源迁移逻辑不变）。
- **remote 描述符同步**：client/core/remote.ts 的 descriptors/类型映射删除 generateReport 与 createReport
  （GUI 不再调用；agent 工具不经 remote、host 内直调 ctx.dailyLog），保留 listSources/scanSource/exportReport 等。

## 4. agent 工具与系统提示（agent/tools.ts、agent/reference.ts）

### 4.1 系统提示分区重构（reference.ts）
按原版 BASE / COLLECT / GENERATE 三段精华改写（去掉 TUI 风格条款），仍一个 section（`forge-daily-log:reporting`，
order 2950）但内容分三节：

1. **总则**：数据驱动——所有结论必须来自 `daily_log_*` 工具返回数据，绝不编造；诚实透明——空数据/异常如实告知；
   中文交流；写报告用业务语言。
2. **收集礼仪**（软性）：动手扫描前确认时间范围与项目集；条目过少、提交信息过简（update/fix/wip 类）、
   疑似漏项目 → 反问，不自行猜测；扫描完成后口头询问「是否有未提交/未完成/未体现在扫描结果里的工作
   （协助、会议、进行中会话等）」。
3. **生成礼仪**：调用 `daily_log_prepare_report` 获取模板引导 → **你亲自撰写正文**，按骨架归类、
   同功能多次提交合并为一条业务描述（给出好/坏示例）、不得把原始条目清单当正文；写完先展示给用户，
   **未经用户确认不得调用 `daily_log_save_report` / `daily_log_export_report`**；用户要求调整则改正文再问。

### 4.2 工具面
- 保留：`list_sources / scan / list_templates / get_template / list_reports / get_report /
  add_source / delete_report / template_create / template_update / template_delete / set_default_template`。
  （`scan` 的渲染维持 title 行列表上限 200——模型不需要全量 body。）
- **重写 `generate` → `prepare_report`**：描述明确「进入生成阶段：返回所选模板的指令/骨架引导与数据统计；
  随后你必须亲自按引导撰写报告正文」。形参保持 reportType/since/until/source_ids?/template_id?。
- **新增 `save_report`**（写，pre-execute ask）：`{ markdown, since, until?, title?, reportType?, source_ids, template_id? }`
  → 落 reports 表，返回记录 id。
- **新增 `export_report`**（写，ask）：`{ report_id, output_dir? }` → 写 .md 到目录（缺省 settings.outputDir → ~/daily-log-reports）。
- guard 不变（内置模板只读等）。`prepare_report` 只读模板与统计、无副作用 → **归读工具放行**；
  `save_report / export_report / delete_report / add_source / template_*` 走 pre-execute ask。

## 5. GUI 面板（client/views/board.tsx）

### 5.1 「指南」页（对话式生成入口，纯引导）
- 「生成」页（表单 + 扫描并生成按钮）已删；试行「填入聊天」动作按钮时因宿主 sessions 未注入而不可用，
  且用户不想要复制/自动输入类按钮——最终定位为**纯引导页**，无任何操作按钮，作为面板默认落地页
  （board tab；nav 首项「指南」）。
- 内容：页首品牌花体字 **𝖉𝖆𝖎𝖑𝖞 𝖑𝖔𝖌**（面板标题保持「工作报告」）+ 用法说明（含示例句文案，
  不提供点击动作）+ 状态卡（默认模板名 + 数据源标签）。
- 「报告」页空态文案同样承担引导（「尚无报告。在左侧聊天里让 AI 生成…」）。

### 5.2 数据源页 DSH 徽标降级（顺手，属 UI 诚实性）
- 候选行 DSH 徽标当前被强制置亮（service.listWorkspaceCandidates 里 `channels.dsh = true`），但 dsh 渠道未实现——
  徽标标题文案注明「DSH 会话源尚未接入」并以暗色呈现，避免误导；等 dsh channel 实现后再恢复。

### 5.3 报告页
- 保持列表/查看/导出/删除；展示 LLM 产出报告（含 templateId/dateRange 元信息展示 reportType 若有）。

### 5.4 模板页 / 编辑弹窗
- 模板内容改为两段式编辑：指令段（可选，位于 <!-- DATA --> 之上）+ 骨架段；
  弹窗内提供两栏 textarea 与示例，保存时以 <!-- DATA --> 拼接为一个 content 字段。
- **写/预览**：dsh 平台无现成 Markdown 编辑器组件（ui-primitives 仅提供只读渲染 MarkdownText，
  会话渲染体系外的插件没有 labels 管道），故自建轻量双模式：编辑态为两段 monospace textarea；
  「预览渲染」切换把拼接文档交给 MarkdownText（自备引用稳定 labels）渲染整页效果。
- 列表/内置只读/设默认逻辑不变。

## 6. 工程与验收

### 6.1 测试 / 类型
- 修 typecheck 红：tests/service.test.ts legacyRecord 整对象 `as SourceRecord & { kind: string }`（现行
  `kind: kind as never` 压不住 excess property check）。
- render.test.ts → 改为 parseTemplate / 默认骨架（不含 `{{`）测试。
- service.test.ts 的 generateReport 用例 → prepareReport/saveReport/内置迁移幂等用例。
- integration.test.ts 若依赖 generate 确定性渲染 → 同步更新。
- reference 三段分区存在性（常量导出后断言关键短语）。

### 6.2 手工验收（端到端，web profile）
1. 聊天输入「帮我生成本周周报」→ agent 先确认时间范围与项目（或直接按上下文合理默认并说明）。
2. agent 调用 `daily_log_scan` 收集；结果为空/过少时反问。
3. agent 调用 `daily_log_prepare_report` 拿到模板引导 → **亲自撰写**结构化正文：
   合并同功能提交、业务语言、无原始流水账。
4. agent 询问是否保存 → 用户同意 → `daily_log_save_report` → 记录出现在面板「报告」页 → `daily_log_export_report` 产出 .md。
5. GUI：无生成/指南页（入口在聊天，报告页空态承担引导）；模板编辑为两段式；DSH 徽标不误导；typecheck + vitest 全绿；源码无 mustache 引用。

## 7. 风险与注意

- **提示词长度与听话度**：软性阶段约束依赖模型遵循，措辞要具体（给好/坏示例），避免长文稀释。
- **报告质量方差**：LLM 归纳质量随模型波动；验收时需实测一版真实周报，必要时在生成礼仪里补「数量/日期核验」。
- **内置模板一次性迁移**：检测条件（含 `{{`）要只命中旧 mustache 模板；用户手工改过 default 则回退新骨架属预期。
- **reports 旧记录**：无 reportType/templateId 的记录 UI 需容忍 undefined。
- **工具改名影响**：`daily_log_generate` 更名/改义后，本 spec 之外任何文档/提示若引用旧名需同步。

## 8. 后续

- 本文档经用户审阅后：git commit spec → 调 writing-plans 产出实施计划
  （docs/superpowers/plans/2026-09-08-daily-log-conversational-generation.md）→ 实施另起会话/按计划执行。
