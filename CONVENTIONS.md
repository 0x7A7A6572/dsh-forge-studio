# dsh-forge-studio 目录与命名约定

> 草案，待评审。本文只管「东西该放哪、文件该叫什么」，不管代码风格（那是 prettier/eslint 的活，尚未接入）。
>
> `CLAUDE.md` 里那几条硬性规则（一个功能一个包、依赖只指 Service Definition、持久化只走 `ctx.storage`）是上位规则，本文是它们的展开；冲突时以 `CLAUDE.md` 为准。

## 一条总规则：文件必须自报家门

不打开文件，光看路径就要能说出它是干什么的。做不到就改名。

现在仓库里反着来的例子：

| 路径 | 问题 |
|---|---|
| `client/views/parts.tsx` | parts 是什么的 parts？ |
| `client/views/components/kit.tsx` | kit 是什么？ |
| `client/views/ui-css.css` | 它给谁用的样式？ |
| `client/views/section.tsx` | 哪个 section？ |

## 一个页面怎么写：三件套

Vue 的 SFC 是**一个文件三个块**（`template` / `script setup` / `style scoped`）。React 没有 SFC，社区的标准做法是**一个文件夹三个文件** —— 同样是三块，只是摊开了：

```
client/views/settings-section/
├── SettingsSection.tsx          # 视图：只有 JSX
├── SettingsSection.module.css   # 样式：自动作用域（= style scoped）
├── useSettingsSection.ts        # 逻辑：state + 取数 + 动作
└── components/                  # 只属于这个页面的零件
    ├── MemoryCard.tsx
    └── MemoryCard.module.css
```

对应关系：

| Vue SFC | React |
|---|---|
| `<template>` | `SettingsSection.tsx` 里 `return` 的那段 |
| `<script setup>` | `useSettingsSection.ts` |
| `<style scoped>` | `SettingsSection.module.css`（CSS Modules） |
| `components/` | 同左 |
| **一个文件** | **一个文件夹** |

三条铁律：

1. **视图文件里不许有 `useState`、不许有 `await`、不许出现 `className="mem-xxx"` 这类字符串。**
2. **逻辑文件里不许出现一个 `<`。** 它是纯 TS，能单测，不用挂 DOM。
3. **样式与组件同目录同名**，靠 CSS Modules 自动加前缀，不用再手写 `mem-` / `ub-` 前缀防串台。

### 视图：`SettingsSection.tsx`

```tsx
import { MemoryCard } from './components/MemoryCard.tsx'
import { useSettingsSection } from './useSettingsSection.ts'
import styles from './SettingsSection.module.css'

export function SettingsSection(props: SettingsSectionProps): JSX.Element {
  const { records, busy, error, remove } = useSettingsSection(props.memory)

  return (
    <div className={styles.root}>
      <h2 className={styles.title}>记忆</h2>
      {error !== '' && <p className={styles.error}>{error}</p>}
      <ul className={styles.list}>
        {records.map((record) => (
          <MemoryCard key={record.id} record={record} busy={busy} onRemove={remove} />
        ))}
      </ul>
    </div>
  )
}
```

只有编排和 JSX。想知道「删一条会发生什么」？去 hook 里看。

### 逻辑：`useSettingsSection.ts`

```ts
import { useCallback, useEffect, useState } from 'react'
import type { MemoryRecord, MemoryStats } from '../../../types.ts'
import type { MemoryRemote } from '../../core/remote.ts'

/** 设置分区的全部状态与动作。视图只读返回值，自己永远不碰 remote。 */
export function useSettingsSection(memory: MemoryRemote) {
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [records, setRecords] = useState<readonly MemoryRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    const [s, r] = await Promise.all([memory.stats(), memory.list({ scope: 'global' })])
    if (s.ok) setStats(s.value)
    else setError(text(s.error))
    if (r.ok) setRecords(r.value)
    else setError(text(r.error))
  }, [memory])

  useEffect(() => { void refresh() }, [refresh])

  /** 所有写操作走这里：统一 busy / error，改完自动重拉。 */
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh()
    } catch (e) {
      setError(text(e))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const remove = useCallback(
    (id: string) => run(async () => {
      const result = await memory.removeMemory(id)
      if (!result.ok) throw new Error(text(result.error))
    }),
    [run, memory],
  )

  return { stats, records, busy, error, remove }
}
```

### 样式：`SettingsSection.module.css`

```css
.root { display: flex; flex-direction: column; gap: 12px; }
.title { margin: 0; font-size: 18px; font-weight: 600; }
.error { color: var(--dsw-alias-state-error-primary); }
.list { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
```

`.root` 编译后变成 `.SettingsSection_root` —— 这就是 `<style scoped>`。已在真实构建里验证 esbuild 原生支持（`loader: { '.module.css': 'local-css' }`，无需装插件），代价是 `build.mjs` 要改十来行把吐出的 CSS 注入 `<style>`。

