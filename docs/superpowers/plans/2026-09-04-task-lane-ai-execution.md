# 任务泳道 × AI 执行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 plugin-notes 的任务泳道从「纸色即状态」改成「显式任务（lane 对象）+ 会话内 AI 执行 + 租约授权 + 自动改状态/落结果」，颜色恢复自由六色。

**Architecture:** 数据层（`lane: { status, run? }` 嵌 NoteRecord，颜色脱钩）+ 授权层（taskLeases 表 + 两个窄权限 agent 工具 + guard 无 ask）+ 执行层（host 侧 `taskExecute` = 建租约 + 经 `ctx.sessionController` 投递会话消息，失败回滚）+ 交互层（泳道卡状态机 + 编辑器任务开关 + 轮询加速）。全程不改 harness、插件内自包含（对齐既有 notes CRUD / agent 桥 / Typert remote 三件套范式）。

**Tech Stack:** cordis / dsh-tools / dsh-storage-domain / zod / React + tiptap（client）/ vitest；命令走 `pnpm --filter @forge-studio/dsh-plugin-notes <typecheck|test|build>`。

**Spec:** `docs/superpowers/specs/2026-09-04-task-lane-ai-execution-design.md`（本计划从 spec 推导，执行者两篇都要读）。

## Global Constraints

- 不改 harness（`D:\codes\deepseek-harness` 只读参考，禁止改）。
- 持久化只走 `ctx.storage`（storage-domain），不自造。
- client 对跨插件值一律 type-only import（见 build.mjs PLATFORM_MODULES / INJECT_MODULES 外化约定）。
- 任何 `*.log` 落盘 `.research/logs/`，禁止放仓库根/packages。
- `lane` 字段可选：无 = 普通便签（不进泳道）；旧记录无需迁移回填。
- agent 只能通过 `notes_task_set_status` / `notes_task_report` 触碰任务 lane；title/text/color 归属不变（删 user 便签的 guard 照旧）。
- 用户手动改状态/重置 → 撤销租约（D5/M3）。
- 现有 `TaskStatus`/`TaskLaneDef` 等符号如需跨 host/client 共用，迁到 `src/types.ts`，client `core/task-lanes.ts` 转发导出保持引用不破。
- 每任务结尾必须：`pnpm --filter @forge-studio/dsh-plugin-notes typecheck` 通过 + 相关 vitest 通过 + git commit。

## File Structure

- `src/types.ts` — 领域类型：六色、`NoteLane/NoteRun/TaskStatus`（迁入）、`lane?` 进 Record/Update/Create。
- `src/domain.ts` — notes 域 schema 加 `lane`；新增 `leases` 表 + `TaskLease` schema。
- `src/service.ts` — NotesService：update/create lane 支持、删除/归档钩子撤销租约、`grantTaskLease/revokeTaskLease`、`taskExecute/taskReset`（dispatch 注入）、remote 方法标记。
- `src/agent/tools.ts` — 读工具输出带 lane；新增两个 `notes_task_*` 工具 + guard（无 ask）。
- `src/client/core/notes-remote.ts` — 远端 descriptors/codec 增补（lane patch、taskExecute/taskReset）。
- `src/client/core/task-lanes.ts` — 纯语义重写：按 `lane.status` 分列；run 帧纯函数；转发导出状态/标签。
- `src/client/core/note-colors.ts` — 六色板（含紫）。
- `src/client/views/board-view.tsx` — onMove 改写 lane；saveDraft 带 lane；轮询加速；执行/重置回调接线。
- `src/client/components/task-lanes.tsx` / `task-lane-card.tsx` — 列头（无状态点/「＋」新建任务）+ 卡片执行按钮与 running 视觉 + summary 首行。
- `src/client/components/note-editor.tsx` / `src/client/views/editor-page-dialog.tsx` — 任务开关（状态选择）+ 只读「任务与结果」区。
- `src/client/core/board-store.ts` —（如需）运行中任务的派生 getter（可省，见 T7）。
- tests/ — 每文件配套（列表见各任务）。

---

### Task 1: 类型与色板：六色回归 + lane 模型

