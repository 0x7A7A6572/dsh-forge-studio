# @forge-studio/dsh-plugin-notes

Forge Studio 便签 的 dsh 插件形态：**独立便签板 UI**（侧栏入口 + 中间列面板，
显示形式对齐 dsh-task-board），host 侧作为数据后端（storage-domain）与设置源，
同时把便签 CRUD **联动到 agent harness**（工具化 + 引用化 + 权限边界）。

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
    **行式列表 / grid 纸卡墙**双视图（Win11 便签式
    六色纸卡，置顶优先）切换 + **文字搜索**（标题+正文纯文本，实时过滤）+
    **按颜色多选筛选**（只作用于活动区）+ 底部**归档折叠区**（默认收起，
    展开才渲染）；列表**懒加载**：首批 8 条，滚动触底分批展开（活动区优先，
    归档区展开后同样分批），全部便签最终可见
  - 便签可**归档**：归档后移出活动区、折叠在列表底部，可恢复/编辑/删除
  - 正文以 Markdown 存储：格式操作栏（加粗/标题/列表/引用/代码/撤销重做），
    `Ctrl+Enter` 保存；卡片展示 Markdown 摘要
  - 编辑器内直接 **Ctrl+V 粘贴图片**（剪贴板图片 → data URL 内联进正文 Markdown）
  - **便签板设置弹窗**（header 齿轮）：编辑默认标题，直接读写命名空间 scope，
    不再占用插件设置页
  - 纸卡与行 hover 动作栏带 **引用到会话** 按钮：一键复制
    `@[标题](note://<id>)` mention 到剪贴板（复制成功短暂变 ✓），粘进会话后
    agent 可按引用读取全文
  - client 结构：`views/`（页面：面板主体/列表与编辑器弹窗）、`components/`
    （复用组件：纸卡/行/色筛/搜索与归档折叠/设置弹窗/编辑器等）、`core/`
    （状态/远程通道/纯函数/工具 + `sidebar-entry` 侧栏入口行 / `panel-mount`
    中间列接管）；列表页常驻，编辑器/设置弹窗叠加其上，开关走 `notes-nav`
    浮层层状态（互斥、跨开关保留）

## Agent harness 联动（设计）

三条联动线，全部插件内自包含（不改 harness）：

1. **工具化**（`src/agent/tools.ts`）：6 个 `notes_*` 工具注册到 `ctx.tools`，
   宿主有 `tools` 服务时生效：
   - 读：`notes_list`（摘要列表）、`notes_get`（全文）；
   - 写：`notes_create` / `notes_update` / `notes_set_pinned` / `notes_delete`。
   - agent 创建的便签标记 `origin='agent'`；UI/用户创建才是 `origin='user'`。
2. **引用化**（`src/agent/reference.ts` + client 引用按钮）：会话文本出现
   `@[标题](note://<id>)` 时，系统提示（systemPrompt section）引导 agent 用
   `notes_get` 读取全文再作答；client 卡片/行提供「引用到会话」一键复制按钮。
3. **权限边界**（工具注册时的两层守卫，见下）。

### 写操作审批与 guard

- **pre-execute ask**：宿主装有 approval seam（`ctx.get('approval')`）时，
  `notes_create/update/set_pinned/delete` 在 `tools/pre-execute` 返回
  `{ kind: 'ask' }`，由 user-approval 弹确认后才执行（未批准即拒绝，
  fail-closed）。宿主无 approval seam 时放行（无 policy 即 unconditional，
  与 tool-fs 同款）。读工具从不 ask。
- **guard（单调拒绝）**：agent 永远不能删除 `origin='user'` 的便签 —— 即便
  pre-execute 放行/ask 批准，guard 层仍拒绝（保护用户手写内容）；agent 只能
  删除自己（`origin='agent'`）创建的便签。`update` 不改写 origin（来源一经
  创建不可变）。

### 集成点清单（brainstorm 结论）

| # | 集成点 | 落地状态 |
|---|--------|----------|
| 1 | 工具化：agent 会话内读写便签 | ✅ `notes_*` 6 工具 + systemPrompt 分区 |
| 6 | 引用化：会话 `@便签` mention + 列表「引用到会话」按钮 | ✅ mention 语法 + host 引导 + client 复制按钮 |
| 8 | 权限边界：origin 字段 + ask/guard 双层 | ✅ 记录带 origin、写操作 ask、guard 拒绝删 user 便签 |

## 开发

```bash
pnpm --filter @forge-studio/dsh-plugin-notes typecheck   # tsc --noEmit
pnpm --filter @forge-studio/dsh-plugin-notes test        # vitest
pnpm --filter @forge-studio/dsh-plugin-notes build       # lib/index.js + lib/client.js + lib/types
```

## 安装进 web profile

```bash
pnpm --filter @forge-studio/dsh-plugin-notes build
pnpm dsh -- plugin --profile web add "D:/codes/dsh-desk-studio/packages/plugin-notes"
pnpm dev
```

依赖只指向 Service Definition 包；client 对跨插件值一律 type-only import
（`scripts/build.mjs` 把 `dsh.client.inject` 声明的平台包外部化，避免注册表重复实例化）。
