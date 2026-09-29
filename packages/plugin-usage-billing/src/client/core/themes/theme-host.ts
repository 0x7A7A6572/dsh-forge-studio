/**
 * 主题 ABI 的宿主侧：产物末尾自调的 `define`，以及主题源码里 `require` 走的那个口子。
 *
 * 两条硬规则：
 * - **`define` 不许抛**。产物是经典 `<script>`，抛出去只会变成 `window.onerror`，
 *   装载器看不见、用户在设置页也看不到原因。所以校验失败走 `onRejection`，不是异常。
 * - **`require` 只认传进来的那张表**。表由 `hooks/theme-runtime.ts` 用宿主自己的
 *   import 组装 —— 这是「主题里的 React 与宿主是同一个实例」的唯一保证。
 */
import type { ComponentType } from 'react'
import type { Theme, ThemeProps } from '../../../shape/index.ts'

/** 挂在 `globalThis` 上的名字。host 侧 `src/themes/transpile.ts` 把它写进产物。 */
export const THEME_HOST_KEY = '__usageBillingThemeHost'

export interface ThemeHost {
  require(specifier: string): unknown
  define(id: string, theme: unknown): void
}

/** 主题自报的那份 `theme` 合不合法；不合法给出给用户看的原因。 */
export function themeRejection(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return '主题文件没有 `export const theme = …`'
  const theme = value as { label?: unknown; component?: unknown }
  if (typeof theme.label !== 'string' || theme.label.trim() === '') return 'theme.label 必须是非空字符串'
  if (typeof theme.component !== 'function') return 'theme.component 必须是组件函数'
  return undefined
}

export interface InstallThemeHostOptions {
  /** 通常就是 `globalThis`；测试里给一个普通对象。 */
  readonly target: Record<string, unknown>
  /** `specifier → 模块实例`。键必须覆盖契约里的 `THEME_ALLOWED_MODULES`。 */
  readonly modules: Readonly<Record<string, unknown>>
  /** 校验通过的主题。`id` 来自产物里写死的那一个（主题改不了）。 */
  readonly onTheme: (theme: Theme) => void
  /** 校验失败：记下来给设置页看。 */
  readonly onRejection: (id: string, reason: string) => void
}

/** 装宿主。返回卸载函数（只在那一格还是自己时删）。 */
export function installThemeHost(options: InstallThemeHostOptions): () => void {
  const allowed = Object.keys(options.modules)
  const host: ThemeHost = {
    require(specifier) {
      if (!Object.hasOwn(options.modules, specifier)) {
        throw new Error(
          `主题 import 了宿主没有提供的模块 "${specifier}"（可用：${allowed.join(' / ')}）`,
        )
      }
      return options.modules[specifier]
    },
    define(id, theme) {
      const reason = themeRejection(theme)
      if (reason !== undefined) {
        options.onRejection(id, reason)
        return
      }
      const value = theme as { label: string; component: ComponentType<ThemeProps> }
      options.onTheme({ id, label: value.label, component: value.component })
    },
  }
  options.target[THEME_HOST_KEY] = host
  return () => {
    if (options.target[THEME_HOST_KEY] === host) delete options.target[THEME_HOST_KEY]
  }
}