**Files:**
- Modify: `src/types.ts`
- Modify: `src/client/core/note-colors.ts`
- Test: `tests/note-colors.test.ts`, `tests/domain.test.ts`

**Interfaces:**
- Consumes: 现状五色常量。
- Produces: `NOTE_COLORS` 六色（`'purple'` 回归）；`TaskStatus`、`NoteRun`、`NoteLane`、`NoteRecord.lane?`、`NoteCreateInput.laneStatus?`、`NoteUpdateInput.lane?`；`normalizeNoteColor` 不再把 `purple` 归一为灰。

- [ ] **Step 1: 写失败测试**（`tests/note-colors.test.ts` 追加）

```ts
it('紫色回归为合法纸色', () => {
  expect(NOTE_COLORS).toContain('purple')
  expect(normalizeNoteColor('purple')).toBe('purple')
  expect(NOTE_COLOR_PALETTE.map((c) => c.id)).toEqual([...NOTE_COLORS])
})
```

- [ ] **Step 2: 运行确认失败** — `pnpm --filter @forge-studio/dsh-plugin-notes test note-colors`（purple 断言挂）。

- [ ] **Step 3: 实现** — `src/types.ts`：`NOTE_COLORS` 加入 `'purple'`；`normalizeNoteColor` 改为仅做枚举成员校验（去掉 purple→gray 分支）；在文件顶部新增共享任务类型（host 需要，勿放 client core）：

```ts
export type TaskStatus = 'backlog' | 'todo' | 'running' | 'done' | 'failed'
export interface NoteRun {
  readonly startedAt: number
  readonly finishedAt?: number
  readonly ok?: boolean
  readonly summary?: string
}
export interface NoteLane { readonly status: TaskStatus; readonly run?: NoteRun }
```

`NoteRecord` 追加 `readonly lane?: NoteLane`；`NoteCreateInput` 追加 `readonly laneStatus?: TaskStatus`；`NoteUpdateInput` 追加 `readonly lane?: { readonly status?: TaskStatus; readonly run?: NoteRun }`。`src/client/core/note-colors.ts` 的 `NOTE_COLOR_PALETTE` 在 pink 与 gray 之间插 `{ id: 'purple', label: '紫', paper: '#D9C6F5', ring: '#9B6FD6' }`。

- [ ] **Step 4: 运行通过** — 上述测试 + `pnpm --filter @forge-studio/dsh-plugin-notes test`。
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(notes): 恢复六色纸板 + lane 任务模型类型"`

---

### Task 2: 存储与写入通道：domain schema + 服务 lane 支持 + 远端 codec

**Files:**
- Modify: `src/domain.ts`
- Modify: `src/service.ts`
- Modify: `src/client/core/notes-remote.ts`
- Modify: `src/agent/tools.ts`（仅 notes_get/notes_list 输出补 lane 只读透出，写工具不动）
- Test: `tests/domain.test.ts`, `tests/service.test.ts`, `tests/remote.test.ts`, `tests/agent-tools.test.ts`

**Interfaces:**
- Consumes: Task1 类型。
- Produces: `NotesService.update(id, { lane: { status } | { run } })`（缺省字段保留、不得清空同层其他字段，即 `lane` patch 与顶层同语义：`next.lane = { ...current.lane, ...patch.lane }`，patch 空对象 no-op）；`NotesService.create` 接受 `laneStatus`（init `lane: { status }`）；`notes_list/notes_get` 输出与 `noteText` 渲染携带 lane。

- [ ] **Step 1: 失败测试先行**（service.test / domain.test / remote.test 各补用例；以 service 为例）

```ts
it('update 可 patch lane.status 且保留 lane.run', async () => {
  const created = await service.create({ text: 'x', laneStatus: 'todo' })
  expect(created.lane).toEqual({ status: 'todo' })
  const run = { startedAt: 1 }
  const withRun = await service.update(created.id, { lane: { status: 'running', run } })
  expect(withRun?.lane).toEqual({ status: 'running', run })
  const statusOnly = await service.update(created.id, { lane: { status: 'done' } })
  expect(statusOnly?.lane).toEqual({ status: 'done', run }) // run 保留
})
```

- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现**
  1. `src/domain.ts`：`noteRecordSchema` 增加 `lane: z.object({ status: z.enum([...]), run: z.object({ startedAt: z.number(), finishedAt: z.number().optional(), ok: z.boolean().optional(), summary: z.string().optional() }).optional() }).optional()`（状态枚举与 Task1 一致；写死字面量数组以防循环 import，注释注明与 types.ts 同步）。
  2. `src/service.ts`：create 增加 laneStatus → `lane: { status: input.laneStatus }`（undefined 时不带）；update 增加 lane patch（`const lane = patch.lane === undefined ? current.lane : { ...current.lane, ...patch.lane, ...(patch.lane.status !== undefined ? { status: patch.lane.status } : {}) }`，注意 run 若 patch 提供 `run: undefined` 不出现，按 `'run' in patch.lane` 语义处理——提供即整体替换 run）；remote 方法标记不变（仍是 list/create/update/…）。
  3. `src/client/core/notes-remote.ts`：`updateInputSchema`/`createInputSchema` 增加 lane 形状校验（status ∈ 五枚举；run 结构透传 strict 校验 startedAt number、其余可选）；`NoteCreateInput`/`NoteUpdateInput` wire 照旧。
  4. `src/agent/tools.ts`：`noteText` 与两个读工具 output schema 增加 `lane`（形状同 domain，多包一层 `lane: { status, run? }` 的 optional object）；render 文本追加 `\n(task: {status})`/`{status} · run@{startedAt}` 风格行；**不**改动写工具参数（agent 写 lane 只能走 T5 的 notes_task_*）。
- [ ] **Step 4: 运行通过** — service/domain/remote/agent-tools 全部测试 + typecheck。
- [ ] **Step 5: Commit** — `feat(notes): lane 写入通道（domain/service/remote/读透出）`

---

### Task 3: 纯语义重写：泳道按 lane.status 分列

**Files:**
- Modify: `src/client/core/task-lanes.ts`（重写）
- Modify: `src/client/views/board-view.tsx`（onMove 一处改 lane）
- Modify: `src/client/components/task-lanes.tsx`（仅删 `StatusDot`/`lane.color` 引用，保编译绿；T7 才重做列头视觉）
- Test: `tests/task-lanes.test.ts`, `tests/task-lanes-view.test.tsx`

**Interfaces:**
- Consumes: Task1 `TaskStatus`/`NoteLane`、Task2 update 通道。
- Produces（全部纯函数/常量）：
  - `TASK_LANES: readonly { status; label }[]`（五列，**无 color**）；
  - `laneLabel(status)`；
  - `groupNotesByLane(notes)` → `TaskLaneGroup[]`，**只含 `note.lane` 存在的便签**，按 `note.lane.status` 分列（无 lane 的便签不进任何列）；
  - `makeLane(status)` → `{ status }`；
  - `beginRun(lane, startedAt)` → `{ status: 'running', run: { startedAt } }`；
  - `settleRun(lane, ok, summary, at)` → `{ ...lane, run: { ...lane.run, finishedAt: at, ok, summary } }`（run 不存在时不炸，先按 `startedAt: at` 造）；
  - `isRunOpen(lane)` → `Boolean(lane.run && lane.run.finishedAt === undefined)`；
  - **删除** `TaskStatus`/`TaskLaneDef.color`/`colorForStatus`/`statusForColor`（Task1 起 TaskStatus 在 types.ts，此处转发导出以兼容旧 import）。

- [ ] **Step 1: 失败测试**（重写 `tests/task-lanes.test.ts` 分组用例 + `task-lanes-view.test.tsx` fixture 改用带 lane 的记录，断言无 lane 记录不渲染）
- [ ] **Step 2: 运行确认失败**（旧分组按 color 的用例与类型错误全红）。
- [ ] **Step 3: 实现** — 按 Interfaces 重写 `core/task-lanes.ts`；`task-lanes.tsx` 删除 `StatusDot` 组件与 `import { noteColorMeta }`/`statusForColor` 残留、header 只留标签+计数（`lane.color` 不再存在）；`board-view.tsx` 的 `onMove` 改为：

