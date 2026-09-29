/**
 * 侧栏入口形状的选择器。
 *
 * 只有一件事：在已注册的形状里选一个，写进 `display.tierShape`。
 *
 * 几个刻意的取舍：
 * - **下拉而不是候选卡片**：形状数量由用户装了几个插件决定（可能 1 个、可能 8 个），
 *   卡片列表会随形状变长而失控，下拉不会。
 * - **选项来自注册表实时订阅**（`useSyncExternalStore` 那个形状集合），不是设置里的枚举：
 *   形状插件装卸之后列表自动跟着变，不需要重开设置页。
 * - **`value` 要对齐「实际渲染的是哪一个」**：设置里留着某个已被停用形状的 id 时，
 *   渲染侧已经回落到内置，下拉也必须显示内置 —— 否则用户看到的是"选了 X"，画的是内置。
 */
import { useCallback, useSyncExternalStore } from 'react'
import { BUILTIN_THEME_ID } from '../../../../shape/index.ts'
import type { ThemeRegistry } from '../../../core/tier-shape-registry.ts'
import type { BillingScope } from '../../../core/config.ts'
import { ShapePromptPanel } from './ShapePromptPanel.tsx'
import styles from '../../../styles/settings-section.module.css'

export interface ShapePickerProps {
  scope: BillingScope
  /** 主题集合（`apply` 注入进来的那一张）。 */
  shapes: ThemeRegistry
  /** 设置不可写时禁用（与其它控件同一个 locked 口径）。 */
  disabled: boolean
}

export function ShapePicker(props: ShapePickerProps): JSX.Element {
  const { scope, shapes, disabled } = props
  const registered = useSyncExternalStore(shapes.subscribe, shapes.list)
  const stored = useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => scope.getSnapshot().value?.display?.tierShape ?? BUILTIN_THEME_ID,
  )
  // 存的 id 不在册（主题被删 / 目录改名）时，渲染侧已经回落到内置，这里跟着对齐。
  const value = registered.some((shape) => shape.id === stored) ? stored : BUILTIN_THEME_ID
  const onChange = useCallback((id: string) => {
    // 整段 display 一起写（与其它开关同姿态）：schema 会用 base 补齐没写的字段。
    void scope.set('display', { ...(scope.getSnapshot().value?.display ?? {}), tierShape: id })
  }, [scope])

  return (
    <div className={styles.shapeRow}>
      <div className={styles.rowCopy}>
        <span className={styles.rowTitle}>侧栏入口形状</span>
        <p className={styles.rowDesc}>
          侧栏计费入口那一整块（峰谷、金额、今日、预算条）由「形状」画。
          这里列出已装的形状，选一个渲染；选中的插件被停用或卸载时会自动回到内置那条。
        </p>
      </div>
      <select
        className={styles.shapeSelect}
        value={value}
        disabled={disabled}
        aria-label="侧栏入口形状"
        onChange={(event) => { onChange(event.currentTarget.value) }}
      >
        {registered.map((shape) => (
          <option key={shape.id} value={shape.id}>{shape.label}</option>
        ))}
      </select>
      {/* 「画成什么样」交给别的 AI 写：这里只负责把契约讲清楚、把话递出去。 */}
      <ShapePromptPanel />
    </div>
  )
}
