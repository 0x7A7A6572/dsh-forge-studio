/**
 * 主题契约的门禁：这份清单是**唯一来源**，三处漂移必须红。
 *
 * 1. 主题能 import 的裸模块必须是平台模块表的一个子集 —— 超出平台表就等于承诺了
 *    宿主模块表里没有的东西，主题会在 require 时炸。
 * 2. 契约里不该再有 service / 注册表：形状不再是插件。
 * 3. 宿主那份 require 表必须覆盖清单全部 —— 少一项 = 每个 import 它的主题都在
 *    运行时拿到一句「宿主没有提供这个模块」。
 *
 * 契约自己的两个纯函数（`toneAtMinute` / `clockText`）由 `entry-theme.spec.ts` 管：
 * 一个文件一个职责，别在两处逐字重复。
 */
import { describe, expect, it, vi } from 'vitest'
import { PLATFORM_MODULES } from '../scripts/tsdown.client.mjs'
import {
  BUILTIN_THEME_ID,
  SHAPE_SPECIFIER,
  THEME_ALLOWED_MODULES,
} from '../packages/plugin-usage-billing/src/shape/index.ts'
import { THEME_MODULE_MAP } from '../packages/plugin-usage-billing/src/client/hooks/theme-runtime.ts'

/**
 * `theme-runtime.ts` 在模块作用域 import 这份 UI 原子包，而它**只能在浏览器里**加载：
 * 上游把它自己的运行时依赖（`clsx` / `shiki` / `katex` …）声明成了 devDependency，产物
 * `lib/index.js` 里那句 `import 'clsx'` 在 node 里根本解析不出来（浏览器侧它来自宿主模块表，
 * 不走 node 解析）。本文件只查「require 表的**键**覆盖清单」，不碰那个实例，所以给个空壳
 * （vi.mock 会被提升到 import 之前，所以写在这里也拦得住）。
 *
 * 路径必须写成 node_modules 里的**相对路径**而不是裸包名：仓库根不依赖这个包，裸名字从
 * `scripts/` 解析不出 id，vi.mock 会挂在一个对不上的键上，等于没 mock（实测）。
 */
vi.mock(
  // 别「整理」成裸包名 '@deepseek-ai/dsh-client-ui-primitives'：仓库根不依赖它，从 scripts/
  // 解析不出 id，mock 会挂在错键上、静默失效（详见上方说明）。必须与 theme-runtime.ts 解析到同一个 id。
  '../packages/plugin-usage-billing/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js',
  () => ({}),
)

describe('主题允许的模块', () => {
  it('每一项都在平台模块表里，或是契约子路径本身', () => {
    const allowed = new Set<string>([...PLATFORM_MODULES, SHAPE_SPECIFIER])
    const extra = THEME_ALLOWED_MODULES.filter((name) => !allowed.has(name))
    expect(extra).toEqual([])
  })

  it('内置主题 id 仍是 builtin（设置里的默认值与回落值都指向它）', () => {
    expect(BUILTIN_THEME_ID).toBe('builtin')
  })

  it('宿主 require 表覆盖清单全部', () => {
    const missing = THEME_ALLOWED_MODULES.filter((name) => !(name in THEME_MODULE_MAP))
    expect(missing).toEqual([])
  })
})