```ts
onMove={(id: NoteId, status: TaskStatus) =>
  void run(() => props.face.notes.update(id, { lane: { status } }))}
```

删掉 `import { colorForStatus }`。
- [ ] **Step 4: 运行通过** — 全量 test + typecheck。
- [ ] **Step 5: Commit** — `feat(notes): 泳道语义切到 lane.status（颜色脱钩）`

---

### Task 4: 租约：taskLeases 表 + 服务方法

**Files:**
- Modify: `src/domain.ts`（加 leases 表）
- Modify: `src/service.ts`（lease 方法 + 删除/归档钩子）
- Test: `tests/service.test.ts`, `tests/domain.test.ts`

**Interfaces:**
- Consumes: notes 表同域。
- Produces：
  - `TaskLease { noteId: NoteId; sessionId: string; grantedAt: number }`；
  - domain `leases` 表（per-record，key = noteId，schema zod 形状校验）；
  - `NotesService.grantTaskLease(id, sessionId)` → `'granted' | 'missing' | 'busy'`（busy = 已有 lease 或 note 无 lane；grant 时同步把 lane 置 running + beginRun(now)）；
  - `NotesService.revokeTaskLease(id)` → boolean（幂等）；
  - delete 删除前、update 把 archived 置 true 时 → revokeTaskLease；同时 update 里 **lane 若因手动 patch 改状态 → 撤销租约**（任何用户侧 lane.status 变更即接管，T7 的 UI 走同一条 update）。

- [ ] **Step 1: 失败测试**（service.test 追加）：

```ts
it('grant/revoke 与 busy 冲突', async () => {
  const n = await service.create({ text: 't', laneStatus: 'todo' })
  expect(await service.grantTaskLease(n.id, 's1')).toBe('granted')
  expect((await service.list().find((x) => x.id === n.id))!.lane?.status).toBe('running')
  expect(await service.grantTaskLease(n.id, 's2')).toBe('busy')
  expect(await service.revokeTaskLease(n.id)).toBe(true)
  expect(await service.revokeTaskLease(n.id)).toBe(false)
  expect(await service.grantTaskLease(n.id, 's3')).toBe('granted')
})
it('手动 update lane.status 撤销租约；归档与删除同样撤销', async () => { /* … */ })
```

- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现** — 按 Interfaces；revoke 只删 lease，**不改** lane（状态由调用方决定）。grant 内 beginRun 用 `beginRun(laneOrMake, now)`。注意 `update` 的「撤销条件」：patch.lane?.status 存在且 ≠ 当前状态，或 patch.archived === true；delete 在 `table.delete` 前撤销。
- [ ] **Step 4: 运行通过。**
- [ ] **Step 5: Commit** — `feat(notes): taskLeases 租约表 + 手动变更即接管`

---

### Task 5: Agent 工具：notes_task_set_status / notes_task_report + guard

**Files:**
- Modify: `src/agent/tools.ts`
- Test: `tests/agent-tools.test.ts`

**Interfaces:**
- Consumes: Task4 `grantTaskLease` 语义（run 帧）、Task2 lane 读透出。
- Produces：工具 `notes_task_set_status(note_id, status)`、`notes_task_report(note_id, ok, summary)`；`isNotesTaskTool(name)`；guard 函数 `notesTaskGuard(ctx, exec): string | undefined`（同步拒绝原因）。

- [ ] **Step 1: 先查证再写测试**：读 node_modules 里 `@deepseek-ai/dsh-tools` 的 `ToolExecution` 类型声明，确认是否带会话/agent 身份字段（如 `sessionId`/`agentId`/`meta`）。**结论记录到本任务 commit message**：有 → guard 匹配 `lease.sessionId`；无 → guard 降级为「仅查 active lease 存在」并注释原因（explosion radius 已由单 note 限制兜底）。此后测试按该结论写。
- [ ] **Step 2: 失败测试**（agent-tools.test.ts 追加；以“有 session 字段”为例，无则去掉 sessionId 断言）：

