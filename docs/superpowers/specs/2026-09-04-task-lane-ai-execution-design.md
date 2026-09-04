# 任务泳道 × AI 执行 设计（2026-09-04）

> 状态：brainstorm 收敛稿，待用户 review。
> 主题：泳道数据模型去耦（颜色 ≠ 状态）+「泳道点执行 → 会话内 AI 执行 → 自动改状态/落结果」。
> 范围：packages/plugin-notes 内部自包含，不改 harness。

## 1. 背景与问题

现有任务泳道 = 五列看板（待规划→待办→进行中→已完成→已失败），**纸色即任务状态**
（`note.color` 是唯一真相，无独立状态字段）。两个病根：

1. **纸色双重占用**：`color` 在纸卡墙/列表是自由分类色（Win11 便签语义、按色筛选），
   在泳道里被重解释为任务状态 → 新建便签默认黄 = 自动「待办」；分类标绿 = 变「已完成」；
   紫色为泳道牺牲（色板六→五）。
2. **任务无身份与生命周期落点**：便签是不是任务、有没有在执行、结果在哪，schema 无字段；
   「AI 执行并自动改状态」目前只有意图，无机制、无授权通道、无监控。

## 2. 目标 / 非目标

目标：

- 泳道与颜色彻底解耦：普通便签自由用色；**只有显式标记的任务进泳道**。
- 泳道卡「执行」→ 投递结构化任务消息进当前会话 → 会话 agent 用窄权限工具推进状态、
  落结果 → 泳道实时刷新；**点击执行即一次性授权**，过程无逐次审批弹窗。
- 用户永远一票否决：任何手动改状态撤销 AI 租约。

非目标（迭代外）：

- headless 后台 agent run（后续迭代）。
- 泳道内「停止会话」按钮（中断 agent 去会话里做）。
- 多任务队列 / 执行历史审计 / 执行中断的自动判定（由用户一键接管兜底）。

## 3. 决策记录

已与用户对齐（问答收敛）：

| # | 决策 |
|---|------|
| D1 | 任务身份 = **显式标记**；`lane` 对象存在即任务，普通便签不进泳道 |
| D2 | 执行形态 = **借道会话**（过程可见、可打断），headless 后置 |
| D3 | 任务数据 = 便签内嵌 **`lane: { status, run? }` 对象**（结果不污染正文） |
| D4 | 授权 = **执行租约（lease）**：点击执行即授权，窄权限工具 + guard，无逐次弹窗 |
| D5 | **手动改动即接管**：任何用户手动状态变更 → 撤销租约 |

本稿默认值（写入供 review，标注「默认」可改）：

| # | 默认决策 |
|---|----------|
| M1 | 色板恢复 **六色**（黄/蓝/绿/粉/紫/灰），紫色回归自由分类；存量紫已在读取层归一为灰，无需迁移 |
| M2 | 转任务入口：编辑器内「设为任务/取消任务」开关 + 泳道列头「＋新建任务」；grid/list 卡片不另加入口 |
| M3 | 手动接管统一收尾 run：`finishedAt/ok:false` + summary「用户手动接管」；状态以用户拖放结果为准 |
| M4 | 结果展示：编辑器只读「任务与结果」区 + 泳道 done/failed 卡首行摘要 |
| M5 | 投递消息自带执行协议说明（agent-readable），不新增 systemPrompt 分区 |
| M6 | 状态序列不硬性校验（agent 可直接置 failed 等），协议层引导；guard 只管身份与租约 |

## 4. 数据模型

```ts
// types.ts —— NoteRecord 追加可选字段（不存在 = 普通便签）
interface NoteLane {
  status: TaskStatus                       // 'backlog' | 'todo' | 'running' | 'done' | 'failed'
  run?: {
    startedAt: number                      // 本次执行开始（建租约时由宿主写）
    finishedAt?: number                    // report / 手动接管时补
    ok?: boolean                           // report 的 ok；手动接管 = false
    summary?: string                       // AI 结果摘要（markdown，短）或接管说明
  }
}

interface NoteRecord {
  // …现有字段不变…
  lane?: NoteLane                          // 新增，缺省 undefined
}
```

- 状态枚举沿用 dsh-task-board 五状态（稳定 id），与旧 `TaskStatus` 一致。
- `NoteUpdateInput` 增加 `lane?: { status?, run? }` 的 patch 形状（partial）；
  `NoteCreateInput` 增加可选 `laneStatus`（列头「＋新建任务」用）。
- **迁移**：`lane` 可选字段，旧记录天然兼容，domain schema（domain.ts）补可选校验即可；
  不回填默认值（无 lane = 非任务）。
