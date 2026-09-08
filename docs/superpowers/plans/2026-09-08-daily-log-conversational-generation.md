# plugin-daily-log 对话式生成智能体 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 plugin-daily-log 的「扫描并生成」从确定性 mustache 渲染改回 commit-log-daily 原版的对话式生成——用户在该 GUI 聊天里一句话触发，agent 走 collect→generate 礼仪、由 LLM 亲自撰写业务化报告，经确认后经 save_report/export_report 落库并导出。

**Architecture:** 载体 = DSH 聊天会话（宿主 agent 直调 ctx.dailyLog，不经 Typert remote）；删除服务端确定性生成与 mustache 渲染，新增 parseTemplate（<!-- DATA --> 指令段/骨架段）与 prepareReport（只解析模板、不重扫）/ saveReport（LLM 正文落 reports 表）；agent 工具 generate 改为 prepare_report 并新增 save_report/export_report；系统提示分区改写为 总则/收集礼仪/生成礼仪 三段软性约束；GUI 生成页改引导卡、模板编辑改两段式、remote 裁剪 generate/create。

**Tech Stack:** dsh 插件范式（cordis / storage-domain / typert-protocol / dsh-tools / systemPrompt section）；TypeScript 5.7（erasable-syntax 风格见包内现状）；vitest；react 18 面板（内联样式 + --dsw-* 令牌）。

**Spec:** docs/superpowers/specs/2026-09-08-daily-log-conversational-generation-design.md（本文档所有任务从该 spec 论证；执行者须同时读 spec 与本文档）

## Global Constraints

- 数据持久化只走 storage-domain 三表 sources/reports/templates，不自造。
- 内置默认模板名保持 BUILTIN_TEMPLATE = 'default'，只读不可删改。
- 报告正文与模板一律不得含 mustache 占位符（验收含全局 grep '{{' 于 src/ 无命中，模板默认骨架除外——见 T2 用例断言）。
- 源码注释用中文（与包现状一致）；agent 工具 name/description 用英文（与 tools.ts 现状一致）。
- 每任务结束跑 typecheck + vitest（命令：pnpm --filter @zzerx/dsh-plugin-daily-log typecheck 与 ... test，workdir 为仓库根 D:/codes/dsh-desk-studio），绿后提交。
- 任何 *.log 落 .research/logs/，禁止放仓库根或 packages/。
- peerDependencies 不动；T6 才允许改 devDependencies（去 mustache）。
- 包未纳入 git 历史（untracked）——每任务提交用 git add 具体文件路径，不 add 无关文件（勿把 plugin-notes/panel-mount.ts 与根 pnpm-lock.yaml 的既有改动卷进来）。

---

## 文件结构（拆解定案）

- src/template.ts（新建）：DATA_MARKER、TemplateParts、parseTemplate、joinTemplate、formatDateRange、DEFAULT_TEMPLATE_SKELETON —— 模板 LLM 引导语义的唯一家。纯函数，host/client 双侧可 import。
- src/render.ts（T4 删除）：旧 mustache 渲染 buildRenderData/renderTemplate；T2 起仅存续供旧 generateReport（T4 前），formatDateRange 迁至 template.ts。
- src/template-default.ts（T4 删除）：旧 DEFAULT_TEMPLATE_CONTENT 仅 T2-T4 过渡期被 integration.test 引用。
- src/types.ts：ReportRecord + reportType?；新增 ReportPrepareInput / ReportSaveInput / ReportPrepareResult；ReportGenerateInput 在 T4 删。
- src/domain.ts：reportRecordSchema + reportType 可选。
- src/service.ts：内置模板种子改 DEFAULT_TEMPLATE_SKELETON + 旧 mustache 一次性覆盖；新增 resolveTemplate/prepareReport/saveReport；T4 删 generateReport、remote 列表删 generateReport/createReport；T5 候选 dsh 徽标诚实化。
- src/agent/tools.ts：T4 删 generate 工具，新增 prepare_report/save_report/export_report，WRITE_TOOLS/describeAction 同步。
- src/agent/reference.ts：T4 导出台文本常量 DAILY_LOG_REFERENCE_TEXT（三段）并 install 使用。
- src/client/core/remote.ts：T3 删 generateReport/createReport 的 descriptor/类型映射/窄接口成员。
- src/client/views/board.tsx：T3 GenerateTab → 引导卡 GuidanceTab；模板编辑弹窗两段式；报告行 reportType 徽标。
- tests/template.test.ts（T2 新建）、tests/reference.test.ts（T4 新建）；tests/render.test.ts（T4 删）；tests/integration.test.ts、tests/service.test.ts、tests/domain.test.ts 按任务更新。

---

### Task 1: 修复 tests 工程 typecheck 红（legacyRecord 残留 kind）

**Files:**
- Modify: packages/plugin-daily-log/tests/service.test.ts:75-86

**Interfaces:**
- Consumes: 无（纯测试基建修复）。
- Produces: 无。

问题：legacyRecord 返回类型标注 SourceRecord，对象字面量里 kind: kind as never 压不住 TS2353 excess property check，tsc -p tsconfig.tests.json 报 tests/service.test.ts(79,5)。

- [ ] **Step 1: 改写 legacyRecord（类型收窄为交叉类型，整对象断言）**

    把 75-86 行整函数替换为：

    function legacyRecord(id: string, kind: string, path: string, type = 'other'): SourceRecord & { kind: string } {
      const now = Date.now()
      return {
        id: id as SourceId,
        kind,
        type: type as 'code' | 'other',
        label: id,
        path,
        createdAt: now,
        updatedAt: now,
      }
    }

    说明：fakeTable put 的形参是 SourceRecord，交叉类型变量可赋值（extra property 检查只针对对象字面量）；service 迁移探测用 (s as { kind?: unknown }).kind 运行时读取，类型不变。

- [ ] **Step 2: 跑 typecheck 确认绿**

    Run: pnpm --filter @zzerx/dsh-plugin-daily-log typecheck   （workdir D:/codes/dsh-desk-studio）
    Expected: 两段 tsc 均无 error（tsconfig.json 与 tsconfig.tests.json）

- [ ] **Step 3: 跑测试确认 47/47 不回归**

    Run: pnpm --filter @zzerx/dsh-plugin-daily-log test
    Expected: Test Files 5 passed, Tests 47 passed

- [ ] **Step 4: Commit**

    git add packages/plugin-daily-log/tests/service.test.ts
    git commit -m "test(daily-log): 修复 legacyRecord 构造的 excess property typecheck 错误"

---

### Task 2: 模板语义模块 + 服务端新能力（parse/prepare/save，只加不删）