```ts
it('notes_task_set_status 在无租约/会话不符时被 guard 拒绝；有租约放行', async () => {
  // 组装宿主 ctx（复用现测试的 notes 服务装配），user note 带 lane=todo
  // grantTaskLease(noteId,'s1') → set_status(noteId,'running') 经 pre-execute+guard 通过且 lane 变 running
  // revokeTaskLease → set_status 再调被拒（返回拒绝原因文本）
})
it('notes_task_report 收尾写 run 并撤销租约；不可用于无 lane 便签', async () => { /* … */ })
```

- [ ] **Step 3: 实现** — 注册两个新工具（description 里内嵌协议：开始置 running、完成 report、失败 report ok:false；**不**加入 WRITE_TOOLS 的 ask 集合，pre-execute 对 `notes_task_*` 直接 `next()`）；guard：目标无 lane / 无 active lease（或会话不符）→ 返回中文原因。report 的 execute 内：`settleRun` + status 置 done/failed + `revokeTaskLease`。
- [ ] **Step 4: 运行通过**（含既有 agent-tools 全绿 —— 读输出加了 lane 字段，schema 用例若断言 exact 需同步补）。
- [ ] **Step 5: Commit** — `feat(notes): notes_task_set_status/report 窄权限工具（租约 guard，无 ask）`

---

### Task 6: 执行事务：taskExecute / taskReset（host 投递会话）

**Files:**
- Create: `src/agent/task-dispatch.ts`（可选薄层；亦可并入 service —— 二选一，以下按并入 service 写）
- Modify: `src/service.ts`（`taskExecute`/`taskReset` + config.dispatch 注入）
- Modify: `src/index.ts`（装配时把 ctx.sessionController 的 prompt 能力接成 dispatch）
- Test: `tests/service.test.ts`, `tests/agent-bridge-mount.test.ts`

**Interfaces:**
- Consumes: Task4 lease 方法。
- Produces：
  - `NotesServiceConfig.dispatch?: (ctxArg: { noteId; title; sessionId }) => Promise<void>`；
  - `NotesService.taskExecute(id, sessionId)` → `{ ok: true; note } | { ok: false; reason: 'missing' | 'busy' | 'no-dispatch' | 'dispatch-failed' }`（成功路径 = grant + running 已在 Task4；dispatch 抛错则回滚：revoke + 恢复原 lane（先快照原 lane，失败后写回）；**无 dispatch 实现时直接回滚返回 no-dispatch**）；
  - `NotesService.taskReset(id)` → `{ ok: true; note } | { ok: false }`：撤销租约 + settleRun(ok:false, '用户手动接管') + status→'todo'。
  - remote 端点 `notes/taskExecute`、`notes/taskReset`（wire 名 = 形参名 `id`/`sessionId`）。
- 投递消息模板（agent-readable；note:// mention 复用 `formatNoteMention`）：

```
【任务执行】请执行便签 @[标题](note://<id>) 中描述的任务。
步骤：1) notes_get 读全文（含 lane.run.summary 上次结论，如有）；2) 若未 running，notes_task_set_status 置 running；
3) 执行；4) 收尾 notes_task_report：成功 ok=true + 摘要，失败 ok=false + 原因。
只允许操作该任务的 lane 状态与结果，不得修改正文/标题/颜色。
```

- [ ] **Step 1: 查证**：读 `D:\codes\deepseek-harness\packages\api\session-controller\src\agent.ts`（只读参考）确认「向已存在会话投 prompt」的公开方法签名与 queue 模式参数；连同 `packages/api/session-controller/src/client/contract/session.ts` 的 client 侧形态一并记录。失败上限：找不到 → 本任务改为「dispatch 由宿主侧后续补洞」，`taskExecute` 返回 no-dispatch 并保证回滚干净（UI 侧给出明确提示文案），把查证结论写进 commit。
- [ ] **Step 2: 失败测试**（service.test：注入 fake dispatch）