- 颜色语义回归：`NOTE_COLORS` 恢复六色；**删除** `colorForStatus/statusForColor` 的
  状态映射用法，`core/task-lanes.ts` 重写为「按 `note.lane.status` 分列」，颜色只是卡片底色。
  （旧的灰→待规划等映射全部移除；纸卡墙/列表色筛恢复正常六色多选。）

## 5. 授权：执行租约（lease）

新增插件自有域 `taskLeases`（storage-domain，与 notes 域并列），记录：

```ts
interface TaskLease {
  noteId: NoteId
  sessionId: string        // 执行会话标识（发起的会话）
  grantedAt: number
  state: 'active'          // 只有 active；结束即删除（无状态机）
}
```

- **创建**：泳道卡「执行」→ host `grantTaskLease(noteId, sessionId)`：
  若该 note 已有 active lease → 拒绝（防双跑）；否则写 lease + 置
  `lane.status='running'`；`lane.run` 不存在则建 `{ startedAt }`（ok/finishedAt 缺省，
  仅在 report 或接管时填布尔/时间）。
- **撤销**（任一即删 lease）：
  - agent `notes_task_report` 收尾成功；
  - 用户手动改该任务状态（UI 拖列 / 编辑器改状态 / 「重置为待办」）；
  - note 删除 / 归档。
- lease 存于插件 storage（重启不丢，保证手动接管前 guard 语义一致）；UI 无执行会话活性
  信息，running 卡「可能已中断」提示为纯耗时启发式（见 §7）。

### 授权链

- 点「执行」是一次显式用户动作 = 一次性授权（D4）：不弹 per-call approval。
- 授权粒度 = **该 note 的 lane 对象**：agent 永远碰不到 title/text/color/pinned/archived
  （这些仍走既有 notes_update + ask/guard 链）；爆炸半径 = 一张便签的状态与结果。
- 工具层 guard（单调，所有宿主生效）：
  - 目标 note 无 `lane` → 拒绝；
  - 无对应 active lease 或 lease.sessionId ≠ 调用会话 → 拒绝（手动接管后 agent 静默失效）；
  - pre-execute **不放 ask**（`notes_task_*` 不在 WRITE_TOOLS ask 集合）。

## 6. Agent 工具契约（src/agent/tools.ts 扩展）

新增两个窄权限工具（复用 notes_task_ 前缀，独立于 notes_* 写工具集合）：

| 工具 | 参数 | 行为 | guard |
|---|---|---|---|
| `notes_task_set_status` | `note_id, status` | 置 `lane.status`；若置 running 且无 run，宿主补 run 初始帧 | 须有匹配 lease 才放行；`notes_task_report` 前 agent 用它置 running |
| `notes_task_report` | `note_id, ok, summary` | 写 `run.finishedAt/ok/summary`，status 置 done/failed，随后**撤销 lease** | 同上 |

- 读侧：`notes_list` / `notes_get` 输出 schema 追加 `lane`（含 `run.summary`，**供重试时
  读取上次结论**）；`noteText` 渲染标注状态（如 `[task · running]`）。
- 协议以工具 description 内嵌说明（M5）：开始 → `set_status(running)`；完成 →
  `report(ok:true, summary)`；无法完成 → `report(ok:false, summary)`。不新增 systemPrompt 分区。

## 7. 交互（泳道视图）

泳道仍五列；**列成员资格 = `lane.status`**。卡片纸色 = 用户自由色（不再表状态）；
列头状态点改为**列语义徽标**（非纸色提示）。

### 卡片状态机

| 卡片态 | 条件 | 视觉/动作 |
|---|---|---|
| 空闲 | 非 running | hover 出现主按钮「执行」（done/failed 显示为「重跑」）|
| 执行中 | `lane.status==='running'` | 常驻 spinner + 已耗时（`startedAt` 起算）；hover「重置为待办」；若 elapsed 超过阈值（默认 30min，启发式），追加弱提示「执行可能已中断，可重置」—— UI 无法可靠判定执行会话活性，不自动判定僵尸，全靠用户一键接管 |
| 完成/失败 | done/failed | 摘要区显示 `run.summary` 首行；hover「重跑」|

- **执行** = host 侧一条事务：`grantTaskLease` → 置 running/run → **投递任务消息**（§8）。
- **重跑** = 同执行（新 run 帧覆盖旧 run；attempt 不加，YAGNI）。
- **重置为待办 / 手动拖列**（手动接管，D5/M3）：撤销 lease；若 run 未收尾，宿主补
  `finishedAt/ok:false/summary:'用户手动接管'`；状态 = 用户动作的结果（重置→todo，
  拖到 done 就是 done）。
