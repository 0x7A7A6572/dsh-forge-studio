# dsh-desk-studio 设计文档

> **一句话目标**：用 DeepSeek Harness（dsh）的 "Everything is a Plugin" 范式，把 Forge Studio 桌面工具箱改造成一组可发布到 dsh 生态的插件包，亲身体验"应用以 dsh 形式开发"。

**日期**：2026-08-31
**状态**：设计批准，待实现
**参考**：https://github.com/deepseek-ai/deepseek-harness

---

## 1. 背景与北极星

### 1.1 背景

Forge Studio（`D:\codes\ForgeStudio`）是一个 Electron + Vue 3 + TypeScript + Python 的桌面工具箱应用，含便签、天气、翻译、提醒、定时任务、截图、贴图、窗口收纳、AI 对话/RAG 等功能。其架构已是"Domain 工厂模式"（每个 domain 是独立模块，ESLint 域隔离）。

dsh（DeepSeek Harness）以 "Everything is a Plugin" 架构（底层为 Cordis）走红。用户想用 dsh 形式重造一个项目，**体验"以后的应用都用 dsh 形式开发"是什么概念**。

### 1.2 北极星决策（已确认）

| 决策 | 结论 | 理由 |
|---|---|---|
| 仿 cordis 自建应用 vs 做真 dsh 插件 | **做真 dsh 插件** | 北极星是体验 dsh 范式，不是再造一个 dsh |
| UI 技术栈 | **React**（dsh Web UI 是 React，ConversationNodeDefinition renderer 是 React 组件） | 官方规定，接受 |
| 范式转变 | **dsh 插件 + 自定义 UI 节点** | 功能 = agent 能力（工具/服务）+ 对话流可视化节点 |
| 开发环境 | **本机能跑 dsh**（Node 24.19 / pnpm 11.17 已确认） | 实操为主 |
| 首期范围 | **F1-F5 + F7**（便签/天气/翻译/提醒/定时任务/设置）；F6 dashboard 聚合节点放在 M4 | 已确认 |

### 1.3 已排除

- 系统级功能（窗口收纳/截图/贴图/护眼/托盘）：依赖 Electron 系统能力，dsh 插件形态下由 dsh 宿主承担，本期不做
- AI 对话/RAG（Python 后端）：本期不含
- 自建 Cordis 应用壳：已否决

---

## 2. Forge 功能 → dsh 插件映射

每个功能 = 一个独立的 npm 插件包，内部 host/client 双入口。**F7 设置不再单独成插件**，由 dsh 原生 `ctx.settings` seam + 每插件 settings card 吸收。

| 功能 | 插件包名（草案） | host 侧能力（agent 可调用） | client 侧（对话流 UI 节点） |
|---|---|---|---|
| F1 便签 | `@forge-studio/dsh-plugin-notes` | `ctx.notes` 服务 + `notes_create/list/update/delete` 工具 | `note-list` 节点（折叠便签列表） |
| F2 天气 | `@forge-studio/dsh-plugin-weather` | `ctx.weather` 服务（provider seam）+ `weather_now` 工具 | `weather-card` 节点 |
| F3 翻译 | `@forge-studio/dsh-plugin-translator` | `ctx.translator` 服务 + `translate` 工具 | `translate-result` 节点 |
| F4 提醒 | `@forge-studio/dsh-plugin-reminders` | `ctx.reminders` 服务 + `reminder_set/list/cancel` 工具 | `reminder` 节点 |
| F5 定时任务 | `@forge-studio/dsh-plugin-scheduled-tasks` | `ctx.scheduledTasks` 服务 + `task_schedule/list/cancel` 工具 | `task` 节点 |
| F6 工作台（二期聚合） | `@forge-studio/dsh-plugin-dashboard` | 聚合服务 | `dashboard` 节点（聚合卡片） |
| F7 设置 | 并入 dsh settings seam | 每插件 `Config` schema + `installSection` + settings card | 设置面板聚合卡片 |

---

## 3. 技术架构

### 3.1 插件包结构（外部 bundle，dsh.client 双入口）

每个功能插件是独立的 npm 包，可 `dsh plugin --profile <name> add <pkg>` 安装。包结构：

```
packages/dsh-plugin-notes/
├── package.json          # dsh.bundle + dsh.client manifest
├── cordis.patch.yml      # bundle 配置层（插件行，host 侧）
├── tsconfig.json
├── tsdown.config.ts      # 复用 dsh clientBundle 构建约定
├── src/
│   ├── index.ts          # host 入口：{ name, inject, Config, apply }
│   ├── service.ts        # ctx.notes 服务（Service Provider）
│   ├── storage.ts        # 数据存取
│   ├── events.ts         # SessionEventMap 合并 + 事件类型（纯类型导出）
│   ├── tools.ts          # defineTool 工具注册
│   ├── types.ts          # 品牌 id、领域类型
│   └── client/
│       ├── index.ts      # client 入口：注册 ConversationNodeDefinition + settings card
│       ├── note-list-node.ts  # NoteListView React 组件
│       └── settings-card.tsx  # NotesSettingsCard React 组件
└── README.md
```

**package.json 关键字段**：

```json
{
  "name": "@forge-studio/dsh-plugin-notes",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
  },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.2" }
}
```

**依赖原则**：扩展插件只依赖 Service Definition（`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-client-ui-conversation` 等），绝不依赖具体 provider。

### 3.2 四形态能力