**Files:**
- Create: packages/plugin-daily-log/src/template.ts
- Modify: packages/plugin-daily-log/src/types.ts（ReportRecord + reportType?；新增 ReportPrepareInput/ReportSaveInput/ReportPrepareResult/ReportCreateInput + reportType?）
- Modify: packages/plugin-daily-log/src/domain.ts（reportRecordSchema + reportType 可选）
- Modify: packages/plugin-daily-log/src/service.ts（构造种子 → DEFAULT_TEMPLATE_SKELETON + 旧 mustache 覆盖迁移；imports 改指向 template.ts；新增 resolveTemplate/prepareReport/saveReport；createReport 支持 reportType?；REMOTE_METHODS 增 prepareReport/saveReport）
- Test: Create tests/template.test.ts；Modify tests/domain.test.ts、tests/service.test.ts

**Interfaces:**
- Consumes: 现 types 的 DateRange/SourceId/TemplateId/ReportRecord/BUILTIN_TEMPLATE；service 现 createReport/构造种子段。
- Produces（后续任务依赖的精确签名）:
    DATA_MARKER: string  (值 '<!-- DATA -->')
    interface TemplateParts { promptSection: string | null; skeletonSection: string }
    function parseTemplate(content: string): TemplateParts
    function joinTemplate(promptSection: string | null, skeletonSection: string): string
    function formatDateRange(range: DateRange): string
    const DEFAULT_TEMPLATE_SKELETON: string
    interface ReportPrepareInput { reportType: string; dateRange: DateRange; sourceIds?: SourceId[]; templateId?: TemplateId }
    interface ReportPrepareResult { reportType: string; dateRange: DateRange; sourceIds: SourceId[]; sourceCount: number; template: { name: string; promptSection?: string; skeletonSection: string } }
    interface ReportSaveInput { title?: string; markdown: string; sourceIds: SourceId[]; dateRange: DateRange; templateId?: TemplateId; reportType?: string }
    async prepareReport(input: ReportPrepareInput): Promise<ReportPrepareResult>
    async saveReport(input: ReportSaveInput): Promise<ReportRecord>

- [ ] **Step 1: 写失败测试（template.test.ts 新建 + domain/service 断言）**

    tests/template.test.ts 全文：

    import { describe, expect, it } from 'vitest'
    import { DATA_MARKER, DEFAULT_TEMPLATE_SKELETON, formatDateRange, joinTemplate, parseTemplate } from '../src/template.ts'

    describe('parseTemplate', () => {
      it('有分隔线：其上指令段、其下骨架段', () => {
        const parts = parseTemplate('用简洁中文\n' + DATA_MARKER + '\n# 骨架')
        expect(parts.promptSection).toBe('用简洁中文')
        expect(parts.skeletonSection).toBe('# 骨架')
      })
      it('无分隔线：整份为骨架，指令段 null', () => {
        const parts = parseTemplate('  # 只有骨架  ')
        expect(parts.promptSection).toBeNull()
        expect(parts.skeletonSection).toBe('# 只有骨架')
      })
      it('只有分隔线无指令 → 指令段 null', () => {
        expect(parseTemplate(DATA_MARKER + '\n# s').promptSection).toBeNull()
      })
    })

    describe('joinTemplate', () => {
      it('空指令 → 纯骨架', () => {
        expect(joinTemplate(null, ' # s ')).toBe('# s')
      })
      it('指令 + 骨架 → 以分隔线拼接且可被 parse 还原', () => {
        const joined = joinTemplate('p', 's')
        expect(parseTemplate(joined)).toEqual({ promptSection: 'p', skeletonSection: 's' })
      })
    })

    describe('DEFAULT_TEMPLATE_SKELETON', () => {
      it('是五节业务骨架且不含 mustache', () => {
        expect(DEFAULT_TEMPLATE_SKELETON).toContain('## 核心产出')
        expect(DEFAULT_TEMPLATE_SKELETON).toContain('## 问题修复')
        expect(DEFAULT_TEMPLATE_SKELETON).toContain('## 技术优化')
        expect(DEFAULT_TEMPLATE_SKELETON).toContain('## 其他工作')
        expect(DEFAULT_TEMPLATE_SKELETON).toContain('## 下一步计划')
        expect(DEFAULT_TEMPLATE_SKELETON).not.toContain('{{')
        expect(parseTemplate(DEFAULT_TEMPLATE_SKELETON).promptSection).toBeNull()
      })
    })

    describe('formatDateRange', () => {
      it('无 until 只返回 since', () => {
        expect(formatDateRange({ since: '2026-06-30' })).toBe('2026-06-30')
      })
      it('有 until 用 ~ 连接', () => {
        expect(formatDateRange({ since: '2026-06-30', until: '2026-07-06' })).toBe('2026-06-30 ~ 2026-07-06')
      })
    })

    tests/domain.test.ts 的 reportRecordSchema describe 追加：

      it('reportType 可选且保留', () => {
        const parsed = reportRecordSchema.parse({ ...base, reportType: '周报' })
        expect(parsed.reportType).toBe('周报')
      })

    tests/service.test.ts 追加一个 describe（含内置迁移与 prepare/save 断言）：

    describe('DailyLogService 内置模板迁移 + prepare/save', () => {
      it('预置旧 mustache 内置模板 → 构造后覆盖为新骨架', () => {
        const { svc, templates } = makeService()
        const id = 't-builtin' as TemplateId
        templates.put(id, {
          id, name: 'default', content: '# {{author.name}} 的{{reportType}}', isBuiltin: true, isDefault: true, updatedAt: 1,
        })
        const fresh = new DailyLogService(new Context(), { domain: (templates as unknown) as never })
        void 0 // 构造同步写内存态
        const t = fresh.listTemplates().find((x) => x.isBuiltin)!
        expect(t.content).not.toContain('{{')
        expect(t.content).toContain('## 核心产出')
      })
      it('prepareReport 返回模板引导且不触发渠道扫描', async () => {
        const boom: ChannelProvider = { kind: 'git', probe: async () => true, scan: async () => { throw new Error('should not scan') } }
        const { svc } = makeService({ channels: [boom] })
        const s = await svc.addSource({ path: '/a', label: 'proj' })
        const r = await svc.prepareReport({ reportType: '周报', dateRange: { since: '2026-07-01' }, sourceIds: [s.id] })
        expect(r.sourceCount).toBe(1)
        expect(r.template.name).toBe('default')
        expect(r.template.skeletonSection).toContain('## 核心产出')
        expect(r.template.promptSection).toBeUndefined()
      })
      it('saveReport 落库 + 缺省标题回退', async () => {
        const { svc, reports } = makeService()
        const s = await svc.addSource({ path: '/a' })
        const rec = await svc.saveReport({ markdown: '# 正文', sourceIds: [s.id], dateRange: { since: '2026-07-01' }, reportType: '周报' })
        expect(reports.get(rec.id)?.markdown).toBe('# 正文')
        expect(rec.title).toBe('周报 · 2026-07-01')
      })
    })

    注：makeService 的 domain 形参是 (templates as unknown) as never——makeService 内部 domain.table 按名分发，直接传表即可。若编译提示 type 不便，可在该用例内联构造 { table: (n: string) => n === 'templates' ? templates : undefined } as never 的等价对象。