```ts
it('taskExecute 成功=租约+投递；dispatch 抛错回滚原状态', async () => {
  const n = await service.create({ text: 't', laneStatus: 'todo' })
  const calls: string[] = []
  const s = withDispatch(service, async () => { calls.push('d') }) // 测试内重建带 dispatch 的 service
  const r1 = await s.taskExecute(n.id, 'sess1')
  expect(r1.ok).toBe(true)
  expect(calls).toEqual(['d'])
  expect(await s.taskExecute(n.id, 'sess1')).toMatchObject({ ok: false, reason: 'busy' })
  await s.taskReset(n.id)
  const r2 = await s.taskExecute(n.id, 'sess2') // 第二个 service 里 dispatch 抛错
  expect(r2).toMatchObject({ ok: false, reason: 'dispatch-failed' })
  expect(s.list().find((x) => x.id === n.id)!.lane?.status).toBe('todo') // 回滚
})
it('taskReset 撤销租约并回待办 + 收尾 run', async () => { /* … */ })
```

- [ ] **Step 3: 实现** — 按 Interfaces。`taskExecute` 快照原 lane → 调 grant（非 granted 按 reason 返回）→ `await dispatch(...)` → 成功返回；catch → 回滚（revoke + `update(id,{ lane: 原lane })`，注意 update 会触发手动接管 revoke —— 幂等无碍）→ 返回 dispatch-failed。taskReset 按接口。
- [ ] **Step 4: 运行通过。**
- [ ] **Step 5: Commit** — `feat(notes): taskExecute/taskReset 执行事务（含回滚；dispatch 注入点）`

---

### Task 7: 远端 + UI：执行/重置按钮与 running 视觉、列头新建任务、轮询加速

**Files:**
- Modify: `src/client/core/notes-remote.ts`（taskExecute/taskReset descriptors + codec + NotesRemote 接口）
- Modify: `src/client/views/board-view.tsx`
- Modify: `src/client/components/task-lanes.tsx`
- Modify: `src/client/components/task-lane-card.tsx`
- Modify: `src/client/views/board-main.tsx`
- Test: `tests/remote.test.ts`, `tests/task-lanes-view.test.tsx`

**Interfaces:**
- Consumes: Task6 host 端点、Task3 分组。
- Produces：
  - `BoardMain` props 增加 `onExecute(note, sessionId)`、`onReset(note)`、`onCreateTask(status)`；
  - `TaskLanes` props 增加同名前缀回调 + `runningNoteIds`（或由卡片自判 `isRunOpen`）；
  - 卡片执行入口规则：非 running 显示「执行/重跑」（hover，主按钮）；running（`isRunOpen`）常驻 spinner + 相对 `run.startedAt` 的已耗时（每秒重渲染可用轻量 interval 或仅展示 `Math.max(0, Date.now()-startedAt)` 文本由 1s timer 驱动）；running 卡 hover「重置为待办」；
  - 已完成/失败卡摘要区显示 `run.summary` 单行截断（title 属性给全文）；
  - running 且 elapsed > 30min 时弱提示「执行可能已中断，可重置」；
  - 每列 header 尾部「＋」按钮 = `onCreateTask(lane.status)`；
  - board-view：把执行/重置接到 `notes.taskExecute/taskReset`；sessionId 来源按 Task6 Step1 查证结论（会话作用域不可得时 v1 传空串并给 host 注入口，UI 错误提示含「执行需要便签板所在会话」文案）；轮询：`refresh(true)` interval 在 `notes.some((n) => n.lane && n.lane.status === 'running' && !n.lane.run?.finishedAt)` 时 1500ms、否则 5000ms（effect 依赖重算）。
- [ ] **Step 1: 失败测试**（remote.test：taskExecute 描述符存在且往返；task-lanes-view.test.tsx：渲染带 lane 的记录；无 lane 不渲染；running 卡有重置入口、done 卡有 summary 文本）
- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现** — 按 Interfaces。task-lane-card 增加 Play/RefreshCw/Undo2 图标按钮（样式沿用 `.fs-lane-actions` 模式，busy 禁用）；running 视觉用 `fs-lane-running` 边框类（`LANE_CARD_CSS` 里加 `box-shadow` 强调）；elapsed 用 1s `setInterval` + state（组件卸载清理）。
- [ ] **Step 4: 运行通过**（全量 test + typecheck）。
- [ ] **Step 5: Commit** — `feat(notes): 泳道执行/重置交互 + running 视觉 + 轮询加速`

---

