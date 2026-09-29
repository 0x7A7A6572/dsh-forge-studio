/**
 * 侧栏入口主题的选择器。
 *
 * 三件事：
 * - 在**当前可用**的主题里选一个，写进 `display.theme`；
 * - 把**装载失败**的主题列出来 —— 用户放了个文件却没生效，这里是唯一会说话的地方；
 * - 「画成什么样」的提示词交给 `ThemePromptPanel`。
 *
 * 选项来自主题集合的实时订阅，不是设置里的枚举：磁盘上加了主题、刷新页面之后，
 * 下拉自动跟着变。
 */
import { useCallback, useSyncExternalStore } from 'react'
import { BUILTIN_THEME_ID } from '../../../../shape/index.ts'
import type { Theme } from '../../../../shape/index.ts'
import type { ThemeRegistry } from '../../../core/theme-registry.ts'
import type { ThemeFailureStore } from '../../../core/themes/failures.ts'
import type { BillingScope } from '../../../core/config.ts'
import { useThemeFailures } from '../../../hooks/useThemeFailures.ts'
import { ThemePromptPanel } from './ThemePromptPanel.tsx'
import styles from '../../../styles/settings-section.module.css'

export interface ThemePickerProps {
  scope: BillingScope
  /** 主题集合（`apply` 注入进来的那一张）。 */
  themes: ThemeRegistry
  /** 装载失败列表，只读展示。 */
  failures: ThemeFailureStore
  /** 设置不可写时禁用（与其它控件同一个 locked 口径）。 */
  disabled: boolean
}

export function ThemePicker(props: ThemePickerProps): JSX.Element {
  const { scope, themes, failures, disabled } = props
  const registered = useSyncExternalStore(themes.subscribe, themes.list)
  const broken = useThemeFailures(failures)
  const stored = useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => scope.getSnapshot().value?.display?.theme ?? BUILTIN_THEME_ID,
  )
  // 存的 id 不在册（主题被删了 / 名字改了）时，渲染侧已经回落到内置，这里跟着对齐。
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
          侧栏计费入口那一整块（峰谷、金额、今日、预算条）由「主题」画。主题是
          <code>$DSH_HOME/themes/usage-billing/&lt;id&gt;/index.tsx</code> 里的一个文件，
          放进去刷新页面就会出现；选中项消失时自动回到内置。
        </p>
      </div>
      <select
        className={styles.themeSelect}
        value={value}
        disabled={disabled}
        aria-label="侧栏入口主题（实验）"
        onChange={(event) => { onChange(event.currentTarget.value) }}
      >
        {registered.map((theme: Theme) => (
          <option key={theme.id} value={theme.id}>{theme.label}</option>
        ))}
      </select>
      {broken.length === 0 ? null : (
        <ul className={styles.themeFailures}>
          {broken.map((failure) => (
            <li key={failure.id}>
              <code>{failure.id}</code>：{failure.reason}
            </li>
          ))}
        </ul>
      )}
      <ThemePromptPanel />
    </div>
  )
}