- [ ] **Step 2: 跑新测试确认失败（红灯）**

    Run: pnpm --filter @zzerx/dsh-plugin-daily-log test -- --run tests/template.test.ts
    Expected: FAIL —— 找不到 ../src/template.ts 模块

- [ ] **Step 3: 新建 src/template.ts（实现）**

    src/template.ts 全文：

    /**
     * 报告模板：LLM 引导语义（取代旧 mustache 渲染）。
     * 模板 = 可选「指令段」+ DATA_MARKER + 「骨架段」；解析结果喂给生成阶段 LLM。
     * 纯函数模块：host 与 client 双侧都可 import。
     */

    import type { DateRange } from './types.ts'

    /** 指令段 / 骨架段分隔标记。 */
    export const DATA_MARKER = '<!-- DATA -->'

    export interface TemplateParts {
      /** 分隔线上方的指令段；无分隔线时为 null。 */
      promptSection: string | null
      /** 骨架段（无分隔线时 = 全文 trim）。 */
      skeletonSection: string
    }

    /** 解析模板内容：按 DATA_MARKER 拆指令段与骨架段。 */
    export function parseTemplate(content: string): TemplateParts {
      const idx = content.indexOf(DATA_MARKER)
      if (idx === -1) return { promptSection: null, skeletonSection: content.trim() }
      return {
        promptSection: content.slice(0, idx).trim() || null,
        skeletonSection: content.slice(idx + DATA_MARKER.length).trim(),
      }
    }

    /** GUI 两段编辑保存：指令段（可空）与骨架段拼回一个 content。 */
    export function joinTemplate(promptSection: string | null, skeletonSection: string): string {
      const skel = skeletonSection.trim()
      const prompt = promptSection?.trim()
      if (!prompt) return skel
      return prompt + '\n' + DATA_MARKER + '\n' + skel
    }

    /** 日期范围展示串。 */
    export function formatDateRange(range: DateRange): string {
      return range.until ? range.since + ' ~ ' + range.until : range.since
    }

    /** 内置默认模板：五节业务骨架（LLM 按此撰写正文；无 mustache）。 */
    export const DEFAULT_TEMPLATE_SKELETON = '# {类型} — {日期范围}\n' +
      '\n## 核心产出\n' +
      '\n<!-- 归类：feat/新增 类成果与功能交付；同功能多次提交合并为一条业务描述 -->\n' +
      '\n## 问题修复\n' +
      '\n<!-- 归类：fix 类修复，说明问题与影响 -->\n' +
      '\n## 技术优化\n' +
      '\n<!-- 归类：refactor/perf 类改进 -->\n' +
      '\n## 其他工作\n' +
      '\n<!-- 用户补充的隐性工作：协助、会议、未落进提交/会话的活动 -->\n' +
      '\n## 下一步计划\n' +
      '\n<!-- 依据当前进度推断，需用户确认 -->\n'

- [ ] **Step 4: 更新 types.ts / domain.ts / service.ts（实现）**

    types.ts：
    - ReportRecord 增加：readonly reportType?: string（放 templateId? 之后）。
    - ReportCreateInput 增加：readonly reportType?: string。
    - 文件末尾（NO_CHANNELS 之后任意处）新增：

    /** 生成准备入参（只解析模板引导，不扫描）。 */
    export interface ReportPrepareInput {
      readonly reportType: string
      readonly dateRange: DateRange
      readonly sourceIds?: SourceId[]
      readonly templateId?: TemplateId
    }

    /** 生成准备结果。 */
    export interface ReportPrepareResult {
      readonly reportType: string
      readonly dateRange: DateRange
      readonly sourceIds: SourceId[]
      readonly sourceCount: number
      readonly template: { readonly name: string; readonly promptSection?: string; readonly skeletonSection: string }
    }

    /** LLM 撰写正文后保存入参。 */
    export interface ReportSaveInput {
      readonly title?: string
      readonly markdown: string
      readonly sourceIds: SourceId[]
      readonly dateRange: DateRange
      readonly templateId?: TemplateId
      readonly reportType?: string
    }

    domain.ts：reportRecordSchema 对象内 createdAt 前加 reportType: z.string().optional()。

    service.ts：
    - import 行把 './template-default.ts' 的 DEFAULT_TEMPLATE_CONTENT 去掉；把 './render.ts' 的 formatDateRange 去掉（避免重名）；新增 import { DEFAULT_TEMPLATE_SKELETON, formatDateRange, parseTemplate } from './template.ts'。
    - import type 增加 ReportPrepareInput, ReportPrepareResult, ReportSaveInput。
    - 构造函数「内置默认模板」段整体替换为（含旧 mustache 一次性覆盖）：

        // 内置默认模板（LLM 引导骨架）：不存在则种子，存在且为旧 mustache 内容则一次性覆盖。
        // put 的同步段先写内存态（entries 立即可读），异步段负责持久化。
        const now = Date.now()
        const builtin = Array.from(this.templates.entries(), ([, t]) => t).find((t) => t.isBuiltin)
        if (!builtin) {
          const seed: TemplateRecord = {
            id: brandString<TemplateId>(randomUUID()),
            name: BUILTIN_TEMPLATE,
            content: DEFAULT_TEMPLATE_SKELETON,
            isBuiltin: true,
            isDefault: true,
            updatedAt: now,
          }
          void this.templates.put(seed.id, seed)
        } else if (builtin.content.includes('{{')) {
          void this.templates.put(builtin.id, { ...builtin, content: DEFAULT_TEMPLATE_SKELETON, updatedAt: now })
        }

    - generateReport（本任务保留，T4 删除）里 DEFAULT_TEMPLATE_CONTENT 引用改为 DEFAULT_TEMPLATE_SKELETON（旧确定性路径过渡期以骨架为兜底，行为临时退化可接受，T3/T4 随即移除）。
    - createReport 落库处增加 reportType 透传：...(input.reportType !== undefined ? { reportType: input.reportType } : {})。
    - 「报告」节新增两个方法与一个私有解析：

        /** 按 id 取模板；缺省按 isDefault → isBuiltin 兜底。 */
        private resolveTemplate(templateId?: TemplateId): TemplateRecord | undefined {
          if (templateId !== undefined) return this.templates.get(templateId)
          return this.listTemplates().find((t) => t.isDefault) ?? this.listTemplates().find((t) => t.isBuiltin)
        }

        /** 生成准备：解析模板引导（不扫描，agent 的 scan 结果已在上下文）。 */
        async prepareReport(input: ReportPrepareInput): Promise<ReportPrepareResult> {
          const ids = input.sourceIds ?? Array.from(this.sources.entries(), ([, s]) => s.id)
          const template = this.resolveTemplate(input.templateId)
          const parts = parseTemplate(template?.content ?? DEFAULT_TEMPLATE_SKELETON)
          return {
            reportType: input.reportType,
            dateRange: input.dateRange,
            sourceIds: ids,
            sourceCount: ids.length,
            template: {
              name: template?.name ?? BUILTIN_TEMPLATE,
              ...(parts.promptSection !== null ? { promptSection: parts.promptSection } : {}),
              skeletonSection: parts.skeletonSection,
            },
          }
        }

        /** 保存 LLM 撰写的报告正文到 reports 表。 */
        async saveReport(input: ReportSaveInput): Promise<ReportRecord> {
          const markdown = input.markdown.trim()
          if (!markdown) throw new Error('报告正文不能为空')
          return this.createReport({
            title: input.title?.trim() || (input.reportType ?? '报告') + ' · ' + formatDateRange(input.dateRange),
            markdown,
            sourceIds: input.sourceIds,
            ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
            ...(input.reportType !== undefined ? { reportType: input.reportType } : {}),
            dateRange: input.dateRange,
          })
        }

    - REMOTE_METHODS 数组增加 'prepareReport'、'saveReport'（保留 generateReport/createReport 到 T4）。

