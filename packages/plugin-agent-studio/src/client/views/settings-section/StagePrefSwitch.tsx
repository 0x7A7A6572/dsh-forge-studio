/**
 * 工作预览开关（设置页）：localStorage 持久化（core/stage-pref.ts），默认关闭（实验）。
 * 独立组件：AgentStudioSettings 本体保持 hook-free（渲染契约 spec 以纯函数方式调用它）。
 */
import { useSyncExternalStore } from 'react'
import { onStageChange, readStageEnabled, writeStageEnabled } from '../../core/stage-pref.ts'
import styles from './AgentStudioSettings.module.css'

export function StagePrefSwitch(): JSX.Element {
  const enabled = useSyncExternalStore(onStageChange, readStageEnabled, readStageEnabled)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="工作预览（实验）"
      className={`${styles.switch} ${enabled ? styles.switchOn : ''}`}
      onClick={() => writeStageEnabled(!enabled)}
    >
      <span className={styles.switchKnob} />
    </button>
  )
}
