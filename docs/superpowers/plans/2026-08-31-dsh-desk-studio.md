# dsh-desk-studio 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 DeepSeek Harness (dsh) 的 "Everything is a Plugin" 范式，把 Forge Studio 的 F1-F5 + F7 功能重做为真正可发布到 dsh 生态的 npm 插件包，跑在真实 dsh 运行时上。

**Architecture:** 每个功能一个独立 `@forge-studio/dsh-plugin-*` npm bundle：host 侧贡献 cordis 服务 + agent 工具 + 会话事件（`SessionEventMap` 合并 + `agent.session.append`），client 侧贡献对话流可视化节点（`ConversationNodeDefinition` + keyed renderer slot）+ 设置卡片（`settings.plugin.item` slot）。多个 bundle 聚合进一个 `web` profile 由 `dsh web` 启动，数据统一走 `ctx.storage`（`dsh-storage-json`）。

**Tech Stack:** TypeScript + React (client) + cordis（`@deepseek-ai/cordis`）+ schemastery（设置 schema）+ tsdown clientBundle preset + vitest。运行时锁 `@deepseek-ai/dsh@0.1.1-rc.2`（developer preview）。

**Spec:** [docs/superpowers/specs/2026-08-31-dsh-desk-studio-design.md](../specs/2026-08-31-dsh-desk-studio-design.md)

## Global Constraints

> 从 spec 复制的项目级硬约束。每个任务的要求隐式包含本节。

