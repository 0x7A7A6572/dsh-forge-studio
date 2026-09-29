/**
 * 侧栏入口主题的选择器。
 *
 * 只有一件事：在已注册的主题里选一个，写进 `display.theme`。
 *
 * 几个刻意的取舍：
 * - **下拉而不是候选卡片**：主题数量由用户放了几个主题目录决定（可能 1 个、可能 8 个），
 *   卡片列表会随主题变长而失控，下拉不会。
 * - **选项来自注册表实时订阅**（`useSyncExternalStore` 那个主题集合），不是设置里的枚举：
 *   主题目录增删之后列表自动跟着变，不需要重开设置页。
 * - **`value` 要对齐「实际渲染的是哪一个」**：设置里留着某个已不存在的主题 id 时，
 *   渲染侧已经回落到内置，下拉也必须显示内置 —— 否则用户看到的是"选了 X"，画的是内置。
 */
import { useCallback, useSyncExternalStore } from 'react'
import { BUILTIN_THEME_ID } from '../../../../shape/index.ts'
import type { ThemeRegistry } from '../../../core/theme-registry.ts'
import type { BillingScope } from '../../../core/config.ts'
import { ThemePromptPanel } from './ThemePromptPanel.tsx'
import styles from '../../../styles/settings-section.module.css'

export interface ThemePickerProps {
  scope: BillingScope
  /** 主题集合（`apply` 注入进来的那一张）。 */
  themes: ThemeRegistry
  /** 设置不可写时禁用（与其它控件同一个 locked 口径）。 */
  disabled: boolean
}

export function ThemePicker(props: ThemePickerProps): JSX.Element {
  const { scope, themes, disabled } = props
  const registered = useSyncExternalStore(themes.subscribe, themes.list)
  const stored = useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => scope.getSnapshot().value?.display?.theme ?? BUILTIN_THEME_ID,
  )
  // 存的 id 不在册（主题被删 / 目录改名）时，渲染侧已经回落到内置，这里跟着对齐。
  const value = registered.some((theme) => theme.id === stored) ? stored : BUILTIN_THEME_ID
  const onChange = useCallback((id: string) => {
    // 整段 display 一起写（与其它开关同姿态）：schema 会用 base 补齐没写的字段。
    void scope.set('display', { ...(scope.getSnapshot().value?.display ?? {}), theme: id })
  }, [scope])

  return (
    <div className={styles.themeRow}>
      <div className={styles.rowCopy}>
        <span className={styles.rowTitle}>侧栏入口主题</span>
        <p className={styles.rowDesc}>
          侧栏计费入口那一整块（峰谷、金额、今日、预算条）由「主题」画。
          这里列出已装的主题，选一个渲染；选中的主题被删掉或改名时会自动回到内置那条。
        </p>
      </div>
      <select
        className={styles.themeSelect}
        value={value}
        disabled={disabled}
        aria-label="侧栏入口主题"
        onChange={(event) => { onChange(event.currentTarget.value) }}
      >
        {registered.map((theme) => (
          <option key={theme.id} value={theme.id}>{theme.label}</option>
        ))}
      </select>
      {/* 「画成什么样」交给别的 AI 写：这里只负责把契约讲清楚、把话递出去。 */}
      <ThemePromptPanel />
    </div>
  )
}