**① 工具**（agent 可调用的能力）：

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'notes_create',
  description: 'Create a sticky note.',
  parameters: {
    title: { type: 'string', required: false, description: 'Note title' },
    content: { type: 'string', required: true, description: 'Note content' },
  },
  output: {
    schema: { type: 'object', properties: { id: { type: 'string' } } },
    render: (_args, value) => [{ type: 'text', text: `Note created: ${value.id}` }],
  },
  async execute(args) {
    const note = await ctx.notes.create({ title: args.title, content: args.content })
    return { id: note.id }
  },
}))
```

**② 服务**（Service Definition + Provider）：

```ts
import { Service } from '@deepseek-ai/cordis'

export class NotesService extends Service {
  static inject = ['storage', 'settings']
  constructor(ctx: Context, config: Config) {
    super(ctx, 'notes')
    // ctx.notes 对其他插件可用
  }
  async create(input: NoteInput): Promise<Note> { /* ... */ }
  async list(): Promise<Note[]> { /* ... */ }
  async update(id: NoteId, patch: NotePatch): Promise<Note> { /* ... */ }
  async delete(id: NoteId): Promise<void> { /* ... */ }
}
```

**③ 会话事件**（可回放、UI 与 agent 行为一致的桥梁）：

```ts
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'note/created': { id: NoteId; title: string }
    'note/updated': { id: NoteId; patch: NotePatch }
    'note/deleted': { id: NoteId }
  }
}
```

**核心不变量（来自 dsh）**：模型可见即已记录。工具写入事件，UI 节点从事件流折叠渲染——agent 调用工具 → 事件 → UI 更新，天然一致。

**④ UI 节点**（ConversationNodeDefinition + React renderer）：

```ts
const noteListDefinition: ConversationNodeDefinition<NoteListState> = {
  kind: 'note-list',
  target: 'chat',
  match: (event) => {
    if (event.type === 'note/created' || event.type === 'note/updated' || event.type === 'note/deleted') {
      return { id: 'note-list', role: 'update' }
    }
    return null
  },
  start: (context, match) => { /* 初始折叠 */ },
  update: (context, match) => { /* 增量折叠 */ },
  buildViewNode: (context) => { /* 构造节点 payload */ },
}
```

### 3.3 设置统一机制

不单独做设置插件。每插件通过三层进 dsh 统一设置系统：

1. **Config schema**（Schemastery）：类型 + 校验 + 默认值，`apply(ctx, config)` 拿到校验后配置
2. **Host 注册**：`ctx.inject(['settings'], (s) => s.settings.installSection(ctx, NS, Config, config, {...}))` 装进 `ctx.settings` seam
3. **Client 设置卡片**：`ctx.slots.inject('settings.plugin.item', ...)` 注册卡片，聚合进 dsh 设置面板

统一的是控制机制（`ctx.settings`），不是单一配置文件。插件卸载 → 配置区段 + 卡片一起消失。

---

## 4. 里程碑

| 里程碑 | 内容 | 验证标准 |
|---|---|---|
| **M0 环境+风险验证** | ① 安装 dsh 跑通 `dsh web`；② 最小插件走 `--patch` 加载；③ **验证外部 npm 包贡献 client UI（ConversationNodeDefinition + settings card）是否可行**；④ 若不可行，确定 fallback | `dsh web` 打开、插件日志、UI 节点渲染成功 |
| **M1 便签标杆** | `dsh-plugin-notes` 完整闭环：service + tools + events + UI 节点 + settings card；打包 + 安装 | 对话驱动建/查/改/删便签，UI 节点折叠渲染，设置卡片可用 |
| **M2 天气+翻译** | `dsh-plugin-weather`（provider seam 验证）、`dsh-plugin-translator` | 对话查天气/翻译，天气 provider 可替换 |
| **M3 提醒+定时任务** | `dsh-plugin-reminders`、`dsh-plugin-scheduled-tasks`（schedule 能力） | 对话设定时提醒/任务，到点触发 |
| **M4 聚合+发布** | dashboard 聚合节点、全插件发布到 npm/GitHub + `dsh plugin add` 安装验证、README/文档 | 从零 `dsh plugin add` 安装全部插件可用 |

---

## 5. 风险与决策点

| 风险 | 等级 | 应对 |
|---|---|---|
| **外部 bundle 贡献 client UI 路径未官方确认** | 高 | M0 第一步验证；fallback A：client 包贡献回 dsh 仓库（官方 monorepo 内确认可行）；fallback B：先纯 host（工具/服务）形态，UI 节点后补 |
| dsh 处于 developer preview，破坏性变更 | 中 | 锁定版本（`@deepseek-ai/dsh@0.1.1-rc.2`），升级时单独处理 |
| pnpm registry 为 npmmirror 镜像，`@deepseek-ai/*` 包同步可能延迟 | 低 | 安装失败时切换官方 registry |
| React UI 组件重写工作量（Forge 是 Vue） | 中 | 本期 UI 节点做"折叠展示"级，不做完整编辑器；深度交互后置 |
| 翻译密钥前端安全 | 中 | 用户自填密钥，支持免密钥词典源，README 标注风险 |

---

## 6. 已知边界

- 定时/提醒依赖浏览器环境活跃（dsh 运行时内），Tab 关闭/进程退出即停
- 天气 provider 需 CORS 兼容公开 API（如 wttr.in），经 seam 抽象可换
- 翻译密钥默认放 `ctx.credentials` seam（dsh 提供凭据管理），不硬编码

---

## 7. 成功标准

1. 五个功能插件（F1-F5）可独立安装/卸载，装/卸时其 agent 能力 + UI 节点 + 设置卡片一起出现/消失
2. 用自然语言即可驱动全部功能（建便签、查天气、翻译、设提醒、定时任务）
3. 全部功能可在 dsh 对话流中以可视化节点呈现（此条依赖 M0 外部 bundle 贡献 client UI 的验证结果；若 fallback 为纯 host 形态，UI 节点后置）
4. 插件打包后可发布（npm 或 GitHub），他人可 `dsh plugin add` 安装
