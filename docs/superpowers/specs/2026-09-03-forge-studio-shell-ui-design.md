# Forge Studio 插件工程化：共享层 + 壳插件 设计

日期：2026-09-03
状态：设计已通过分节评审，待用户 review 本文件后进入实施计划（writing-plans）。

## 1. 背景与目标

dsh-desk-studio 用 dsh 插件范式重做 Forge Studio 功能（便签/天气/翻译/提醒/定时任务/设置），现状是
`packages/plugin-notes` 已跑通、`packages/plugin-home-studio` 是空骨架。发现的问题：

1. 每个插件各自注册宿主 `shell.overlay` 全屏浮层 + 各自侧栏入口，N 个浮层并存会互相叠盖，
   开关/层级/ESC/遮罩逻辑各写一遍，观感靠手抄宿主 `--dsw-*` 令牌维持。
2. 无共享层：`theme-tokens.ts` 这类令牌手抄在插件里；插件之间禁止运行时依赖（CLAUDE.md 规则），
   也没有"唯一允许的共享包"这一说。
3. 构建脚手架（build.mjs/watch.mjs/tsconfig）每插件复制一份，同一套逻辑多处漂移。
4. 用户原设想（shadcn 基础组件 / 全局 store（类 pinia）/ 全局样式覆盖 / F-key 快捷键 / 启动台）经
   调研与逐节评审后全部撤回：宿主已提供官方组件库与令牌体系，官方 `dsh-client-store` 即 zustand+immer
   引擎，插件按需 define 即可，不需要再引第三方或造壳上壳下冗余层。

目标：**精简但工程化的插件结构**——共享层职责极薄（令牌汇总 + 契约），一个"壳"插件统一承载
面板浮层与切换，功能插件保持独立可卸载，构建与类型配置不再复制粘贴。

## 2. 已锁定决策

| 项 | 决策 |
| --- | --- |
| 组件基础 | 官方 `@deepseek-ai/dsh-client-ui-primitives`（宿主单例平台模块，构建自动外部化），不引 shadcn/Tailwind |
| 令牌 | 官方 `--dsw-*` CSS 变量，明暗主题自动适配 |
| 状态 | 不设统一全局 store、不引第三方；壳与各插件按需用官方 `dsh-client-store` 引擎 define |
| 全局样式覆盖 | 不做（撤回）；插件本地 CSS 维持现状 |
| 快捷键 | 不做，入口全部是按钮 |
| 入口形态 | 功能插件各自注册宿主侧栏按钮（现状模式），点击调壳契约桥打开对应面板 |
| 切换语义 | 单活动面板：`{ open, active }`；再点当前按钮 = 关闭（toggle） |
| 壳↔面板接线 | 内容经壳声明的 `forge.panel` 槽位终端（slots 宿主单例注册表）；打开/关闭请求经 window 契约桥（薄、两个方法） |
| 共享包内容 | `packages/ui` 只装 tokens 汇总 + 契约（类型/常量），不 re-export、不包装官方组件 |
| 本轮范围 | 全套：ui 包 + 壳化 home-studio + notes 迁移示范 + 公共构建/tsconfig + 规则与文档修订 |

## 3. 目标架构

```
宿主 dsh web
├─ shell.overlay 终端          ← 壳注册唯一浮层条目（forge-shell）
│   └─ plugin-home-studio（壳） 遮罩 + 统一关闭按钮 + forge.panel 容器
│       （壳不持有面板清单元数据：面板名等由各面板自绘 header 呈现）
│       ├─ forge.panel: notes   ← plugin-notes 登记的面板内容（!active 时 return null）
│       └─ forge.panel: <未来插件>
├─ sidebar.footer.action 终端   ← 各功能插件各自注册入口按钮（现状模式不变）
└─ window.__forgeStudio__ 契约桥 ← 壳安装：openPanel(key)/closePanel()；按钮 onClick 调用
```

关键不变式：

- `shell.overlay` 的浮层条目**只有一个**（壳的），消除多浮层叠盖；壳 store 无活动面板时浮层
  `return null`（复用 notes 现有的"open=false 不渲染"模式）。