- 结果详情：编辑器只读「任务与结果」区（status/run 各字段 + summary 全文），M4。

### 入口（M2）

- 编辑器：任务开关（设/取消任务 + 初始状态选择，默认待办）。
- 泳道列头：「＋」新建任务 = `notes.create` + 初始 `lane.status` = 该列状态。
- grid/list 视图中任务卡给轻量状态点（可选显示，默认不加，防噪音）。

## 8. 投递协议（缝 1 结论：host 侧 ctx.sessionController）

- 宿主已装配 `ctx.sessionController`（namespace `session`，web 会话 UI 同款通道）。
  泳道「执行」由 **host 侧服务**对**当前会话**（承载本便签板的会话）提交 prompt。
- 投递消息模板（自带协议，agent-readable，M5）：

  ```text
  【任务执行】请执行便签 @[标题](note://<id>) 中描述的任务。
  步骤：1) notes_get 读全文（含 lane.run.summary 上次结论，如有）；2) notes_task_set_status
  置 running（如未置）；3) 执行；4) notes_task_report 收尾：成功 ok=true + 摘要，失败 ok=false + 原因。
  不得修改便签正文/标题/颜色，只允许操作该任务的 lane 状态与结果。
  ```

- **投递模式**：会话忙时 prompt 有 queue/steering 语义。默认选普通排队（与 UI 一致，
  泳道卡停在 running 且会话队列可见）；steering（打断当前任务）默认不用。
- 失败处理：投递本身失败（无目标会话/不可达）→ 回滚本次执行事务（撤销刚建的 lease，
  status 回到原值）并在 UI 提示「需要先在会话里打开便签板」。
- **实现期验证点**（标注，非阻塞）：prompt 提交的确切方法签名与参数（agent.ts /
  control.ts 内核对，UI 有现成调用用例）；若 host 直调不便，备选 client 侧
  `ctx.remote.session`（需 gateway 权限/描述符验证）——二选一，协议不变。

## 9. 自动刷新（缝 3 结论：加速既有轮询）

- notes/* 无推送，但 board-view **已内置 open 时每 5s 轮询** `notes.list()`（host 内存
  同步读，代价可忽略）—— agent 改状态后 ≤5s 内泳道可见。
- 增强：面板内存在「运行中任务」（`lane.status==='running'` 且 `run.finishedAt` 缺省）
  时轮询间隔降到 ~1.5s，结束后恢复 5s；其余时间不额外开通道。

## 10. 错误处理与边界

- 双跑防护：`grantTaskLease` 对已有 active lease 拒绝（幂等返回冲突，UI 禁点）。
- 手动接管 vs agent 写入竞态：工具 guard 读 lease 用宿主内存同步态，撤销后 agent
  下一次调用即失败（错误信息引导「任务已被手动接管，如需继续请重新执行」）。
- note 删除/归档：宿主在 notes service 删除/归档钩子中撤销其 lease（若有）。
- 归档便签不进泳道（沿用现状语义）；取消任务 = 删除 lane 字段（编辑器开关），不删便签。

## 11. 测试

- 纯函数：lane 分组按 `lane.status`（替换按 color）；run 帧补全/接管收尾；lease guard
  判定（无 lane / 无 lease / 会话不匹配 / 放行）—— tests/ 迁移 + 新增。
- 服务：create/update 对 lane 的 codec 与迁移；grant/revoke lease 状态机。
- agent 工具：schema 扩展（lane 读透出）、write guard 拒绝路径。
- 视图：泳道按 lane.status 分列渲染（旧 color 用例改写）；卡片态（执行中/僵尸/接管）。

## 12. 实现前验证点清单（spike 遗留）

1. ctx.sessionController prompt 提交签名与 queue 模式参数（或改走 client remote，二选一）。
2. 插件 host 侧如何拿到「当前承载便签板的会话 id」（session-scoped 解析；panel-mount
   中间列已按会话挂载，取 id 即可）。
3. 宿主重启后 lease 持久化字段无问题（storage-domain 常态，仅确认）。

## 13. 落地顺序建议（后续 writing-plans 细化）

1. 数据层：lane 字段 + 六色恢复 + core/task-lanes 按 status 重写 + 迁移/测试。
2. 服务层：lane patch、grant/revoke lease、create laneStatus、删除/归档钩子。
3. agent 层：notes_task_set_status/report + guard + 读透出扩展。
4. 视图层：泳道按 lane.status + 卡片状态机 + 编辑器任务开关/结果区 + 新建入口。
5. 投递与刷新：host 投递事务 + 轮询 subscribe + 失败回滚。