- [ ] **Step 5: 跑测试与 typecheck（绿灯）**

    Run: pnpm --filter @zzerx/dsh-plugin-daily-log typecheck
    Run: pnpm --filter @zzerx/dsh-plugin-daily-log test
    Expected: typecheck 无 error；全部测试通过（新 template/domain/service 用例 + 原 47 例）。

- [ ] **Step 6: Commit**

    git add packages/plugin-daily-log/src/template.ts packages/plugin-daily-log/src/types.ts packages/plugin-daily-log/src/domain.ts packages/plugin-daily-log/src/service.ts packages/plugin-daily-log/tests/template.test.ts packages/plugin-daily-log/tests/domain.test.ts packages/plugin-daily-log/tests/service.test.ts
    git commit -m "feat(daily-log): 模板改 LLM 引导语义（parse/join + 五节骨架）+ prepareReport/saveReport 服务能力"

---
### Task 3: GUI 客户端切换（生成页 → 引导卡 + 模板两段编辑 + remote 裁剪）

**Files:**
- Modify: packages/plugin-daily-log/src/client/core/remote.ts（descriptors/类型映射/DailyLogRemote 删 generateReport、createReport；清理 import）
- Modify: packages/plugin-daily-log/src/client/views/board.tsx（GenerateTab → GuidanceTab；模板编辑两段式；nav 标签；报告行 reportType 徽标）

**Interfaces:**
- Consumes: src/template.ts 的 DATA_MARKER/parseTemplate/joinTemplate（T2 产出，纯函数，client bundle 可直接 import）。
- Produces: 无（client 不再依赖 dailyLog.generateReport / createReport 远程端点）。

remote 先删类型会让 board 编译错，board 先改会让 remote 类型多余——本任务两者同 commit，最终以 typecheck 绿为准。

- [ ] **Step 1（基线）：确认当前 typecheck 绿**

    Run: pnpm --filter @zzerx/dsh-plugin-daily-log typecheck
    Expected: 无 error（T2 已绿）。改动全程保持绿。

- [ ] **Step 2: remote.ts 删除 generateReport / createReport（三处 + import）**

    1) descriptors 数组删除两行：

        descriptor('createReport', [{ name: 'input', wire: 'input', source: 'json', codec: loose('ReportCreateInput') }]),
        descriptor('generateReport', [{ name: 'input', wire: 'input', source: 'json', codec: loose<ReportGenerateInput>('ReportGenerateInput') }]),

    2) declare module '@deepseek-ai/dsh-typert-protocol' 的类型映射删除两行：

        'dailyLog/createReport': (input: never) => Promise<RemoteResult<ReportRecord>>
        'dailyLog/generateReport': (input: ReportGenerateInput) => Promise<RemoteResult<ReportRecord>>

    3) DailyLogRemote 窄接口删除两个成员：

        createReport(input: never): Promise<RemoteResult<ReportRecord>>
        generateReport(input: ReportGenerateInput): Promise<RemoteResult<ReportRecord>>

    4) 顶部 type import 去掉 ReportGenerateInput（ReportCreateInput 若再无引用一并去掉；ReportRecord 保留——listReports/getReport 仍用）。

- [ ] **Step 3: board.tsx —— 生成页替换为引导卡**

    删除 GenerateTab 组件整体（现 216-282 行）与仅它使用的 isoDaysAgo 函数（25-28 行）。
    nav 标签（198 行）'生成' → '指南'。
    tab 分支（205 行）替换为：

        {tab === 'board' && <GuidanceTab sources={sources} templates={templates} />}

    新增组件（放原 GenerateTab 位置；复用文件顶部 cardStyle/rowStyle/hintStyle/btnStyle/primaryBtnStyle 常量）：

    /* ---------- 指南（对话式生成入口，替代原「扫描并生成」按钮） ---------- */

    function GuidanceTab(props: {
      sources: readonly SourceRecord[]
      templates: readonly TemplateRecord[]
    }): JSX.Element {
      const defaultTemplate = props.templates.find((t) => t.isDefault) ?? props.templates.find((t) => t.isBuiltin)
      const [copied, setCopied] = useState(false)
      const EXAMPLE = '帮我生成本周周报'
      async function copyExample(): Promise<void> {
        try {
          await navigator.clipboard.writeText(EXAMPLE)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          // 剪贴板不可用时静默忽略
        }
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <strong>对话式生成报告</strong>
            <div style={hintStyle}>
              在本窗口左侧的聊天里对 AI 说一句话。AI 会先确认时间范围与项目、扫描数据，
              再亲自把提交/会话归纳成业务化报告（合并同功能提交、按模板结构归类），
              经你确认后保存到「报告」页并可按需导出。
            </div>
            <div style={{ fontSize: 13 }}>示例：「{EXAMPLE}」「汇总最近 3 天的工作」</div>
            <div style={rowStyle}>
              <button type='button' style={primaryBtnStyle} onClick={() => void copyExample()}>
                {copied ? '已复制 ✓' : '复制示例到聊天'}
              </button>
            </div>
          </div>
          <div style={cardStyle}>
            <strong>当前状态</strong>
            <div style={rowStyle}>
              <span style={hintStyle}>默认模板：</span>
              <span>{defaultTemplate?.name ?? '无'}{defaultTemplate?.isBuiltin ? '（内置）' : ''}</span>
            </div>
            <div style={rowStyle}>
              <span style={hintStyle}>数据源：</span>
              <span>{props.sources.length === 0 ? '0 个 —— 请先到「数据源」页添加项目' : props.sources.map((s) => s.label).join('、')}</span>
            </div>
          </div>
        </div>
      )
    }

    GuidanceTab 不再需要 busy/run/dailyLog props；其它三个 Tab 参数保持现状。