- 功能插件**不再注册** `shell.overlay`，只登记 `forge.panel:<key>` 面板 + 保留自己的侧栏按钮。
- 壳不知道面板清单：活动面板的 key 由按钮（插件侧）通过契约桥传入；面板内容是否渲染由其自己
  收到注入 face `{ active }` 决定（`active=false` 时 `return null` 且不得发起副作用/轮询）。
- 卸载任意功能插件（宿主插件管理）→ 其侧栏按钮与 `forge.panel` 注册随 cordis 生命周期自动清理，
  壳正常工作（热插拔不依赖任何具体插件）。

## 4. packages/ui（@forge-studio/ui）

纯 client、Cordis-free、React 18。仅两个出口，均无运行时宿主依赖（类型/常量级）：

- `src/theme/tokens.ts`：官方 `--dsw-*` 令牌汇总。上收并补全 notes 现有 `theme-tokens.ts`
  （mask/surface/border/label/interactive/button/语义色/阴影等别名常量），成为所有插件唯一取色入口；
  notes 迁移后删除本地副本改引 ui。
- `src/contract/panel.ts`：
  - `PanelKey = 'notes' | ...`（string 约束，新增插件扩展）；
  - 桥接口 `PanelBridge { openPanel(key: PanelKey): void; closePanel(): void }` 与
    window 挂载点常量（`window.__forgeStudio__` 类型增广）；
  - `forge.panel` 槽位契约：SlotMap 增广（`declare module '@deepseek-ai/dsh-client-ui-slots'`），
    面板条目注入 face 类型 `{ active: boolean }`，消费方 `import type {} from '@forge-studio/ui'` 生效。
- package.json：devDeps react/react-dom/@types/官方 slots 类型包；tsup 构建（react external）产出
  lib + types；`exports` 提供 `.`（tokens/contract 合并入口）。

注意：ui 包**不** re-export 官方 primitives、**不**包装组件、**不**含样式/样式注入工具
（YAGNI：当前唯一消费者 notes 没有跨插件重复的组合件；出现第二个消费者且真有重复时再抽）。

## 5. 壳 plugin-home-studio（职责重定位）

保留包名，职责从"F1–F7 入口编排骨架"改为"Forge Studio 面板壳"：

1. **client 侧新增**：
   - `shell-overlay.tsx`：`ctx.slots.inject('shell.overlay', …)` 注册唯一浮层条目；
     组件内 subscribe 壳 store：`open=false → return null`；否则渲染遮罩 + 极薄统一
     chrome（仅关闭按钮，官方 primitives；面板名等元数据由各面板自绘 header 呈现，
     壳不持有面板清单）+ `forge.panel` 容器（渲染所有登记面板，传 face
     `{ active: activeKey === 面板key }`）。
   - `panel-store.ts`：用官方 `dsh-client-store` 引擎（zustand vanilla + immer 封装）定义
     `{ open: boolean; active: PanelKey | null }` 与 open/toggle/close 动作；
     单活动面板切换（决策 T1）。
   - `bridge.ts`：apply 时安装 `window.__forgeStudio__`（openPanel → store.open+active；
     closePanel → store.close）；卸载时清理。
   - ESC：壳浮层统一监听并关闭（面板内部弹窗的 ESC 由其自行 stopPropagation，语义与 notes
     现状"先关弹窗再关浮层"一致——实现细节见第 7 节迁移）。
2. **host 侧骨架不变**（cordis.patch.yml / 空 apply 保留）；删除/搁置原"F1–F7 编排"占位内容
   （`client/icons.ts` 等按需清理），README/description 更新。
3. devDeps 增加：react/react-dom/lucide-react/官方 ui-slots、ui-renderer、ui-primitives、
   dsh-client-store、@forge-studio/ui(workspace:*)。

## 6. 公共脚手架（消除复制粘贴）

- 根 `scripts/plugin-build.mjs`：从 plugin-notes 的 build.mjs 泛化——参数为包路径与 client 入口，
  内置 PLATFORM_MODULES/INJECT_MODULES 外部化、`.css` text loader、closure-factory 包装、
  tsc emit types + tsup host 三段逻辑（以 notes 现有实现为准抽取）。