### Task 8: 编辑器任务开关 + 结果区；列头新建入口接线；帮助文案

**Files:**
- Modify: `src/client/components/note-editor.tsx`
- Modify: `src/client/views/editor-page-dialog.tsx`
- Modify: `src/client/views/board-view.tsx`（saveDraft/onCreateTask）
- Modify: `src/client/components/task-lanes.tsx`（列头「＋」已加，此处补 board-main 到 view 的回调贯通）
- Modify: `src/client/core/help-content.ts` / `notes-help-dialog.tsx`（泳道说明更新，如存在）
- Test: `tests/task-lanes-view.test.tsx`, `tests/help-content.test.ts`（如有），必要时 `tests/agent-bridge-mount.test.ts`

**Interfaces:**
- Consumes: Task1 类型、Task3 语义、Task7 回贯通。
- Produces：
  - `NoteEditorProps` 增加 `initialLane?: NoteLane`（编辑态带出）、`onSave(title, body, color, lanePatch: { on: boolean; status: TaskStatus })`——**签名变更，全调用点同步**；
  - `EditorPageDialog` 透传同款 onSave；
  - `saveDraft`：create → `notes.create({ ..., laneStatus })`；edit → `notes.update(id, { ..., lane: on ? { status } : ??? })`——取消任务 = 需要「删除 lane」语义。实现：update patch 加 `lane: { status } | { remove: true }`? 避免歧义，改约定：**取消任务 = `notes.update(id, { lane: { status } })` 不行**——补接口 `lane?: { status?; run?; clear?: true }`（Task2 的 lane patch 扩展：`clear: true` → `next.lane = undefined`），Task2 未含 clear 时在本任务回补并加 domain/service/remote codec 测试（**必须**回补测试，不静默扩 schema）。
  - 只读「任务与结果」区：编辑已有任务（`initialLane` 非空）时，正文下方渲染当前状态 + run（startedAt/finishedAt/ok/summary 全文）只读卡；开关 UI：footer 附近一行「设为任务」checkbox + 状态 select（新建默认待办；编辑时当前状态预选，running 时只读并提示「执行中，改状态请先在泳道重置」）。
- [ ] **Step 1: 先补 lane.clear 测试**（service/remote/domain，红）→ 实现 clear 语义 → 绿（独立小步，可并入本任务 Step1-3）。
- [ ] **Step 2–4: 失败测试 → 实现 → 全绿**（编辑器交互测试以现有测试风格为准：无 DOM 强依赖时以纯函数/接口断言为主，组件渲染走 task-lanes-view 模式的最小用例）。
- [ ] **Step 5: Commit** — `feat(notes): 编辑器任务开关/取消 + 只读结果区 + 泳道新建任务`

---

### Task 9: 收尾：help 文案、README、全量验证

**Files:**
- Modify: `README.md`, `src/client/core/help-content.ts`
- Test: 全量

- [ ] **Step 1:** 更新 README「任务泳道」与「Agent harness 联动」小节（五列 + lane 对象 + 租约 + 两新工具 + 执行交互）；help 弹窗泳道文案同步。
- [ ] **Step 2:** `pnpm --filter @forge-studio/dsh-plugin-notes test` 全绿 + typecheck。
- [ ] **Step 3: Commit** — `docs(notes): 泳道 × AI 执行 README 与帮助文案`
- [ ] **Step 4:** 本 plan 全部任务完成标记；运行 `pnpm --filter @forge-studio/dsh-plugin-notes build` 验证构建产物正常后，请求代码评审。

## 风险与回退（执行时对照）

- **sessionId 不可得 / dispatch 无宿主实现** → taskExecute 返回 no-dispatch 且 UI 明示（T6/T7 有查证步骤；不阻塞其余层落地）。
- **ToolExecution 无会话身份** → guard 降级为仅 lease 存在性（T5 Step1 已处理）。
- **编辑态 running 便签** → 状态控件只读，指引泳道重置（T8）。
- 手动拖列在泳道（T3 起）即手动接管（Task4 update 钩子覆盖）——T7 卡片若保留拖拽需复核 update 触发 revoke 的提示语义（guard 拒绝后 agent 在会话内看到原因文案）。