- [ ] **Step 4: board.tsx —— 模板编辑改两段式**

    顶部 import 增加：

        import { DATA_MARKER, parseTemplate, joinTemplate } from '../../template.ts'

    TemplateEditDialog（现 679-729 行）整体替换为：

    function TemplateEditDialog(props: {
      dailyLog: DailyLogRemote
      busy: boolean
      run: (action: () => Promise<unknown>) => Promise<boolean>
      editing: TemplateRecord | null
      onClose: () => void
    }): JSX.Element {
      const initial = props.editing !== null ? parseTemplate(props.editing.content) : null
      const [name, setName] = useState(props.editing?.name ?? '')
      const [prompt, setPrompt] = useState(initial?.promptSection ?? '')
      const [skeleton, setSkeleton] = useState(initial?.skeletonSection ?? '')

      async function save(): Promise<void> {
        if (name.trim() === '' || skeleton.trim() === '') return
        const content = joinTemplate(prompt, skeleton)
        await props.run(async () => {
          const res =
            props.editing !== null
              ? await props.dailyLog.updateTemplate(props.editing.id as never, { name: name.trim(), content })
              : await props.dailyLog.createTemplate({ name: name.trim(), content })
          if (!res.ok) throw new Error(errText(res.error))
          props.onClose()
        })
      }

      return (
        <div style={overlayStyle} onClick={props.onClose}>
          <div style={dialogStyle} onClick={(e) => { e.stopPropagation() }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 14 }}>{props.editing !== null ? '编辑模板' : '新增模板'}</strong>
              <span style={hintStyle}>指令段（可选） + {DATA_MARKER} + 骨架段；内容作为结构引导喂给生成 AI</span>
            </div>
            <input style={inputStyle} placeholder='模板名' value={name} onChange={(e) => setName(e.target.value)} />
            <textarea
              style={{ ...inputStyle, minHeight: 90, fontFamily: 'monospace', resize: 'vertical' }}
              placeholder={'指令段（可选）：给生成 AI 的额外撰写要求，如「按周维度组织，每周一个小节」'}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, borderTop: '1px solid var(--dsw-alias-border-l2)' }} />
              <span style={hintStyle}>骨架段（报告章节结构，必填）</span>
              <span style={{ flex: 1, borderTop: '1px solid var(--dsw-alias-border-l2)' }} />
            </div>
            <textarea
              style={{ ...inputStyle, minHeight: 260, fontFamily: 'monospace', resize: 'vertical' }}
              placeholder={'章节标题，示例：\n## 核心产出\n## 问题修复\n## 技术优化\n## 其他工作\n## 下一步计划'}
              value={skeleton}
              onChange={(e) => setSkeleton(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type='button' style={btnStyle} onClick={props.onClose}>取消</button>
              <button type='button' style={primaryBtnStyle} disabled={props.busy || name.trim() === '' || skeleton.trim() === ''} onClick={() => void save()}>
                {props.editing !== null ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )
    }

    TemplatesTab 空态文案（现 886 行）改为 '尚无模板。点击右上「新增模板」创建两段式模板（指令段可选 + 骨架段必填）。'。

- [ ] **Step 5: board.tsx —— 报告行展示 reportType 徽标**

    ReportsTab 行内 dateRange span 之后加：

        {r.reportType !== undefined && <span style={hintStyle}>{r.reportType}</span>}

- [ ] **Step 6: typecheck 验证**

    Run: pnpm --filter @zzerx/dsh-plugin-daily-log typecheck
    Expected: 无 error（board 不再引用 dailyLog.generateReport；remote 无 createReport/generateReport 残留）。

- [ ] **Step 7: Commit**

    git add packages/plugin-daily-log/src/client/core/remote.ts packages/plugin-daily-log/src/client/views/board.tsx
    git commit -m "feat(daily-log): GUI 生成页改对话式引导卡 + 模板两段编辑 + remote 裁剪 generate/create"

---

### Task 4: host 删除确定性 + agent 工具重写 + 提示分区

**Files:**
- Modify: packages/plugin-daily-log/src/service.ts（删 generateReport；REMOTE_METHODS 删 generateReport/createReport；imports 清理）
- Delete: packages/plugin-daily-log/src/render.ts、packages/plugin-daily-log/src/template-default.ts
- Modify: packages/plugin-daily-log/src/types.ts（删 ReportGenerateInput）
- Modify: packages/plugin-daily-log/src/agent/tools.ts（删 generate 工具；新增 prepare_report/save_report/export_report；WRITE_TOOLS/describeAction 同步）
- Modify: packages/plugin-daily-log/src/agent/reference.ts（文本抽为导出常量 DAILY_LOG_REFERENCE_TEXT，三段）
- Test: Delete tests/render.test.ts；Create tests/reference.test.ts；Modify tests/integration.test.ts、tests/service.test.ts

**Interfaces:**
- Consumes: T2 的 parseTemplate/DEFAULT_TEMPLATE_SKELETON/prepareReport/saveReport/ReportPrepareInput/ReportSaveInput/ReportPrepareResult；service 现有 exportReport。
- Produces（T5/T6 依赖）:
    const DAILY_LOG_REFERENCE_TEXT: string
    新工具名：daily_log_prepare_report（只读放行）、daily_log_save_report（写 ask）、daily_log_export_report（写 ask）

- [ ] **Step 1: 写失败测试（reference/integration 先行）**

    tests/reference.test.ts 全文：

    import { describe, expect, it } from 'vitest'
    import { DAILY_LOG_REFERENCE_TEXT } from '../src/agent/reference.ts'

    describe('agent reference 三段提示', () => {
      it('含总则/收集/生成关键约束与工具名', () => {
        expect(DAILY_LOG_REFERENCE_TEXT).toContain('data-driven')
        expect(DAILY_LOG_REFERENCE_TEXT).toContain('daily_log_prepare_report')
        expect(DAILY_LOG_REFERENCE_TEXT).toContain('daily_log_save_report')
        expect(DAILY_LOG_REFERENCE_TEXT).toContain('未经用户确认')
      })
    })

    tests/integration.test.ts 全文替换（确定性渲染路径已删，改为真实仓库扫描 + 默认骨架语义）：

    import { describe, expect, it } from 'vitest'
    import { dirname, resolve } from 'node:path'
    import { fileURLToPath } from 'node:url'
    import { gitChannel } from '../src/sources/git.ts'
    import { DEFAULT_TEMPLATE_SKELETON, parseTemplate } from '../src/template.ts'

    const here = dirname(fileURLToPath(import.meta.url))
    // packages/plugin-daily-log/tests → workspace root 上溯三层
    const workspaceRoot = resolve(here, '..', '..', '..')

    describe('端到端：git 扫描（workspace 真实仓库）', () => {
      it('gitChannel 能收集到 commit 条目', async () => {
        const entries = await gitChannel.scan({ path: workspaceRoot, label: 'dsh-desk-studio', range: { since: '2020-01-01' } })
        expect(entries.length).toBeGreaterThan(0)
        expect(entries.every((e) => e.kind === 'commit')).toBe(true)
        expect(entries[0].sourceLabel).toBe('dsh-desk-studio')
        expect(entries[0].title).toBeTruthy()
      })
    })

    describe('默认模板（LLM 引导骨架）', () => {
      it('骨架含五节、无 mustache、整份视为骨架', () => {
        const parts = parseTemplate(DEFAULT_TEMPLATE_SKELETON)
        expect(parts.promptSection).toBeNull()
        expect(parts.skeletonSection).toContain('## 核心产出')
        expect(parts.skeletonSection).not.toContain('{{')
      })
    })

    tests/service.test.ts：若存在针对 generateReport 的用例则删除；扫描 describe 后新增：

      it('saveReport 空正文被拒绝', async () => {
        const { svc } = makeService()
        const s = await svc.addSource({ path: '/a' })
        await expect(svc.saveReport({ markdown: '   ', sourceIds: [s.id], dateRange: { since: 'x' } })).rejects.toThrow(/正文不能为空/)
      })

- [ ] **Step 2: 跑测试确认红灯**

    Run: pnpm --filter @zzerx/dsh-plugin-daily-log test
    Expected: FAIL —— DAILY_LOG_REFERENCE_TEXT 不存在（模块错误）等。

- [ ] **Step 3: reference.ts 三段文本（实现）**

    src/agent/reference.ts 全文替换为：

    /**
     * plugin-daily-log × agent harness 桥（host 侧）—— 对话式生成报告的模型引导。
     * 三段软性约束：总则 / 收集礼仪 / 生成礼仪（无阶段状态机，靠提示 + 工具条件）。
     */

    import type { Context } from '@deepseek-ai/cordis'

    export const DAILY_LOG_REFERENCE_SECTION = 'forge-daily-log:reporting'

    /** 可测试的提示文本常量。 */
    export const DAILY_LOG_REFERENCE_TEXT = [
      '## Daily work log (plugin-daily-log)',
      '',
      'Generate daily/weekly/monthly work reports conversationally from Git commits and local agent conversations',
      '(deepseek / claude / codex) via the daily_log_* tools.',
      '',
      '### 总则',
      '- data-driven：一切结论必须来自 daily_log_* 工具返回的真实数据，绝不编造或推测。',
      '- 诚实透明：空数据、工具失败如实告知，不用默认值掩盖。',
      '- 中文交流；报告用业务语言，不用代码流水账。',
      '',
      '### 收集（扫描前）',
      '- 先确认时间范围与项目集（daily_log_list_sources 查看已添加项目）；用户指令不完整时反问，不自行猜测。',
      '- 扫描结果为空/明显过少、提交信息过简（update/fix/wip 之类）→ 反问是否遗漏项目或范围有误。',
      '- 扫描后口头询问「是否有未提交/未完成/未体现在扫描结果里的工作（协助、会议、进行中会话等）」。',
      '',
      '### 生成（撰写正文）',
      '- 调用 daily_log_prepare_report 获取所选模板的指令/骨架引导，然后【你亲自撰写正文】。',
      '- 按骨架归类：feat/新增 → 核心产出；fix → 问题修复；refactor/perf → 技术优化；隐性工作 → 其他工作。',
      '- 同功能多次提交合并为一条业务描述。坏例：「修改了 user.ts 的 login 方法」；好例：「完成用户登录模块重构，提升可维护性」。',
      '- 写完先在回复中展示正文并询问是否调整；未经用户确认不得调用 daily_log_save_report / daily_log_export_report。',
    ].join('\n')

    export function installDailyLogReferencePrompt(ctx: Context): void {
      ctx.systemPrompt.section({
        name: DAILY_LOG_REFERENCE_SECTION,
        order: 2950,
        text: DAILY_LOG_REFERENCE_TEXT,
      })
    }

    注：原文件 import 的 DAILY_LOG_TOOL_PREFIX 若不再被本文件引用则删除（避免 unused 编译错）。

- [ ] **Step 4: service.ts 删除确定性（实现）**

    - 删除 generateReport 方法整段。
    - REMOTE_METHODS 数组去掉 'createReport'、'generateReport'（prepareReport/saveReport 已在 T2 加入）。
    - import 行去掉 './render.ts' 与 './template-default.ts' 相关导入；types import 去掉 ReportGenerateInput。
    - createReport 保留为内部方法（saveReport 调用；远程列表已无它）。
    - 删除 src/render.ts 与 src/template-default.ts；types.ts 删除 ReportGenerateInput。
    - grep 验证：在 packages/plugin-daily-log/src 里搜 render.ts|template-default|ReportGenerateInput|buildRenderData|renderTemplate → 期望 0 命中（tools.ts 的 generate 残留经 Step 5 清除后复验）。

- [ ] **Step 5: agent/tools.ts 工具面重写（实现）**

    常量区删除 TOOL_GENERATE，新增：

    const TOOL_PREPARE = DAILY_LOG_TOOL_PREFIX + 'prepare_report'
    const TOOL_SAVE = DAILY_LOG_TOOL_PREFIX + 'save_report'
    const TOOL_EXPORT = DAILY_LOG_TOOL_PREFIX + 'export_report'

    WRITE_TOOLS 改为：

    const WRITE_TOOLS = new Set<string>([
      TOOL_ADD_SOURCE, TOOL_SAVE, TOOL_EXPORT, TOOL_DELETE_REPORT,
      TOOL_TEMPLATE_CREATE, TOOL_TEMPLATE_UPDATE, TOOL_TEMPLATE_DELETE, TOOL_TEMPLATE_SET_DEFAULT,
    ])

    describeAction 增补两个 case：

      case TOOL_SAVE: return 'save a generated report'
      case TOOL_EXPORT: return 'export a report to a markdown file'

    删除整段 TOOL_GENERATE 注册（从 ctx.tools.register(defineTool({ 起、name: TOOL_GENERATE 处，到该块收尾的 })) 为止）。

    新增三个注册块（追加在删除处附近；结构照抄现文件 TOOL_LIST_SOURCES / TOOL_ADD_SOURCE 的 defineTool 范式）：

    /* prepare_report：进入生成阶段，返回模板引导（只读，不扫描） */

    ctx.tools.register(defineTool({
      name: TOOL_PREPARE,
      description: 'Enter the generation phase: resolve the selected template guidance (optional instruction section + required skeleton section) and source count WITHOUT scanning again (scan results are already in context). You then write the report body yourself following the guidance.',
      parameters: {
        reportType: { type: 'string', required: true, description: 'Report type label, e.g. 日报 / 周报 / 月报.' },
        since: { type: 'string', required: true, description: 'Start date, e.g. "2026-06-30".' },
        until: { type: 'string', description: 'Optional end date.' },
        source_ids: { type: 'array', items: { type: 'string' }, description: 'Optional source ids; omit to use all sources.' },
        template_id: { type: 'string', description: 'Optional template id; omit to use the default template.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            templateName: { type: 'string', required: true },
            skeletonSection: { type: 'string', required: true },
            sourceCount: { type: 'number', required: true },
          },
        },
        render: (_args, value) => {
          const v = value as { templateName: string; skeletonSection: string; sourceCount: number }
          return [{ type: 'text', text: 'template: ' + v.templateName + ' (sources: ' + v.sourceCount + ')\n\n骨架：\n' + v.skeletonSection.slice(0, 600) }]
        },
      },
      async execute(args) {
        const r = await svc.prepareReport({
          reportType: args.reportType as string,
          dateRange: { since: args.since as string, ...(args.until !== undefined ? { until: args.until as string } : {}) },
          ...(args.source_ids !== undefined ? { sourceIds: args.source_ids as SourceId[] } : {}),
          ...(args.template_id !== undefined ? { templateId: args.template_id as TemplateId } : {}),
        })
        return { templateName: r.template.name, skeletonSection: r.template.skeletonSection, sourceCount: r.sourceCount }
      },
    }))

    /* save_report：把 LLM 撰写的正文落 reports 表（写，ask） */

    ctx.tools.register(defineTool({
      name: TOOL_SAVE,
      description: 'Save a report the model authored (full markdown body) into the reports table. Only call AFTER the user confirms the report shown in chat. Returns the report id.',
      parameters: {
        markdown: { type: 'string', required: true, description: 'The full markdown body the model wrote.' },
        title: { type: 'string', description: 'Optional report title; defaults to reportType + date range.' },
        reportType: { type: 'string', description: 'Report type label (stored on the record), e.g. 周报.' },
        since: { type: 'string', required: true, description: 'Start date, e.g. "2026-06-30".' },
        until: { type: 'string', description: 'Optional end date.' },
        source_ids: { type: 'array', items: { type: 'string' }, required: true, description: 'Source ids the report covers.' },
        template_id: { type: 'string', description: 'Optional template id used for generation.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, title: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: 'saved report ' + (value as { id: string }).id }],
      },
      async execute(args) {
        const r = await svc.saveReport({
          markdown: args.markdown as string,
          ...(args.title !== undefined ? { title: args.title as string } : {}),
          ...(args.reportType !== undefined ? { reportType: args.reportType as string } : {}),
          dateRange: { since: args.since as string, ...(args.until !== undefined ? { until: args.until as string } : {}) },
          sourceIds: (args.source_ids as SourceId[]) ?? [],
          ...(args.template_id !== undefined ? { templateId: args.template_id as TemplateId } : {}),
        })
        return { id: r.id, title: r.title }
      },
    }))

    /* export_report：把已存报告导出为 .md（写，ask） */

    ctx.tools.register(defineTool({
      name: TOOL_EXPORT,
      description: 'Export an existing report (from daily_log_list_reports / daily_log_save_report) to a markdown file under the configured output directory.',
      parameters: {
        report_id: { type: 'string', required: true, description: 'The report id.' },
        output_dir: { type: 'string', description: 'Optional output directory; defaults to the configured one or ~/daily-log-reports.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: 'exported to ' + (value as { path: string }).path }],
      },
      async execute(args) {
        const path = await svc.exportReport(args.report_id as ReportId, args.output_dir !== undefined ? (args.output_dir as string) : undefined)
        return { path }
      },
    }))

- [ ] **Step 6: 全量 typecheck + 测试（绿灯）**

    Run: pnpm --filter @zzerx/dsh-plugin-daily-log typecheck
    Run: pnpm --filter @zzerx/dsh-plugin-daily-log test
    Expected: typecheck 无 error；vitest 全绿（新 reference/integration/service 用例通过；render.test.ts 已删）。

- [ ] **Step 7: Commit**

    git add packages/plugin-daily-log/src/service.ts packages/plugin-daily-log/src/types.ts packages/plugin-daily-log/src/render.ts packages/plugin-daily-log/src/template-default.ts packages/plugin-daily-log/src/agent/tools.ts packages/plugin-daily-log/src/agent/reference.ts packages/plugin-daily-log/tests/render.test.ts packages/plugin-daily-log/tests/reference.test.ts packages/plugin-daily-log/tests/integration.test.ts packages/plugin-daily-log/tests/service.test.ts
    git commit -m "feat(daily-log): 删除确定性渲染，agent 改对话式生成（prepare/save/export 工具 + 三段提示）"


---

### Task 5: 数据源候选 DSH 徽标诚实化（host 微改）

**Files:**
- Modify: packages/plugin-daily-log/src/service.ts（listWorkspaceCandidates 的 dsh 徽标与 detail 文案）
- Modify: packages/plugin-daily-log/tests/service.test.ts（对应断言）

**Interfaces:**
- Consumes: 无（只改既有方法返回的 ProjectChannels/detail）。
- Produces: 无（行为变化：候选 channels.dsh 恒 false，detail 注明源未接入）。

背景：dsh 渠道未实现，但 listWorkspaceCandidates 把工作区项目强制标 dsh=true，UI 徽标误导为「该来源有活动」。

- [ ] **Step 1: 写失败测试**

    tests/service.test.ts 的 'listWorkspaceCandidates：type 判定 + dsh 命中 + git 徽标 + added' 用例调整断言：
    - channels 期望从 { dsh: true, git: true, claude: false, codex: false } 改为 { dsh: false, git: true, claude: false, codex: false }；
    - detail 期望 '3 个 DSH 会话' 改为 '3 个 DSH 会话（DSH 源未接入）'；
    - 第二个候选（docs）的 channels 期望 dsh: false。

    新增用例：

      it('工作区候选 dsh 徽标如实为 false（源未接入，不误导）', async () => {
        const { svc } = makeService({
          workspaceProjects: async () => [{ path: '/ws/proj', title: 'p', sessionIds: ['s1'] }],
        })
        const before = await svc.listWorkspaceCandidates()
        expect(before[0]?.channels.dsh).toBe(false)
        expect(before[0]?.detail).toContain('DSH 源未接入')
      })

- [ ] **Step 2: 跑测试确认失败（红灯）**

    Run: pnpm --filter @zzerx/dsh-plugin-daily-log test
    Expected: listWorkspaceCandidates 相关用例 FAIL（channels.dsh 仍为 true / detail 无「DSH 源未接入」）。

- [ ] **Step 3: service.ts 实现**

    listWorkspaceCandidates 方法内，把：

        // 候选来自 DSH 工作区 → dsh 渠道命中（该路径有工作区会话）。
        channels.dsh = true

    替换为：

        // dsh 会话渠道尚未实现：徽标如实置暗，detail 注明未接入（接入后改回 true）。
        // channels.dsh = true

    detail 构造行改为：

        detail: p.sessionIds.length > 0 ? p.sessionIds.length + ' 个 DSH 会话（DSH 源未接入）' : undefined,

- [ ] **Step 4: typecheck + 测试绿灯**

    Run: pnpm --filter @zzerx/dsh-plugin-daily-log typecheck
    Run: pnpm --filter @zzerx/dsh-plugin-daily-log test
    Expected: 全部通过。

- [ ] **Step 5: Commit**

    git add packages/plugin-daily-log/src/service.ts packages/plugin-daily-log/tests/service.test.ts
    git commit -m "fix(daily-log): 工作区候选 DSH 徽标如实置暗并注明源未接入"

---

### Task 6: 依赖清理 + README/PLAN 同步 + 全量验证

**Files:**
- Modify: packages/plugin-daily-log/package.json（devDependencies 去 mustache 与 @types/mustache）
- Modify: packages/plugin-daily-log/README.md（功能/模板占位符/生成流程对齐新语义）
- Modify: packages/plugin-daily-log/PLAN.md（补状态指向：生成语义已按 2026-09-08 spec 改为对话式）
- 命令：pnpm install（更新 workspace lockfile）；重建 lib；全局 grep 验无 mustache

**Interfaces:**
- Consumes: T1-T5 的全部落地形态。
- Produces: 包进入可发布验收态（typecheck/test/build 全绿）。

- [ ] **Step 1: package.json 移除 mustache 依赖**

    删除 devDependencies 里两行：

        "mustache": "4.2.0",
        "@types/mustache": "4.2.5"

    然后仓库根执行 pnpm install 更新 lockfile（pnpm-lock.yaml 会连带变动，仅提交与 plugin 相关的 diff 部分，若 pnpm 一次性重排则整文件提交并在 commit message 注明）。

- [ ] **Step 2: README.md 同步（替换三处内容）**

    1) 「按模板生成」功能条目替换为：

    - **对话式生成**：在聊天里说「帮我生成本周周报」，agent 先确认时间范围与项目、扫描 Git 提交与本地 agent 对话，再亲自按模板结构把活动归纳成业务化报告（合并同功能提交、归类到核心产出/问题修复/技术优化等章节）；经你确认后保存到报告历史并可导出 .md。

    2) 「模板占位符」章节整体替换为：

    ## 模板（LLM 引导）

    模板是「指令段（可选） + <!-- DATA --> + 骨架段」的 Markdown：两者都会作为结构引导注入生成阶段的提示，AI 按骨架章节撰写正文（不是占位符替换）。内置 default 提供五节骨架（核心产出 / 问题修复 / 技术优化 / 其他工作 / 下一步计划）；模板页可创建/编辑两段式自定义模板。

    3) 「agent 工具」条目里的工具清单改为 list_sources / scan / prepare_report / save_report / export_report 等。