### 页面大了怎么办

按**功能**竖着切，不是按类型横着切：

```
settings-section/
├── SettingsSection.tsx
├── SettingsSection.module.css
├── useSettingsSection.ts      # 只留编排
├── useMemoryDraft.ts          # 新增/编辑表单
├── useMemoryWiki.ts           # 实体 + 关联
└── components/                # 页面专属零件
```

`plugin-memory` 那个 1825 行的 `section.tsx` 正是长成了「一个组件里 27 个 state + 全部 handler + 全部 JSX」。按上面的切法会变成 **1 个视图文件 + 3 个 hook + 约 6 个零件组件**，每个都能单独读。

## 工具链（现在一个都没有）

```
prettier + .editorconfig              格式，零配置争议
eslint（flat config）
├── @eslint/js
├── typescript-eslint                 类型感知规则
├── eslint-plugin-react-hooks         ← 关键，见下
├── eslint-plugin-import-x            import 顺序
├── eslint-plugin-unicorn             文件名 / 一致性
└── eslint-config-prettier            关掉跟 prettier 打架的规则
```

**`eslint-plugin-react-hooks` 是上面那套拆分敢做的前提。** 它守两条：`rules-of-hooks`（hook 不能在条件里调）和 `exhaustive-deps`（依赖数组漏了立刻报）。没有它，把 state 和取数挪进 hook 就是裸奔 —— 这正是很多 React 项目"越拆越乱"的原因，不是拆分本身错，是没有护栏。

约定落到 lint 的映射：

| 约定 | 规则 |
|---|---|
| `core/` 不许 import react | `no-restricted-imports` |
| 组件文件 PascalCase、hook `use*` | `unicorn/filename-case`（按路径分别配） |
| 单文件尺寸红线 | `max-lines` |
| 视图文件里不许出现 state/await | 自定义规则或 `no-restricted-syntax`（可选，后加） |
| import 顺序 | `import-x/order` |

## 包的骨架

```
packages/plugin-<名字>/
├── src/
│   ├── index.ts         # host 插件入口（唯一）
│   ├── service.ts       # host 侧服务实现
│   ├── domain.ts        # 纯领域模型与规则（不碰 IO）
│   ├── types.ts         # 跨端共享类型
│   ├── settings.ts      # 配置 schema
│   ├── version.ts       # 版本常量
│   ├── <领域>/          # host 侧按领域切：sources/ pricing/ webdav/ …
│   ├── agent/           # 给模型的工具；tools.ts 是注册表，其余按功能拆
│   └── client/          # 浏览器侧，见下一节
├── tests/               # 与 src/ 同构：x.test.ts 测 x.ts
├── scripts/             # build.mjs / watch.mjs
├── assets/              # 只放不进 bundle 的图（README 配图）
└── cordis.patch.yml
```

`index / service / domain / types / settings / version` 这六个是**约定文件名**。四个插件已经是这么摆的，保持，别发明第七个。

## client 侧：五个区域

这是最需要统一的地方 —— 现在五个包五套摆法。

```
src/client/
├── index.ts       # client 插件入口（唯一）
├── core/          # 纯逻辑：计算、解析、取数、状态。不许 import react
├── hooks/         # 带 React 的逻辑：useXxx.ts
├── components/    # 展示组件：零件（按钮、卡片、图标、图表）
├── views/         # 页面级：一屏 / 一个页签 / 一个设置分区
├── styles/        # 插件级样式：*.css
├── assets/        # 要打进 bundle 的图（esbuild 内联，见 assets.d.ts）
└── *.d.ts         # 资源导入声明
```

**判据**（按顺序问自己）：

1. 会 import react 吗？不会 → `core/`
2. 会 import react，而且是在画东西吗？
   - 画的是整屏 / 整个页签 / 整个设置分区 → `views/`
   - 画的是零件 → `components/`
3. 会 import react，但不是画东西，是一段可复用的状态逻辑 → `hooks/`

**硬的**：

- `core/` 不许 import react。现在只有两处违反 —— `plugin-notes` 的 `core/panel-mount.ts` 和 `core/quick-add.ts`（都 import 了 `react-dom/client`）。它们干的事就是「往一个 DOM 节点上挂 React 树」，天然属于 `hooks/`。
- 只有 `views/` 和 `components/` 放 `.tsx`。`.ts` 文件里不许有 JSX。
- `index.ts` 只在区域根部做 barrel，不要再深一层。

## 样式文件放哪

1. **插件级样式**（整块 UI 共用一张表）→ `client/styles/<它作用的区域>.css`，注入函数放同目录同名 `.ts`。
2. **组件级样式** → 与组件同名同目录（`NoteCard.tsx` + `NoteCard.module.css`）。这条要等 CSS Modules 落地才启用，现在先不做。