- 各插件 `scripts/build.mjs`/`watch.mjs` 变薄壳，调公共脚本；tsconfig 从公共
  `tsconfig.base.json`（root 新增，收拢 lib/target/strict/jsx 等公共项）继承。
- CLAUDE.md 规则修订：依赖约束追加"**+ @forge-studio/ui（唯一共享 client 包）**"；
  保留"client 对跨插件值 type-only import"，并注明壳↔面板仅经 `forge.panel` 槽位与契约桥接触。
- 各包 README 职责描述同步更新。

## 7. notes 迁移示范（接线改壳，内容基本保留）

按"最小行为破坏"拆：

1. `client/index.ts`：删 `shell.overlay` 注册；保留侧栏按钮注册，按钮改为
   `bridge.openPanel('notes')`（toggle：已开且 active=notes 时 closePanel）；
   新增 `slots.register({ name: 'forge.panel', id: 'notes', … }, NotesBoardPanel)`，
   注入 face 增加壳的 `{ active }`。
2. `views/board-overlay.tsx` → 拆分：整屏遮罩/定位/ESC/浮层级关闭（X）职责移交壳；
   notes 保留"便签板内容"（工具栏/搜索/色筛/列表/归档/编辑器/设置弹窗）与其自绘
   header（标题/计数/刷新/设置；去掉原浮层级 X 与整屏遮罩样式，避免与壳 chrome 重复）。
   `board-store.ts` 的 open 标志删除（open 归壳 store）；面板副作用（拉取/5s 轮询）以
   `active` 为门（`!active → return null` 且不启动 effect）。
3. 样式：主题令牌改引 `@forge-studio/ui` tokens（删本地 `theme-tokens.ts`）；纸卡
   pastel 色（便签语义）保留不动；其余 `--dsw-*` 引用不变。
4. `tests/*`：更新 apply 测试（断言注册目标从 shell.overlay 变为 forge.panel + 侧栏按钮
   调用契约桥）。client 侧手工验收为主（见第 9 节）。

## 8. 落地顺序（对应实施计划阶段）

1. ui 包（tokens 上收 + contract + SlotMap 增广 + 构建/tsconfig 公共化配套搭好样板）
2. 壳化 home-studio（store/浮层/顶部条/forge.panel 容器/契约桥）
3. notes 迁移接线 + 面板拆分 + 测试更新
4. CLAUDE.md/README 修订；`pnpm dev` 全量验收

## 9. 验收标准

- `pnpm install && pnpm dev`（DSH_HOME=.dsh-home, profile web）可起。
- 宿主侧栏点「便签」→ 壳浮层打开便签板；再点「便签」/ESC/顶部 X → 关闭无残留；
  明暗主题切换观感正常（令牌随宿主）。
- 在宿主插件管理中卸载 notes：侧栏入口与面板消失，壳自身无报错、可继续承载其他面板。
- `pnpm test`（workspace vitest）与各包 typecheck 通过。

## 10. 风险与实施期待验证点

- `forge.panel` 槽位的精确实现机制（ui-slots 的 register/inject/渲染 API、SlotMap 增广跨包
  生效方式、keyed 与 list 语义选择）以宿主 `@deepseek-ai/dsh-client-ui-slots` /
  `dsh-client-ui-renderer` 源码为准；设计目标（面板经槽位进壳、active 门控、热插拔自动清理）
  不变，渲染细节（list+inject active 或按 key 渲染）在实施计划里定。
- 官方 store 引擎 `defineStore` 的准确用法（store seat / slots 绑定关系）以
  `dsh-client-store` 类型与宿主用法为准；壳 store 如不适合直接 defineStore 则退回
  引擎底层（createStore + subscribe），对外仍是官方引擎。
- `shell.overlay` 终端的遮罩点击穿透契约（notes 现状注释提到）须在壳浮层复刻，避免破坏宿主交互。
- 侧栏 footer 空间：未来 5+ 个功能都挤宿主侧栏入口，属 UX 问题，本轮不解决，仅记录。