1. **包命名**：`@forge-studio/dsh-plugin-<name>`（notes/weather/translator/reminders/scheduled-tasks）。
2. **依赖原则**：扩展插件只依赖 Service Definition 包（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-ui-chat`、`@deepseek-ai/dsh-client-ui-settings`、`@deepseek-ai/schemastery`），绝不依赖具体 provider/UI 应用包；client 包对跨插件值一律 **type-only import**（bundle purity 门禁）。跨插件协作只走 cordis 服务。
3. **npm registry 是 npmmirror 镜像，`@deepseek-ai/*` 的 `@latest` 标签过期**（已实证：`dsh-base@latest`=0.0.1-rc.1 而 0.1.1-rc.2 已发布；`dsh-client-ui-conversation@latest`=0.0.1-rc.1 而 0.1.2-alpha.2 已发布）。**一律显式锁精确版本**，不用 `^`/`@latest`；安装报 E404/版本不符时，用 `--registry https://registry.npmjs.org` 重试。
4. **dsh 版本锁定**：运行时 `@deepseek-ai/dsh@0.1.1-rc.2`；API 包版本以**本机实际安装的 dsh 运行时解析到的版本为准**（M0 核对后写死进各包 peer/devDeps）。
5. **本机环境**：Windows 11 + Node v24.19.0 + pnpm 11.17.0（Git Bash）。路径分隔符用 `/`；dsh 的 `!!js dshHomePath('storages')` 语法不要改动。
6. **存储**：一律用 `ctx.storage` + `storage-json`（dsh-base patch 自带），不自造持久化。每个功能一个 KvUnit（`kv.open({ name, version, tables })`）。
7. **会话事件是唯一 UI 数据源**：工具把业务动作写进会话事件（`agent.session.append(type, data)`），client 节点从事件流折叠渲染，不直接读存储。
8. **UI 渲染机制**（已实证，与 spec 措辞有出入时以此为准）：`ConversationNodeDefinition` 通过 `ctx.uiConversation.events.register()` 注册；renderer 通过 keyed slot `ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name, key: <kind> }, Component))` 注册；`chat` 目标与聊天视图已由 ui-chat 注册，**插件不注册 view**，只注册 definition + renderer。
9. **设置卡片**：host 用 `ctx.inject(['settings'])` + `settings.installSection(ctx, NS, schema, entry, hooks)`（schema 类型 `z<T>` 来自 `@deepseek-ai/schemastery`）；client 用 `ctx.settingsScope.bind({ namespace })` + `settings.plugin.item` keyed slot。设置项默认值由 host 侧 entry 提供。
10. **git commit 不加任何署名尾注**（无 `Co-Authored-By`、无 `Signed-off-by`）。
11. **红线（即使 auto-accept 也须停下询问用户）**：删除文件/目录/git 历史；修改 `.env`/密钥/token/CI-CD；数据库 schema 变更/迁移；git push/rebase/reset --hard/强推；安装**新的全局依赖**或改系统配置；npm publish/部署到生产。— 本计划刻意把 dsh CLI 装成**项目本地 devDependency**（`dev/`），不装全局，规避全局安装红线；发布任务（M4-2）单独要求用户授权。
12. **`$DSH_HOME` 指向仓库内 `.dsh-home/`**（gitignore），整个 dsh 运行态自包含、可随时删除重建。

## File Structure

```
dsh-desk-studio/
├─ CLAUDE.md                                  # 项目规则（Task 1）
├─ package.json                               # workspace root：devDeps 含 @deepseek-ai/dsh@0.1.1-rc.2 + scripts
├─ pnpm-workspace.yaml                        # packages/ *
├─ .gitignore                                 # node_modules/.dsh-home/.research 等
├─ docs/superpowers/
│  ├─ specs/2026-08-31-dsh-desk-studio-design.md   # 已有（commit 596e358）
│  └─ plans/2026-08-31-dsh-desk-studio.md          # 本文件
└─ packages/
   ├─ profile-web/                            # M0/M4：web profile 组装（dsh.profile manifest）
   ├─ plugin-notes/                           # M1 标杆
   │  ├─ package.json                         # dsh.bundle.patch + dsh.client + ./client 导出
   │  ├─ cordis.patch.yml                     # host 插件声明（plugins:）
   │  ├─ tsconfig.json / tsdown.client.ts
   │  ├─ src/
   │  │  ├─ index.ts                          # host apply()
   │  │  ├─ service.ts                        # NotesService extends Service
   │  │  ├─ storage.ts                        # KvUnit 封装
   │  │  ├─ tools.ts                          # notes_create/list/update/delete（defineTool）
   │  │  ├─ events.ts                         # SessionEventMap 合并 + append helper
   │  │  ├─ settings.ts                       # installSection（schemastery schema）
   │  │  ├─ types.ts                          # client-safe 类型（note payloads）
   │  │  └─ client/
   │  │     ├─ index.ts                       # client apply：注册 definition+renderer+card
   │  │     ├─ definition.ts                  # note-list ConversationNodeDefinition
   │  │     ├─ renderer.tsx                   # NoteListView（keyed renderer）
   │  │     └─ settings-card.tsx              # NotesSettingsCard（CardForm）
   │  └─ tests/
   │     ├─ definition.test.ts                # match/start/update/buildViewNode 纯逻辑
   │     ├─ tools.test.ts                     # 工具参数校验 + service 调用（mock）
   │     └─ service.test.ts                   # NotesService 存储逻辑（mock KvUnit）
   ├─ plugin-weather/ …                       # M2（结构同 notes，含 provider seam）
   ├─ plugin-translator/ …                    # M2
   ├─ plugin-reminders/ …                     # M3
   └─ plugin-scheduled-tasks/ …               # M3
```

---

### Task 1: 项目规则与脚手架（CLAUDE.md + workspace root）

**Files:**
- Create: `CLAUDE.md`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`

**Interfaces:**
- Consumes: 无（本仓库现状：spec + `.research/` + 空 git）。
- Produces: workspace root 的 `pnpm dev` / `pnpm dsh` 脚本；`packages/*` 的 workspace 约定。

- [ ] **Step 1: 写 CLAUDE.md**

内容（中文，简洁，覆盖本项目真正的规则，不重复全局 CLAUDE.md）：

```markdown
# dsh-desk-studio

用 dsh 插件范式重做 Forge Studio 功能（F1 便签/F2 天气/F3 翻译/F4 提醒/F5 定时任务/F7 设置）。

## 命令
- `pnpm install` — 装 workspace（含本地 dsh CLI）
- `pnpm dev` — 启动 dsh web（`$DSH_HOME=.dsh-home`，profile=web）
- `pnpm dsh -- <args>` — 直接调 dsh CLI（如 `pnpm dsh plugin --profile web list`）
- `pnpm test` — 全 workspace vitest

## 硬性规则
- 每个功能一个 `packages/plugin-<name>`，命名 `@forge-studio/dsh-plugin-<name>`。
- 依赖只指向 Service Definition 包；client 对跨插件值一律 type-only import。
- 数据持久化只用 `ctx.storage`（storage-json），不自造。
- 会话事件是 UI 唯一数据源；UI 节点只从事件流折叠渲染。
- `$DSH_HOME=.dsh-home`（仓库内，已 gitignore）；dsh 运行时锁 0.1.1-rc.2。
- npm 包版本显式锁死，不用 `^`/`@latest`（npmmirror 镜像 latest 标签过期）。
```

- [ ] **Step 2: 写 workspace root 文件**

`package.json`（dsh CLI 作为**本地** devDependency，规避全局安装红线；版本显式锁死）：

```json
{
  "name": "dsh-desk-studio",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "cross-env DSH_HOME=.dsh-home dsh web",
    "dsh": "cross-env DSH_HOME=.dsh-home dsh",
    "test": "vitest run"
  },
  "devDependencies": {
    "@deepseek-ai/dsh": "0.1.1-rc.2",
    "cross-env": "7.0.3",
    "vitest": "2.1.9"
  }
}
```

`pnpm-workspace.yaml`：

```yaml
packages:
  - 'packages/*'
```

`.gitignore`：

```gitignore
node_modules/
.dsh-home/
packages/*/lib/
packages/*/node_modules/
.research/
*.log
```

- [ ] **Step 3: 安装并验证**

Run: `pnpm install`
Expected: workspace 装好，`node_modules/.bin/dsh` 存在。

Run: `pnpm dsh -- --version`
Expected: 打印 dsh 版本（`0.1.1-rc.2`）。

> 若 `@deepseek-ai/dsh@0.1.1-rc.2` 从 npmmirror 装失败（版本未同步），重试：
> `pnpm install --registry https://registry.npmjs.org`

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md package.json pnpm-workspace.yaml .gitignore
git commit -m "chore: scaffold workspace with local dsh CLI"
```

---

### Task 2 (M0-1): `dsh web` 首跑 + 默认 web profile 冒烟

**Files:**
- Create: `packages/profile-web/package.json`（占位，后续 Task 9 填充 `dsh.profile`）
- Modify: `.gitignore`（无新增项，确认 `.dsh-home/` 已忽略）

**Interfaces:**
- Consumes: Task 1 的 `pnpm dsh`。
- Produces: 可启动的 `web` profile；`$DSH_HOME=.dsh-home` 目录结构（bundles/patch 文件位置由首跑生成）。

- [ ] **Step 1: 首跑 dsh web（后台）**

Run（后台进程，dsh web 是长驻服务）：
```bash
pnpm dev
```
Expected: 控制台输出 web 服务地址（默认 `http://localhost:5147` 附近），无致命报错。首次运行会在 `.dsh-home/` 下初始化默认 `web` profile。

- [ ] **Step 2: 冒烟验证**

用浏览器或 curl 访问地址，确认渲染出 dsh web UI。

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5147
```
Expected: `200`。

- [ ] **Step 3: 检查默认 profile 布局**

```bash
ls -R .dsh-home | head -40
```
Expected: 能看到 profile 目录（含 `web` 或等价物）、bundles 配置、patch 文件。**记录 profile 目录绝对路径**（后续 `dsh plugin --profile web add` 的目标），并核对：

```bash
cat <profile-dir>/package.json | grep -A10 '"dsh"'
```
Expected: 能看到 `dsh.profile`（bundles 列表），默认含 `@deepseek-ai/dsh-base` 等。**确认 `dsh-base` 的解析版本号**（应为 0.1.1-rc.2 或与 dsh CLI 一致），作为 Global Constraints 第 4 条的核对输入。

> 若首次运行需要交互引导（如 license/telemetry），按提示选择；任何需要写 `.env`/全局配置的选项一律选否并记录。

- [ ] **Step 4: 停掉服务，确认可复启**

Run: 停止后台进程；再次 `pnpm dev` 应能正常启动。
Expected: 二次启动无初始化噪音。

- [ ] **Step 5: Commit**

```bash
git add packages/profile-web/package.json
git commit -m "chore(m0): first dsh web boot, smoke-tested default web profile"
```

---

### Task 3 (M0-2): 最小 host 插件 —— `--patch` overlay 加载验证

> 目的：在动手做 client 之前，先验证"外部包能作为 bundle 被 profile 加载"这条 host 链路。这是 dsh 生态可用性的地基。

**Files:**
- Create: `packages/plugin-notes/package.json`（骨架，后续任务填充完整字段）
- Create: `packages/plugin-notes/cordis.patch.yml`
- Create: `packages/plugin-notes/src/index.ts`
- Create: `packages/plugin-notes/tsconfig.json`

**Interfaces:**
- Consumes: `dsh web` 启动链路（Task 2）。
- Produces: 一个注册了 log 插件的可加载 bundle；证明 `dsh plugin --profile web add <本地包>` 链路可用。

- [ ] **Step 1: 写最小插件**

`packages/plugin-notes/package.json`（先最小化，M1 再补 `dsh.client` 等）：

```json
{
  "name": "@forge-studio/dsh-plugin-notes",
  "version": "0.1.0",
  "type": "module",
  "main": "./lib/index.js",
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --out-dir lib"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "4.0.2"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "4.0.2",
    "tsup": "8.3.5",
    "typescript": "5.7.2"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }
  }
}
```

`packages/plugin-notes/cordis.patch.yml`：

```yaml
plugins:
  '@forge-studio/dsh-plugin-notes': {}
```

`packages/plugin-notes/src/index.ts`：

```ts
import { Context } from '@deepseek-ai/cordis'

export const name = '@forge-studio/dsh-plugin-notes'
export const inject = []

export function apply(ctx: Context): void {
  ctx.on('ready', () => {
    ctx.logger('notes').info('[m0] notes plugin loaded')
  })
}
```

`packages/plugin-notes/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "lib"
  },
  "include": ["src"]
}
```

- [ ] **Step 2: 构建**

Run: `pnpm --filter @forge-studio/dsh-plugin-notes build`
Expected: 产出 `lib/index.js` + `lib/index.d.ts`。

- [ ] **Step 3: 安装进 web profile**

Run:
```bash
pnpm dsh -- plugin --profile web add "D:/codes/dsh-desk-studio/packages/plugin-notes"
```
Expected: 安装成功（转发到 pnpm，把本地包加入 profile）。记录输出中的解析版本。

- [ ] **Step 4: 启动验证插件被加载**

Run（后台）：`pnpm dev`
Expected: 日志出现 `[m0] notes plugin loaded`。若无此日志，检查 profile 的 patch 合并顺序（Global Constraints 与 spec 的配置层规则）。

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-notes
git commit -m "feat(m0): minimal notes bundle loads into web profile via --patch"
```

---

### Task 4 (M0-3): 最小 client 插件 —— 外部包贡献对话流节点（M0 核心风险验证）

> **M0 的成败关键**：验证"外部 npm 包能贡献 client UI（自定义 `ConversationNodeDefinition` + renderer + 设置卡片）"。全部权威 API 已在 `.research/npm-inspect/` 核实（`ui-conversation`/`ui-chat`/`ui-settings-plugins` 发布包），本任务用最小闭环实证整条链路。若此路不通则触发 spec 的 fallback A/B。

**Files:**
- Modify: `packages/plugin-notes/package.json`（补 `dsh.client` manifest、`./client` 导出、client 相关 peer/devDeps）
- Modify: `packages/plugin-notes/tsconfig.json`（补 `jsx: react-jsx`，client 文件单独 tsconfig 或共用）
- Create: `packages/plugin-notes/tsdown.client.ts`
- Create: `packages/plugin-notes/src/client/index.ts`
- Create: `packages/plugin-notes/src/client/definition.ts`
- Create: `packages/plugin-notes/src/client/renderer.tsx`

**Interfaces:**
- Consumes: Task 3 的 host 加载链路；`ctx.uiConversation` / `ctx.slots` 服务（由已安装的 ui-* 包提供）。
- Produces:
  - `@forge-studio/dsh-plugin-notes/client` 子路径（预构建 `lib/client.js`，`window.__ModuleLoader__.load` CJS closure 格式）
  - 自定义节点 kind `'m0-hello'`：定义 + renderer，插入聊天流
  - **决策记录**：外部 bundle 贡献 client UI 可行与否的结论 + 实际需要的 `dsh.client.inject` 列表

- [ ] **Step 1: 核对 client API 包实际版本，锁进 deps**

Run:
```bash
pnpm dsh -- --dump-config 2>&1 | grep -E "client-ui-conversation|client-ui-chat|client-ui-settings" | head
```
以及
```bash
pnpm --filter profile-web exec pnpm list @deepseek-ai/dsh-client-ui-conversation @deepseek-ai/dsh-client-ui-chat @deepseek-ai/dsh-client-ui-settings --depth=0 2>/dev/null
```
Expected: 得到本机 web profile 实际加载的这三个包版本号（Global Constraints 第 4 条的核对）。**把版本写死**进 plugin-notes 的 `devDependencies`（type-check 用）与 `peerDependencies`。

- [ ] **Step 2: 写 client 类型合并面与最小定义**

`src/client/definition.ts` —— 最小 `ConversationNodeDefinition`（只吃 `message/user` 事件，验证 match→start→buildViewNode 全链）：

```ts
import type {
  ConversationNodeDefinition,
  ConversationMatchResult,
  ConversationNodeContext,
  ConversationStartMatch,
  conversationContextKey,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'

export interface M0HelloState {
  readonly count: number
  readonly lastText: string | undefined
}

export const m0HelloDefinition: ConversationNodeDefinition<M0HelloState> = {
  kind: 'm0-hello',
  target: 'chat',
  match(event: SessionEventLike): ConversationMatchResult | null {
    if (event.type === 'message/user') return { id: 'hello', role: 'start' }
    if (event.type === 'message/assistant') return { id: 'hello', role: 'update' }
    return null
  },
  start(_context: ConversationNodeContext<M0HelloState>, match: ConversationStartMatch): M0HelloState {
    const text = (match.event as { data?: { content?: string } }).data?.content ?? ''
    return { count: 1, lastText: text }
  },
  update(context: ConversationNodeContext<M0HelloState> & { readonly state: M0HelloState }, match: ConversationMatch): M0HelloState {
    return { count: context.state.count + 1, lastText: context.state.lastText }
  },
  buildViewNode(context: ConversationNodeContext<M0HelloState>) {
    if (!context.start) return null
    return {
      key: conversationContextKey('m0-hello', 'hello'),
      kind: 'm0-hello',
      id: 'hello',
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: context.state,
    }
  },
}
```

> 注：`conversationContextKey` 是运行时函数（从 `@deepseek-ai/dsh-client-ui-conversation/client` 导入）；`ChatConversationViewNode` 要求的 `anchorSeq/location/visibility` 三个 chat 扩展字段按此补全。若 `context.start.location` 类型不符，M0 现场核对 `.dsh-home` 安装版本的 `conversation.d.ts` 调整。

- [ ] **Step 3: 声明 `ChatNodeDataMap` 合并并写 renderer**

`src/client/renderer.tsx`：

```tsx
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'm0-hello': M0HelloState
  }
}

export interface M0HelloViewProps extends ChatNodeViewProps<'m0-hello'> {}

export function M0HelloView({ node }: M0HelloViewProps) {
  return (
    <div style={{ padding: 8, border: '1px dashed #ccc', borderRadius: 8 }}>
      m0-hello: 收到 {node.data.count} 条消息，首条 = {node.data.lastText ?? '(空)'}
    </div>
  )
}
```

- [ ] **Step 4: 写 client apply 并接线 manifest**

`src/client/index.ts`：

```ts
import { Context } from '@deepseek-ai/cordis'
import { m0HelloDefinition } from './definition.ts'
import { M0HelloView } from './renderer.tsx'

export const name = '@forge-studio/dsh-plugin-notes/client'
export const inject = ['slots', 'sessions', 'uiSession', 'uiConversation', 'layout', 'locale']

export function apply(ctx: Context): void {
  ctx.inject(['uiConversation'], (ctx) => {
    ctx.uiConversation.events.register(m0HelloDefinition)
  })
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      { name: 'conversation.chat.node', key: 'm0-hello', locale: 'forge-studio' },
      M0HelloView,
    ),
  )
}
```

`packages/plugin-notes/package.json` 增补（版本以 Step 1 核对为准）：

```json
{
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-settings"
      ],
      "platform": "web"
    }
  }
}
```

`tsdown.client.ts` —— 用官方 clientBundle preset（`@deepseek-ai/dsh` 或 `tsdown` 提供，按 `.research/npm-inspect/` 抓到的官方打包配置对齐）：

```ts
import { defineConfig } from 'tsdown'
// clientBundle preset 字段以官方 packages/client/*/tsdown.client.ts 为准：
// 产出 window.__ModuleLoader__.load({ id, factory }) 惰性 closure 格式
export default defineConfig({
  entry: ['src/client/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  dts: false,
  bundle: true,
  // ...clientBundle preset 的具体选项，M0 从官方包复制
})
```

> 本步的 clientBundle 打包配置是 M0 需要实证的最大未知点。若 preset 不可直接复用，退路：把 `src/client/index.ts` 及其依赖打进一个自包含 ESM bundle，产物结构对齐官方 `lib/client.js`（`window.__ModuleLoader__.load({ id, factory })`），在 Task 6 加载验证时按浏览器报错迭代。

- [ ] **Step 5: 构建 client 并重新安装**

Run:
```bash
pnpm --filter @forge-studio/dsh-plugin-notes build
pnpm dsh -- plugin --profile web add "D:/codes/dsh-desk-studio/packages/plugin-notes"
```
Expected: `lib/client.js` 产出；profile 重新安装成功。

- [ ] **Step 6: 启动并验证节点渲染**

Run（后台）：`pnpm dev`
Expected:
1. host 侧无加载报错；
2. 在 web UI 里发一条用户消息，聊天流中出现 `m0-hello` 卡片，计数递增。

> 若浏览器控制台报 module loader 找不到依赖包（`dsh.client.inject` 不全），按报错补包名后重复 Step 5。此迭代得到**真实可用的 `dsh.client.inject` 清单**，写进 Global Constraints/plugin-notes。

- [ ] **Step 7: 记录 M0 结论并 Commit**

在 `docs/superpowers/` 下追加 `M0-VERDICT.md`，记录：外部 bundle 贡献 client UI **可行/不可行**、实际 `dsh.client.inject` 清单、clientBundle 打包配置、踩坑。不可行则按 spec 触发 fallback A/B（停下与用户确认）。

```bash
git add packages/plugin-notes docs/superpowers/M0-VERDICT.md
git commit -m "feat(m0): external bundle contributes client conversation node (verified)"
```

---

### Task 5 (M1-1): NotesService —— host 服务 + 存储

**Files:**
- Create: `packages/plugin-notes/src/types.ts`
- Create: `packages/plugin-notes/src/storage.ts`
- Create: `packages/plugin-notes/src/service.ts`
- Modify: `packages/plugin-notes/src/index.ts`（注册服务 + tools + events + settings）
- Create: `packages/plugin-notes/tests/service.test.ts`

**Interfaces:**
- Consumes: `ctx.storage`（`dsh-storage`，dsh-base patch 自带）；Task 3 的插件骨架。
- Produces:
  - `type NoteRecord { id; title; body; createdAt; updatedAt?; deletedAt? }`
  - `class NotesService extends Service` → `ctx.notes`，方法：
    - `create(input: { title: string; body: string }): Promise<NoteRecord>`
    - `list(): Promise<NoteRecord[]>`
    - `update(id: string, patch: { title?: string; body?: string }): Promise<NoteRecord | undefined>`
    - `remove(id: string): Promise<boolean>`
    - 事件写入通过传入的 `emit` 回调（由 tools 层接 `agent.session.append`），服务自身不依赖 agent

- [ ] **Step 1: 写失败测试（service.test.ts）**

用 mock KvUnit 验证 CRUD + 事件回调（storage API 以 `.research/npm-inspect/storage*/` 核实为准；方法名现场核对）：

```ts
import { describe, it, expect, vi } from 'vitest'
import { NotesService } from '../src/service'

function mockUnit() {
  const map = new Map<string, unknown>()
  return {
    loadAll: vi.fn(async () => Array.from(map.values())),
    putRecord: vi.fn(async (_t: string, k: string, v: unknown) => { map.set(k, v) }),
    deleteRecord: vi.fn(async (_t: string, k: string) => { map.delete(k) }),
  }
}

describe('NotesService', () => {
  it('create 持久化并发出 note/created 事件', async () => {
    const unit = mockUnit()
    const emit = vi.fn()
    const svc = new NotesService({} as never, { unit: unit as never, emit })
    const note = await svc.create({ title: 't', body: 'b' })
    expect(note.id).toBeTruthy()
    expect(unit.putRecord).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith('note/created', expect.objectContaining({ id: note.id }))
  })

  it('remove 后 list 不含该便签', async () => {
    const unit = mockUnit()
    const svc = new NotesService({} as never, { unit: unit as never, emit: vi.fn() })
    const { id } = await svc.create({ title: 't', body: 'b' })
    await svc.remove(id)
    expect(await svc.list()).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run packages/plugin-notes/tests/service.test.ts`
Expected: FAIL（`NotesService` 未定义）。

- [ ] **Step 3: 实现**

`src/types.ts`（client-safe，无任何 host 依赖）：

```ts
export interface NoteRecord {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly createdAt: string
  readonly updatedAt?: string
  readonly deletedAt?: string
}

export interface NotesConfig {
  /** 单个会话内最多展示的便签数（供 client 卡片用）。 */
  readonly maxVisibleNotes: number
}
```

`src/storage.ts` —— KvUnit 封装（实际 API 以安装版本 `.d.ts` 为准，方法名 loadAll/putRecord/deleteRecord 已在 `storage/`、`storage-json/` 发布包核实）：

```ts
import { randomUUID } from 'node:crypto'
import type { NoteRecord } from './types'

export interface NotesStorage {
  create(input: { title: string; body: string }): Promise<NoteRecord>
  list(): Promise<NoteRecord[]>
  update(id: string, patch: { title?: string; body?: string }): Promise<NoteRecord | undefined>
  remove(id: string): Promise<boolean>
}

export async function openNotesStorage(unit: any): Promise<NotesStorage> {
  const TABLE = 'notes'
  return {
    async create(input) {
      const note: NoteRecord = { id: randomUUID(), ...input, createdAt: new Date().toISOString() }
      await unit.putRecord(TABLE, note.id, note)
      return note
    },
    async list() {
      const rows = await unit.loadAll()
      return rows.filter((r: NoteRecord) => !r.deletedAt)
    },
    async update(id, patch) {
      const rows = await unit.loadAll()
      const cur = rows.find((r: NoteRecord) => r.id === id)
      if (!cur || cur.deletedAt) return undefined
      const next: NoteRecord = { ...cur, ...patch, updatedAt: new Date().toISOString() }
      await unit.putRecord(TABLE, id, next)
      return next
    },
    async remove(id) {
      const rows = await unit.loadAll()
      const cur = rows.find((r: NoteRecord) => r.id === id)
      if (!cur) return false
      await unit.putRecord(TABLE, id, { ...cur, deletedAt: new Date().toISOString() })
      return true
    },
  }
}
```

`src/service.ts`：

```ts
import { Service } from '@deepseek-ai/cordis'
import type { NotesConfig, NoteRecord } from './types'
import type { NotesStorage } from './storage'

export type NoteEvent = { type: string; data: unknown }

export interface NotesServiceConfig {
  storage: NotesStorage
  emit: (type: string, data: unknown) => void
}

export class NotesService extends Service {
  static Config = NotesServiceConfig as unknown as any
  private readonly storage: NotesStorage
  private readonly emit: (type: string, data: unknown) => void

  constructor(ctx: any, config: NotesServiceConfig) {
    super(ctx, 'notes')
    this.storage = config.storage
    this.emit = config.emit
  }

  async create(input: { title: string; body: string }): Promise<NoteRecord> {
    const note = await this.storage.create(input)
    this.emit('note/created', note)
    return note
  }
  list() { return this.storage.list() }
  async update(id: string, patch: { title?: string; body?: string }) {
    const note = await this.storage.update(id, patch)
    if (note) this.emit('note/updated', note)
    return note
  }
  async remove(id: string) {
    const ok = await this.storage.remove(id)
    if (ok) this.emit('note/deleted', { id })
    return ok
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    notes: NotesService
  }
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm vitest run packages/plugin-notes/tests/service.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-notes/src packages/plugin-notes/tests
git commit -m "feat(m1): NotesService with storage and event emission"
```

---

### Task 6 (M1-2): 会话事件合并 + 四个工具

**Files:**
- Create: `packages/plugin-notes/src/events.ts`
- Create: `packages/plugin-notes/src/tools.ts`
- Modify: `packages/plugin-notes/src/index.ts`（`ctx.inject(['notes','agent'])` 接线 tools + events）
- Create: `packages/plugin-notes/tests/tools.test.ts`

**Interfaces:**
- Consumes: `ctx.notes`（Task 5）、`ctx.agent.session.append`（dsh-session）、`ctx.tools.register` + `defineTool`（dsh-tools）。
- Produces:
  - `SessionEventMap` 合并：`'note/created' | 'note/updated' | 'note/deleted'`（key 即 Definition 的 `match` 依据）
  - `defineTool` ×4：`notes_create` / `notes_list` / `notes_update` / `notes_delete`，`output.schema` 与 `render` 完整声明

- [ ] **Step 1: 写失败测试（tools.test.ts）**

验证 defineTool 的 args 校验 + execute 调用 service 并 append 事件：

```ts
import { describe, it, expect, vi } from 'vitest'
import { defineNoteTools } from '../src/tools'

function ctx() {
  const notes = { create: vi.fn(async (i: any) => ({ id: 'n1', ...i, createdAt: 'x' })), list: vi.fn(async () => []), update: vi.fn(), remove: vi.fn() }
  const append = vi.fn()
  return {
    notes: notes as never,
    agent: { session: { append } } as never,
    tools: { register: vi.fn() } as never,
    _notes: notes, _append: append,
  }
}

describe('notes tools', () => {
  it('notes_create 校验参数并 append note/created', async () => {
    const c = ctx()
    const tools = defineNoteTools(c as never)
    const create = tools.find((t: any) => t.name === 'notes_create')!
    const value = await create.execute({ title: 't', body: 'b' }, {} as never)
    expect(c._notes.create).toHaveBeenCalledWith({ title: 't', body: 'b' })
    expect(c._append).toHaveBeenCalledWith('note/created', expect.any(Object))
    expect(value.id).toBe('n1')
  })

  it('notes_create 缺 title 抛参数错误', async () => {
    const c = ctx()
    const tools = defineNoteTools(c as never)
    const create = tools.find((t: any) => t.name === 'notes_create')!
    await expect(create.execute({}, {} as never)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run packages/plugin-notes/tests/tools.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 events.ts**

```ts
import type { NoteRecord } from './types'

export interface NoteUpdatedMeta {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly updatedAt: string
}
export interface NoteDeletedMeta { readonly id: string }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'note/created': NoteRecord
    'note/updated': NoteUpdatedMeta
    'note/deleted': NoteDeletedMeta
  }
}

export type NoteEventMap = {
  'note/created': NoteRecord
  'note/updated': NoteUpdatedMeta
  'note/deleted': NoteDeletedMeta
}
```

- [ ] **Step 4: 实现 tools.ts**

`defineTool` 的 schema DSL 与签名已核实（`.research/npm-inspect/tools/package/lib/types/schema.d.ts`）：`args` 是隐式 open object 的参数 map，必填字段标 `required: true`；`execute(args, exec)` 返回 canonical 值；`output.schema` 是显式 JsonSchemaNode + `render(args, value)` 产出 `ContentBlock[]`。

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'

export function defineNoteTools(ctx: Context) {
  const { notes } = ctx
  const text = (t: string) => [{ type: 'text', text: t }] as const

  return [
    defineTool({
      name: 'notes_create',
      description: '创建一条便签并保存',
      args: {
        title: { type: 'string', required: true, description: '便签标题' },
        body: { type: 'string', description: '便签正文' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, createdAt: { type: 'string' },
          },
        },
        render: (_args, value) => text(`已创建便签「${value.title}」`),
      },
      async execute(args) {
        const note = await notes.create({ title: args.title, body: args.body ?? '' })
        ctx.agent.session.append('note/created', note)
        return note
      },
    }),
    defineTool({
      name: 'notes_list',
      description: '列出所有未删除便签',
      args: {},
      output: {
        schema: { type: 'array', items: { type: 'json' } },
        render: (_args, value) => text(`共 ${(value as unknown[]).length} 条便签`),
      },
      async execute() {
        const list = await notes.list()
        ctx.agent.session.append('note/list', list)
        return list
      },
    }),
    defineTool({
      name: 'notes_update',
      description: '更新一条便签的标题或正文',
      args: {
        id: { type: 'string', required: true, description: '便签 id' },
        title: { type: 'string', description: '新标题' },
        body: { type: 'string', description: '新正文' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => text(`已更新便签「${value.title ?? value.id}」`),
      },
      async execute(args) {
        const note = await notes.update(args.id, { title: args.title, body: args.body })
        if (!note) throw new Error(`便签不存在: ${args.id}`)
        ctx.agent.session.append('note/updated', note)
        return note
      },
    }),
    defineTool({
      name: 'notes_delete',
      description: '删除一条便签',
      args: { id: { type: 'string', required: true, description: '便签 id' } },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => text(`已删除便签 ${value.id}`),
      },
      async execute(args) {
        const ok = await notes.remove(args.id)
        if (!ok) throw new Error(`便签不存在: ${args.id}`)
        ctx.agent.session.append('note/deleted', { id: args.id })
        return { id: args.id }
      },
    }),
  ]
}
```

> 说明：`ctx.agent.session.append` 已在工具内调用（agent 在工具执行期可用）。`note/list` 事件由 client 节点按需订阅（M1 节点只关注 created/updated/deleted）。

- [ ] **Step 5: 接线 index.ts（合并 Task 3 骨架）**

```ts
import { Context } from '@deepseek-ai/cordis'
import { NotesService } from './service'
import { openNotesStorage } from './storage'
import { defineNoteTools } from './tools'
import { installNotesSettings } from './settings'

export const name = '@forge-studio/dsh-plugin-notes'
export const inject = ['storage']

export function apply(ctx: Context): void {
  ctx.inject(['storage'], async (ctx) => {
    const unit = await ctx.storage.backend.get('json').kv.open({
      name: 'notes', version: 1, tables: ['notes'], hasGlobal: false,
    })
    const storage = await openNotesStorage(unit)
    ctx.plugin(NotesService, { storage, emit: (type, data) => ctx.agent.session.append(type, data) })
  })
  ctx.inject(['notes', 'agent'], (ctx) => {
    for (const tool of defineNoteTools(ctx)) ctx.tools.register(tool)
  })
  installNotesSettings(ctx)
}
```

> `kv.open` 的具体参数/返回以 `.research/npm-inspect/storage*/` 核实为准；`emit` 闭包引用 `ctx.agent` 延迟到工具执行期解析。settings 在 Task 7 实现，本步先留 `installNotesSettings` 空函数占位并确保编译通过。

- [ ] **Step 6: 跑测试验证通过**

Run: `pnpm vitest run packages/plugin-notes/tests`
Expected: service + tools 测试全 PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-notes
git commit -m "feat(m1): note tools with session event emission"
```

---

### Task 7 (M1-3): 设置卡片（host schema + client card）

**Files:**
- Create: `packages/plugin-notes/src/settings.ts`
- Create: `packages/plugin-notes/src/client/settings-card.tsx`

**Interfaces:**
- Consumes: host `settings` 服务（`installSection`，schema 类型 `z<T>` from `@deepseek-ai/schemastery`）；client `settingsScope.bind` + `settings.plugin.item` slot（bash-local / ui-settings-plugins 范本）。
- Produces:
  - 命名空间 `'forge-studio.notes'` 的配置节，字段：`maxVisibleNotes`（number，默认 8）、`defaultTitle`（string，默认 '新便签'）
  - client 卡片 `NotesSettingsCard`（CardForm controller）

- [ ] **Step 1: 写 host settings.ts**

```ts
import { Context } from '@deepseek-ai/cordis'
import { Schema } from '@deepseek-ai/schemastery'
import type { NotesConfig } from './types'

export const NOTES_NAMESPACE = 'forge-studio.notes'

export const NotesConfigSchema = Schema.object({
  maxVisibleNotes: Schema.number().default(8),
  defaultTitle: Schema.string().default('新便签'),
})

export function installNotesSettings(ctx: Context): void {
  const entry: NotesConfig = { maxVisibleNotes: 8, defaultTitle: '新便签' }
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NOTES_NAMESPACE, NotesConfigSchema as any, entry, {
      setSource: () => {},
      onChange: () => {},
    })
  })
}
```

> `installSection` 第三参类型是 schemastery `z<T>`；`Schema.object/number/string` 的确切导出名与签名以 `.research/npm-inspect/settings/package/lib/types/index.d.ts` 及安装版本现场核对，必要时按 bash-local 的写法对齐。

- [ ] **Step 2: 写 client settings-card.tsx**

```tsx
import { useMemo } from 'react'
import { defineCard } from '@deepseek-ai/dsh-client-ui-settings'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NOTES_NAMESPACE } from '../settings'

export interface NotesSettingsCardProps extends PropsRuntime<'settings.plugin.item', typeof NOTES_NAMESPACE> {}

export function NotesSettingsCard(_props: NotesSettingsCardProps) {
  return useMemo(() => defineCard({
    async load() {
      return { maxVisibleNotes: 8, defaultTitle: '新便签' }
    },
    async save(values) {
      // 经 settingsScope 写回 host（保存实现以 ui-settings-plugins 的 BashCardController/CardForm 范本为准）
      return values
    },
  }), [])
}
```

> client 侧设置卡片的完整形态（CardForm controller + projection/actions）在 M0 已实证存在（`dsh-client-ui-settings-plugins` 的 bash-card-controller 范本，源码抓取于 `.research/`）。本步实现最小可保存表单，M1-4 端到端验证时按真实 slot 注入的 props 形状迭代。若 `defineCard` 不是正确 API，退路：直接 `ctx.settingsScope.bind({ namespace: NOTES_NAMESPACE })` + 原生 `<form>`。

- [ ] **Step 3: 在 client/index.ts 注册卡片 slot**

```ts
ctx.slots.inject('settings.plugin.item', () =>
  ctx.slots.register(
    { name: 'settings.plugin.item', key: NOTES_NAMESPACE, locale: 'forge-studio' },
    NotesSettingsCard,
  ),
)
```

- [ ] **Step 4: 构建 + 重新安装 + 端到端验证**

Run:
```bash
pnpm --filter @forge-studio/dsh-plugin-notes build
pnpm dsh -- plugin --profile web add "D:/codes/dsh-desk-studio/packages/plugin-notes"
pnpm dev
```
Expected:
1. 设置页出现 "便签" 分类，可编辑 `maxVisibleNotes`/`defaultTitle`；
2. 发消息让 agent 调 `notes_create`，聊天流出现便签卡片，随后 `notes_list` 可读到该便签；
3. 再次打开设置，改的值仍在（host 侧已持久化）。

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-notes
git commit -m "feat(m1): notes settings card (host schema + client card)"
```

---

### Task 8 (M1-4): note-list 对话流节点（Definition + renderer 终版）

**Files:**
- Create: `packages/plugin-notes/src/client/note-list-definition.ts`（从 Task 4 的 `definition.ts` 演进）
- Modify: `packages/plugin-notes/src/client/renderer.tsx`（终版 `NoteListView`）
- Create: `packages/plugin-notes/tests/definition.test.ts`

**Interfaces:**
- Consumes: 事件流 `note/created|updated|deleted`（Task 6）；`ctx.uiConversation.events.register`；`ChatNodeDataMap` 合并面（Task 4 已验证）。
- Produces: 单个 `'note-list'` 节点，kind=note-list，target='chat'，把一次会话中的便签折叠成一张实时卡片。

- [ ] **Step 1: 写失败测试（definition.test.ts）**

纯函数测试 match/start/update/fold：

```ts
import { describe, it, expect } from 'vitest'
import { noteListDefinition } from '../src/client/note-list-definition'

const ev = (type: string, seq: number, data: any) => ({ seq, type, data })

describe('noteListDefinition', () => {
  it('match 只认 note/* 事件，同一会话折叠成一个 context', () => {
    expect(noteListDefinition.match(ev('note/created', 1, { id: 'a' }) as any)).toEqual({ id: 'inbox', role: 'start' })
    expect(noteListDefinition.match(ev('note/updated', 2, { id: 'a' }) as any)).toEqual({ id: 'inbox', role: 'update' })
    expect(noteListDefinition.match(ev('message/user', 3, {}) as any)).toBeNull()
  })

  it('start 收集首条，update 追加/更新/删除', () => {
    const start = noteListDefinition.start!({ state: undefined } as any, { event: ev('note/created', 1, { id: 'a', title: 'T', body: 'B', createdAt: 'c' }) } as any)
    expect(start.notes).toHaveLength(1)

    const s1 = noteListDefinition.update!({ state: start } as any, { event: ev('note/created', 2, { id: 'b', title: 'T2', body: '', createdAt: 'c2' }) } as any)
    expect(s1.notes).toHaveLength(2)

    const s2 = noteListDefinition.update!({ state: s1 } as any, { event: ev('note/deleted', 3, { id: 'a' }) } as any)
    expect(s2.notes.map((n: any) => n.id)).toEqual(['b'])
  })

  it('buildViewNode 产出 chat 目标节点', () => {
    const start = noteListDefinition.start!({ state: undefined } as any, { event: ev('note/created', 5, { id: 'a', title: 'T', body: 'B', createdAt: 'c' }) } as any)
    const node = noteListDefinition.buildViewNode!({ start: { event: ev('note/created', 5, {}) }, state: start } as any)
    expect(node).toMatchObject({ kind: 'note-list', target: 'chat', id: 'inbox', anchorSeq: 5 })
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run packages/plugin-notes/tests/definition.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 note-list-definition.ts**

```ts
import { conversationContextKey } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ConversationNodeDefinition, ConversationMatchResult, ConversationNodeContext,
  ConversationStartMatch, ConversationMatch,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { NoteRecord } from '../types'

export interface NoteListViewData {
  readonly notes: readonly NoteRecord[]
}

const ID = 'inbox'

function fromEvent(event: SessionEventLike): NoteRecord | undefined {
  if (event.type === 'note/created' || event.type === 'note/updated') return event.data as NoteRecord
  return undefined
}

export const noteListDefinition: ConversationNodeDefinition<NoteListViewData> = {
  kind: 'note-list',
  target: 'chat',

  match(event: SessionEventLike): ConversationMatchResult | null {
    if (event.type === 'note/created' || event.type === 'note/updated' || event.type === 'note/deleted') {
      return { id: ID, role: event.type === 'note/created' ? 'start' : 'update' }
    }
    return null
  },

  start(_context: ConversationNodeContext<NoteListViewData>, match: ConversationStartMatch): NoteListViewData {
    const note = fromEvent(match.event)
    return { notes: note ? [note] : [] }
  },

  update(context: ConversationNodeContext<NoteListViewData> & { readonly state: NoteListViewData }, match: ConversationMatch): NoteListViewData {
    const event = match.event
    const notes = [...context.state.notes]
    if (event.type === 'note/created') {
      const note = fromEvent(event)
      if (note && !notes.some((n) => n.id === note.id)) notes.push(note)
    } else if (event.type === 'note/updated') {
      const note = fromEvent(event)
      if (note) {
        const i = notes.findIndex((n) => n.id === note.id)
        if (i >= 0) notes[i] = note
      }
    } else if (event.type === 'note/deleted') {
      const id = (event.data as { id: string }).id
      return { notes: notes.filter((n) => n.id !== id) }
    }
    return { notes }
  },

  publication: () => 'immediate',

  buildViewNode(context: ConversationNodeContext<NoteListViewData>): ChatConversationViewNode | null {
    if (!context.start) return null
    return {
      key: conversationContextKey('note-list', ID),
      kind: 'note-list',
      id: ID,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: context.state,
    }
  },
}
```

- [ ] **Step 4: 更新 renderer.tsx 为终版 NoteListView**

```tsx
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { NoteListViewData } from './note-list-definition'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'note-list': NoteListViewData
  }
}

export interface NoteListViewProps extends ChatNodeViewProps<'note-list'> {}

export function NoteListView({ node }: NoteListViewProps) {
  const notes = node.data?.notes ?? []
  return (
    <section style={{ padding: 8, border: '1px solid #ddd', borderRadius: 8 }}>
      <h4>会话便签（{notes.length}）</h4>
      {notes.length === 0 ? <p>暂无便签</p> : (
        <ul>{notes.map((n) => <li key={n.id}>{n.title}</li>)}</ul>
      )}
    </section>
  )
}
```

- [ ] **Step 5: client/index.ts 注册终版定义**

把 Task 4 的 `m0HelloDefinition` 换成 `noteListDefinition`（renderer key 同步改为 `'note-list'`）。

- [ ] **Step 6: 跑测试 + 端到端**

Run: `pnpm vitest run packages/plugin-notes/tests`
Expected: 全部 PASS。

Run:
```bash
pnpm --filter @forge-studio/dsh-plugin-notes build
pnpm dsh -- plugin --profile web add "D:/codes/dsh-desk-studio/packages/plugin-notes"
pnpm dev
```
Expected: 发消息让 agent 依次 `notes_create` ×2 → `notes_update` ×1 → `notes_delete` ×1，聊天流中的便签卡片实时从 2 条 → 更新 → 1 条。

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-notes
git commit -m "feat(m1): note-list conversation node folding session note events"
```

---

### Task 9 (M2): weather + translator 插件

> M1 已确立全部模式（host service + tools + events + client node + settings card）。M2 复用同一骨架，差异点全在此任务列出。两个插件独立子任务，可并行。

**Files:**
- Create: `packages/plugin-weather/`（结构镜像 plugin-notes）
- Create: `packages/plugin-translator/`（结构镜像 plugin-notes）
- 关键差异文件：
  - `plugin-weather/src/provider.ts` —— provider seam（不依赖任何具体 API 提供商）
  - `plugin-translator/src/provider.ts` —— 同上

**Interfaces:**
- Consumes: M1 全部模式。
- Produces:
  - `weather` 服务 + `weather_query` 工具 + `weather/updated` 事件 + `'weather-now'` 节点 + 设置卡片（provider 选择 + API key + 默认城市）
  - `translator` 服务 + `translate_text` 工具 + `translation/done` 事件 + `'translation-card'` 节点 + 设置卡片（provider + 默认目标语言）

- [ ] **Step 1: 设计 provider seam（写进两个插件各自的 provider.ts）**

```ts
/** 与具体 API 提供商解耦的端口。插件只依赖此接口。 */
export interface WeatherProvider {
  readonly id: string
  query(loc: { city: string }, opts: { apiKey?: string }): Promise<{ tempC: number; condition: string; humidityPct: number; observedAt: string }>
}
export type WeatherProviderFactory = (opts: { apiKey?: string }) => WeatherProvider
```

- [ ] **Step 2: 实现 host（weather 例；translator 同构）**

- `service.ts`：`WeatherService extends Service`，`query(city)` → provider 调用 + 缓存最近结果（内存 Map，`ctx.storage` 存默认城市设置）
- `tools.ts`：`weather_query`（args `{ city: string, required: true }`，execute 调 service 并 `session.append('weather/updated', result)`）
- `events.ts`：`declare module '@deepseek-ai/dsh-session/types' { interface SessionEventMap { 'weather/updated': WeatherResult; 'translation/done': TranslationResult } }`
- `settings.ts`：命名空间 `forge-studio.weather`，字段 `{ provider: string, apiKey: string, defaultCity: string }`；`forge-studio.translator`，字段 `{ provider: string, apiKey: string, defaultTarget: string }`
- `index.ts`：`ctx.inject(['storage'])` 开 KvUnit（name: 'weather'/'translator'）；provider 由 settings 的 `provider` 字段选择（注册表 Map）

- [ ] **Step 3: 实现 client 节点**

- weather：`'weather-now'` 节点，`match('weather/updated')` → start，`buildViewNode` 折叠最近一次结果
- translator：`'translation-card'` 节点，`match('translation/done')` → start（含原文/译文，必要时按 `translationId` 做多卡片 `id`，每张卡片一个 context）

- [ ] **Step 4: 注册进 profile + 端到端**

Run:
```bash
pnpm --filter @forge-studio/dsh-plugin-weather build
pnpm --filter @forge-studio/dsh-plugin-translator build
pnpm dsh -- plugin --profile web add "D:/codes/dsh-desk-studio/packages/plugin-weather"
pnpm dsh -- plugin --profile web add "D:/codes/dsh-desk-studio/packages/plugin-translator"
pnpm dev
```
Expected: 发消息调 `weather_query 北京` 出天气卡片；调 `translate_text hello 中文` 出翻译卡片。未配 API key 时给出清晰报错（provider 不可用兜底）。

- [ ] **Step 5: 测试 + Commit**

为 provider 的纯逻辑写 vitest（fake provider 断言 service 组装/缓存行为；translation 的文本切分逻辑）。

```bash
git add packages/plugin-weather packages/plugin-translator
git commit -m "feat(m2): weather and translator plugins with provider seams"
```

---

### Task 10 (M3): reminders + scheduled-tasks 插件

> reminders 的"到时提醒"与 scheduled-tasks 的"定时执行"共享一个时间引擎，但职责不同：reminders 到点给用户发一条会话消息；scheduled-tasks 到点执行任意工具调用。

**Files:**
- Create: `packages/plugin-reminders/`（结构镜像 plugin-notes）
- Create: `packages/plugin-scheduled-tasks/`
- 差异文件：
  - `plugin-reminders/src/engine.ts` —— 内存 + 持久化的到期队列（`ctx.storage` 存 scheduled items）
  - `plugin-scheduled-tasks/src/cron.ts` —— cron 解析（不引入大依赖；用 `node-cron` 或自写 5 字段解析，测试驱动）

**Interfaces:**
- Consumes: M1 模式 + `ctx.agent.session`（发消息）。
- Produces:
  - `reminder_create` / `reminder_list` / `reminder_cancel` 工具 + `reminder/fired` 事件 + `'reminder'` 节点（列本会话已设/已触发的提醒）
  - `task_schedule` / `task_list` / `task_cancel` 工具 + `task/fired` 事件 + `'task-list'` 节点
  - 到点触发：`reminder/fired` → `session.append`（模型可见即已记录，UI 从事件折叠）

- [ ] **Step 1: 写失败测试（时间引擎）**

```ts
import { describe, it, expect } from 'vitest'
import { createReminderEngine } from '../src/engine'

describe('reminder engine', () => {
  it('到点触发一次并移除', async () => {
    const engine = createReminderEngine({ now: () => 1000 })
    const fired: string[] = []
    engine.subscribe('reminder/fired', (id) => fired.push(id))
    engine.schedule({ id: 'r1', at: 2000, text: '该休息了' })
    engine.tick(2000) // 时间推进到 2000
    expect(fired).toEqual(['r1'])
    expect(engine.pending()).toEqual([])
  })
  it('未到点不触发', async () => {
    const engine = createReminderEngine({ now: () => 1000 })
    const fired: string[] = []
    engine.subscribe('reminder/fired', (id) => fired.push(id))
    engine.schedule({ id: 'r1', at: 5000, text: 'x' })
    engine.tick(3000)
    expect(fired).toEqual([])
  })
})
```

- [ ] **Step 2: 实现引擎 + 工具 + 节点**（复用 M1 骨架；engine 用 `setInterval` 轮询 + `ctx.storage` 持久化）

- [ ] **Step 3: cron.ts（scheduled-tasks）** 写失败测试 → 实现 5 字段解析（`min hour dom mon dow`，支持 `*/n`、`a-b`、`a,b`、`*`），断言下一次触发时间。

- [ ] **Step 4: 注册进 profile + 端到端**

Run:
```bash
pnpm --filter @forge-studio/dsh-plugin-reminders build
pnpm --filter @forge-studio/dsh-plugin-scheduled-tasks build
pnpm dsh -- plugin --profile web add "D:/codes/dsh-desk-studio/packages/plugin-reminders"
pnpm dsh -- plugin --profile web add "D:/codes/dsh-desk-studio/packages/plugin-scheduled-tasks"
pnpm dev
```
Expected: `reminder_create 5 分钟后 提醒我喝水` → 会话出现提醒卡片，5 分钟后收到提醒消息；`task_schedule 每天 9:00 echo 打卡` → 卡片显示下次执行时间，到点触发。

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-reminders packages/plugin-scheduled-tasks
git commit -m "feat(m3): reminders and scheduled-tasks plugins"
```

---

### Task 11 (M4-1): profile-web 聚合 + 文档 + 全量验收

**Files:**
- Modify: `packages/profile-web/package.json`（填充 `dsh.profile` manifest，bundles 列出全部 5 个插件）
- Create: `packages/profile-web/README.md`
- Modify: `docs/superpowers/M0-VERDICT.md` → 更新为最终发布记录

**Interfaces:**
- Consumes: 全部 5 个插件包。
- Produces: 一个可 `dsh --profile <name>` 一键启动的聚合 profile。

- [ ] **Step 1: 聚合 profile**

把 Task 2 观察到的 profile 目录结构搬进 `packages/profile-web/`，`dsh.profile.bundles` 列出 `@deepseek-ai/dsh-base` + 5 个插件（路径指向本地包或发布后的 npm 包，见 Task 12 决定）。

- [ ] **Step 2: 全量验收清单**

在 README 记录并逐项核对：
1. 5 个功能在 web UI 各有一张设置卡片；
2. 每个功能都能被 agent 通过自然语言触发（工具可被调用）；
3. 每个功能在聊天流有可视化节点；
4. 重启 `pnpm dev` 后数据仍在（storage-json 持久化）；
5. `.dsh-home/` 整体删除后可重建（自包含）。

- [ ] **Step 3: Commit**

```bash
git add packages/profile-web docs/superpowers
git commit -m "feat(m4): aggregated profile-web and acceptance checklist"
```

---

### Task 12 (M4-2): 发布到 npm（需用户授权，单独执行）

**Files:**
- Modify: 各插件 `package.json`（`files` 字段收窄到 `lib/` + patch；确认 `prepublishOnly: pnpm build`）

**Interfaces:**
- Consumes: 全部插件包（已构建产物）。
- Produces: npm 上可安装的 `@forge-studio/dsh-plugin-*` 包。

- [ ] **Step 1: 与用户确认发布范围与 registry**（`npm publish` 属红线，必须停下询问；确认是否先 `pnpm pack` 做 dry-run）
- [ ] **Step 2: `pnpm pack` 本地验证 tarball 内容**（含 `lib/`、`cordis.patch.yml`、`dsh.client` manifest）
- [ ] **Step 3: 经用户批准后逐包 publish**（用官方 registry，不用镜像）
- [ ] **Step 4: 用一个全新空目录 + 官方 registry 安装验证 `dsh plugin --profile web add @forge-studio/dsh-plugin-notes` 可用**（证明真的发布成功、外部可安装）
- [ ] **Step 5: Commit 版本号 + 发布记录**

```bash
git add packages/*/package.json docs/superpowers
git commit -m "docs(m4): publish notes and release record"
```

---

## Self-Review

**1. Spec 覆盖：**
- F1 便签 → Task 5-8（service/tools/events/node/settings 完整闭环）✅
- F2 天气 / F3 翻译 → Task 9（provider seam 解耦）✅
- F4 提醒 / F5 定时任务 → Task 10（时间引擎 + cron）✅
- F7 设置 → 各插件 settings 卡片 + Task 2/11 的 profile 组装 ✅
- 北极星（真 dsh 插件、外部 bundle 贡献 client UI）→ Task 4 M0 实证 + Task 8 终版 ✅
- M0 fallback A/B → Task 4 Step 7 显式写死 ✅
- 风险（镜像延迟/版本锁定/存储复用/数据持久化）→ Global Constraints 第 3/4/6 条 ✅

**2. Placeholder 扫描：**
- 无 TBD/TODO；每步有真实命令 + 期望输出。Settings client 卡片的 `defineCard` API 标注了"以实证为准 + 退路"，属真实的不确定而非占位符（该 API 在 M0 已确认存在，具体导出名留现场核对）。

**3. 类型一致性：**
- 事件 key：`note/created|updated|deleted` 在 events.ts（Task 6）、definition match（Task 8）、service emit（Task 5）三处一致 ✅
- 节点 kind：`note-list` 在 definition、renderer key、ChatNodeDataMap key 三处一致 ✅
- 服务名 `ctx.notes` 在 service 声明合并、tools 注入、index 接线一致 ✅
- `ctx.agent.session.append` 在 emit 闭包与工具内一致 ✅