现有的 `client/views/ui-css.{ts,css}` 属于第 1 类，位置不对 —— 样式不是 view。应挪到 `client/styles/`，并**按作用对象改名**。落地 CSS Modules 后它会被拆成每个组件旁边一份 `Xxx.module.css`；过渡期先叫 `settings-section.css`。

## 命名规则

| 东西 | 规则 | 例子 |
|---|---|---|
| **文件名 = 里面的主角名字** | 见下三行 | —— |
| 组件文件 | PascalCase，与导出的组件同名 | `NoteCard.tsx` 导出 `NoteCard` |
| 纯逻辑 / 工具 / 数据 | kebab-case | `board-filter.ts` |
| hook | `use` + PascalCase，与导出的 hook 同名 | `useSettingsSection.ts` 导出 `useSettingsSection` |
| 测试 | 与被测文件同名 | `board-filter.ts` → `board-filter.test.ts`；`NoteCard.tsx` → `NoteCard.test.tsx` |
| 图标（组件） | PascalCase + `Icon` 结尾 | `NavIcon.tsx` |
| 类型声明 | 按声明的资源名 | `css.d.ts`、`assets.d.ts` |

**禁用词**（文件名里出现即改名）：`parts` `kit` `utils` `helpers` `common` `misc` `shared`，以及单独用的 `section`。

`section` 单独用是模糊的。`plugin-usage-billing` 的那个已经叫 `settings-section.tsx` —— 语义对了，但按上面的规则大小写要跟导出的组件走，最终应该是一致的三份：`views/settings-section/` 文件夹里的 `SettingsSection.tsx`。

## 尺寸红线

- 单文件 > **400 行**要能说出理由，否则拆。
- 单个组件 > **200 行**通常意味着它既在画界面又在管状态 —— 把状态和取数挪进 `hooks/`。
- `core/` 单文件 > **300 行**通常意味着它干了不止一件事。

当前越线：`plugin-memory/src/client/views/section.tsx`（1825 行）、`plugin-memory/src/client/views/ui-css.css`（923 行）。

## 现状与约定的差距（照着改就行）

| 现在 | 改成 |
|---|---|
| `usage-billing/src/client/views/components/` | `usage-billing/src/client/components/` |
| `usage-billing/…/views/components/kit.tsx` | 拆开，按内容命名 |
| `{daily-log,memory}/src/client/views/section.tsx` | `client/views/settings-section/SettingsSection.tsx`（逻辑拆进同目录 hook） |
| `daily-log/src/client/views/parts.tsx` | `client/components/` + 按内容命名 |
| `{daily-log,memory}/src/client/views/nav-icon.tsx` | `client/components/NavIcon.tsx` |
| `{daily-log,memory,usage-billing}/…/views/ui-css.{ts,css}` | `client/styles/SettingsSection.module.css`（或过渡期 `client/styles/settings-section.css`） |
| billing `views/` 里的零件（chart / heat-chart / trend-chart / entry-card / backfill-notice / echarts-runtime） | `client/components/` |
| `notes/src/client/core/panel-mount.ts`、`core/quick-add.ts` | `client/hooks/` |
| `home-studio/src/client/icons.ts` | 看内容：图标组件 → `components/`；图标数据 → `core/` |
| `daily-log/.pubclean/`（遗留空目录） | 删掉 |
| `memory/src/client/views/section.tsx` 只有 1 个组件在 `components/` | 拆分后 `components/` 才有意义 |

**图片放哪的规则**（现在三种混用）：

- 要进 bundle 的图 → `src/client/assets/`（esbuild 内联成 dataurl，见 `assets.d.ts`）。例：`notes/src/client/assets/note-flow-banner.webp`
- README 配图 / 文档截图 → 包根 `assets/`。例：`daily-log/assets/report-result.png`

## 以后能变成 lint 规则的

这份文档如果不落到 lint 里，半年后又会漂。以下规则可以机械化，等 eslint 接入时一并加：

| 约定 | 对应的 lint 规则 |
|---|---|
| `core/` 不许 import react | `no-restricted-imports`（按路径 group 覆盖） |
| 组件 PascalCase / hook camelCase / 其余 kebab | `unicorn/filename-case`（按目录分别配） |
| 禁用词 | `no-restricted-syntax` / 自定义规则 |
| 组件文件与导出同名 | `react/consistent-component-name`（部分） |
| 尺寸红线 | `max-lines` |
| import 顺序 | `import-x/order` |

## 没变的部分

以下现在就是对的，别动：

- host 侧六个约定文件名（`index/service/domain/types/settings/version`）。
- `agent/` 作为「给模型的工具」的固定位置。
- `client/core/` 与 `client/views/` 这组划分本身（只是要补 `hooks/`、`components/`、`styles/`，并把 `core/` 的纯度守住）。
- 纯逻辑文件 kebab-case（`board-filter.ts`）、组件 PascalCase（`NoteCard.tsx`）。
- 构建产物 `lib/` 已被 `.gitignore` 忽略，不用管。