- [ ] **Step 3: PLAN.md 状态补注**

    在 PLAN.md 开头（标题下）追加一行：

    > 2026-09-08 更新：生成语义已按 docs/superpowers/specs/2026-09-08-daily-log-conversational-generation-design.md
    > 重构为「对话式生成」——确定性 mustache 渲染已移除，实施计划见 docs/superpowers/plans/2026-09-08-daily-log-conversational-generation.md。

- [ ] **Step 4: 全量验证**

    Run: pnpm --filter @zzerx/dsh-plugin-daily-log typecheck
    Run: pnpm --filter @zzerx/dsh-plugin-daily-log test
    Run: pnpm --filter @zzerx/dsh-plugin-daily-log build
    Expected: 三者全绿；lib/index.js + lib/client.js + lib/types 重新产出。
    附加：在 packages/plugin-daily-log 内搜 mustache 与 {{ 于 src/ —— src 无 mustache import、模板默认骨架除外无 '{{'（grep '{{' src 应仅命中 service.ts 迁移检测的 includes('{{') 与注释）。

- [ ] **Step 5: Commit**

    git add packages/plugin-daily-log/package.json pnpm-lock.yaml packages/plugin-daily-log/README.md packages/plugin-daily-log/PLAN.md packages/plugin-daily-log/lib
    git commit -m "chore(daily-log): 去 mustache 依赖，README/PLAN 同步对话式生成语义，重建 lib"

---

## 自检记录（writing-plans 自审，随计划落库）

- spec 覆盖：§3 服务端（T2/T4）、§3.2 模板解析（T2）、§3.2 remote 同步（T3）、§4 提示分区与工具（T4）、§5 GUI（T3）、§5.2 DSH 徽标（T5）、§6 工程与验收（T1/T4/T6）、§6.1 测试迁移（各任务）。
- 无占位符：所有代码步骤含完整可执行片段；唯一引导性指令（「删除整段 TOOL_GENERATE 注册」）锚定在真实文件常量名与 defineTool 结构上。
- 类型一致性：prepareReport/saveReport 签名在 T2 定义并被 T4 工具按同名调用；DAILY_LOG_REFERENCE_TEXT 在 T4 定义并被 reference.test 引用；parseTemplate/joinTemplate/DATA_MARKER 在 T2 定义并被 T3 board 引用。
- 顺序约束：T2 先加能力保编译，T3 先切 GUI 再删 remote 类型，T4 同 commit 删 host 确定性 + 重写 agent 工具，避免中间态 typecheck 红。

