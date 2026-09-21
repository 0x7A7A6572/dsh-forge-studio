/** 渠道小标：Git / DSH / Claude / Codex，命中即亮，未命中压暗。 */
import { CHANNEL_LABELS, NO_CHANNELS, SOURCE_KINDS } from '../../types.ts'
import type { ProjectChannels } from '../../types.ts'
import styles from '../styles/settings-section.module.css'

export function ChannelChips(props: { channels: ProjectChannels | undefined }): JSX.Element {
  const channels = props.channels ?? NO_CHANNELS
  return (
    <span className={styles.chips}>
      {SOURCE_KINDS.map((kind) => (
        <span
          key={kind}
          className={channels[kind] ? styles.chip + ' ' + styles.chipOn : styles.chip}
          title={CHANNEL_LABELS[kind] + (channels[kind] ? '：该路径下有活动' : '：该路径下暂无活动')}
        >
          {CHANNEL_LABELS[kind]}
        </span>
      ))}
    </span>
  )
}
