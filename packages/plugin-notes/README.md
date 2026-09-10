# @zzerx/dsh-plugin-notes

dsh 便签插件：**独立便签板 UI**（侧栏入口 + 中间列面板，
显示形式对齐 dsh-task-board），host 侧作为数据后端（storage-domain）与设置源，
同时把便签 CRUD **联动到 agent harness**（工具化 + 权限边界 + 执行租约）。

## 能力

- **host**
  - `ctx.notes` 服务（storage-domain 持久化，`notes` 域，per-record 布局，
    记录带 `origin: 'user' | 'agent'` 来源标记，旧记录 schema 缺省回填 `user`）
  - 经 Typert Gateway 以 SRC 模式暴露 `notes/*` 端点，client 直连读写
  - 设置命名空间 `forge-studio-notes`（`defaultTitle`）
  - **agent 桥（条件挂载，见 `src/agent/`）**：宿主装配 `tools`/`systemPrompt`
    时自动生效，无 agent 装配的宿主（纯 UI 数据后端）照常工作
- **client**
  - 侧栏 DOM 入口行（新建会话按钮与工作区浏览器之间，MutationObserver 自愈，
    折叠 rail 只显图标）：开/关便签板
  - 便签板面板（中间列接管，`<html>` data 属性开关，会话子树保持挂载）：
    **三种显示模式**切换（纸卡墙 / 行式列表 / 任务泳道，选择记忆在模块级
    store，开关浮层不丢）：
    - **grid 纸卡墙 / list 行式列表**（Win11 便签式**六色**纸卡，置顶优先）：
      双视图共用 **文字搜索**（标题+正文纯文本，实时过滤）+ **按颜色多选筛选**
      （只作用于活动区）+ 底部**归档折叠区**（默认收起，展开才渲染）；列表
      **懒加载**：首批 16 条，滚动触底分批展开（底部哨兵进入视口自动续批，另有「加载更多」入口；活动区优先，归档区展开后同样
      分批），全部便签最终可见
    - **任务泳道**（五列状态看板，布局对齐 dsh-task-board 待规划→待办→进行中
      →已完成→已失败）：按 `note.lane.status` 分列，**颜色不再表状态**（六色
      仅为纸色；任务身份 = 便签内嵌 `lane` 对象，存在即任务，普通便签不进泳道），
      **跨列拖拽即换状态**（等价写入 `lane.status`，列表/纸卡墙/编辑器同步可见），
      活动任务按列全量渲染、列内滚动；色筛行隐藏（列本身已按状态分列）、搜索
      仍可用；归档便签不进泳道，底部提示行一键切回列表管理
    - **泳道任务执行（AI 联动）**：非 running 卡 hover「执行」（done/failed 为
      「重跑」）→ 一次性授权当前会话 AI 执行任务（读全文 → 置 running → 干活 →
      落结果），running 卡常驻 spinner + 已耗时、hover「重置为待办」（超 30min
      弱提示「执行可能已中断，可重置」）；结果写回 run.summary，卡片首行摘要 +
      编辑器只读「任务与结果」区全文；手动改状态/取消任务即收回授权（接管）
  - 便签可**归档**：归档后移出活动区、折叠在列表底部，可恢复/编辑/删除
  - 正文以 Markdown 存储：格式操作栏（加粗/标题/列表/引用/代码/撤销重做），
    `Ctrl+Enter` 保存；卡片展示 Markdown 摘要
  - 编辑器内直接 **Ctrl+V 粘贴图片**（剪贴板图片 → data URL 内联进正文 Markdown）
  - **便签板设置弹窗**（header 齿轮）：编辑默认标题，直接读写命名空间 scope，
    不再占用插件设置页
  - client 结构：`views/`（页面：面板主体/列表与编辑器弹窗）、`components/`
    （复用组件：纸卡/行/色筛/搜索与归档折叠/设置弹窗/编辑器等）、`core/`
    （状态/远程通道/纯函数/工具 + `sidebar-entry` 侧栏入口行 / `panel-mount`
    中间列接管）；列表页常驻，编辑器/设置弹窗叠加其上，开关走 `notes-nav`
    浮层层状态（互斥、跨开关保留）

## Agent harness 联动（设计）

三条联动线，全部插件内自包含（不改 harness）：

1. **工具化**（`src/agent/tools.ts`）：8 个 `notes_*` 工具注册到 `ctx.tools`，
   宿主有 `tools` 服务时生效：
   - 读：`notes_list`（摘要列表）、`notes_get`（全文）；
   - 写：`notes_create` / `notes_update` / `notes_set_pinned` / `notes_delete`；
   - 任务：`notes_task_set_status`（置状态）/ `notes_task_report`（收尾写结果），
     窄权限、无 ask，仅泳道「执行」授权后可用（lease guard 兜底）。
   - agent 创建的便签标记 `origin='agent'`；UI/用户创建才是 `origin='user'`。
2. **权限边界**（工具注册时的两层守卫，见下）。
3. **执行租约（lease）**（`src/service.ts` + `src/agent/task-dispatch.ts`）：
   泳道卡「执行」由 host 服务 `taskExecute` 一次性授予该任务 lease（绑定发起
   会话），并投递结构化任务消息进当前会话；agent 经 `notes_task_set_status`
   置 running → 执行 → `notes_task_report` 收尾写 run + 撤销 lease；guard 校验
   租约存在且与调用会话一致。手动改状态/取消任务即撤销 lease（接管），agent
   后续调用被拒（无 lease / 会话不符）。

### 写操作审批与 guard

- **pre-execute ask**：宿主装有 approval seam（`ctx.get('approval')`）时，
  `notes_create/update/set_pinned/delete` 在 `tools/pre-execute` 返回
  `{ kind: 'ask' }`，由 user-approval 弹确认后才执行（未批准即拒绝，
  fail-closed）。宿主无 approval seam 时放行（无 policy 即 unconditional，
  与 tool-fs 同款）。读工具从不 ask；任务工具（`notes_task_*`）也不 ask
  （点击执行即一次性授权，guard 兜底）。
- **guard（单调拒绝）**：agent 永远不能删除 `origin='user'` 的便签 —— 即便
  pre-execute 放行/ask 批准，guard 层仍拒绝（保护用户手写内容）；agent 只能
  删除自己（`origin='agent'`）创建的便签。`update` 不改写 origin（来源一经
  创建不可变）。
- **任务 guard（单调拒绝）**：`notes_task_*` 仅在目标便签是任务、且持有与
  调用会话一致的 active lease 时才放行；无 lane / 无 lease / 会话不符一律
  拒绝（fail-closed）。

### 集成点清单（brainstorm 结论）

| # | 集成点 | 落地状态 |
|---|--------|----------|
| 1 | 工具化：agent 会话内读写便签 | ✅ `notes_*` 8 工具（含 2 任务工具） |
| 8 | 权限边界：origin 字段 + ask/guard 双层 | ✅ 记录带 origin、写操作 ask、guard 拒绝删 user 便签 |

## 安装

```bash
dsh plugin --profile <你的profile名> add @zzerx/dsh-plugin-notes
```

## 开发

```bash
pnpm --filter @zzerx/dsh-plugin-notes typecheck   # tsc --noEmit
pnpm --filter @zzerx/dsh-plugin-notes test        # vitest
pnpm --filter @zzerx/dsh-plugin-notes build       # lib/index.js + lib/client.js + lib/types
```

依赖只指向 Service Definition 包；client 对跨插件值一律 type-only import
（`scripts/build.mjs` 把 `dsh.client.inject` 声明的平台包外部化，避免注册表重复实例化）。
