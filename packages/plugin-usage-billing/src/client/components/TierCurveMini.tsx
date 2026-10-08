import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  RING_CENTER_X, RING_CENTER_Y, RING_HEIGHT, RING_RADIUS,
  RING_TEXT_BASELINE, RING_TEXT_X, RING_WIDTH,
  curveAriaLabel, curveTitleText, nowText, tierRing,
} from '../core/tier-curve.ts'
import type { TierShapeSource, TierTone } from '../core/tier-curve.ts'
import styles from '../styles/settings-section.module.css'

export interface TierCurveMiniProps {
  profile: TierShapeSource
  /** 规则时区当日分钟，由宿主注入。 */
  minute: number
  tone: TierTone
}

export function TierCurveMini(props: TierCurveMiniProps): JSX.Element {
  const { profile, minute, tone } = props
  // 环是**此刻那半天**的：弧随 minute 换半天而整片换位（一天两圈，见 core/tier-curve.ts）。
  const ring = tierRing(profile, minute)
  const at = ring.point(minute)
  return (
    <span className={styles.miniRing} data-dsh-ub-curve-mini>
      <Tooltip
        label={() => curveTitleText(profile) + ' · ' + nowText(profile, minute)}
        side="top"
        delayMs={200}
        portal
      >
        <span className={styles.miniRingPlot}>
          <svg
            className={styles.miniRingCanvas}
            viewBox={`0 0 ${RING_WIDTH} ${RING_HEIGHT}`}
            role="img"
            aria-label={curveAriaLabel(profile, minute)}
          >
            <circle
              className={styles.miniRingTrack}
              cx={RING_CENTER_X}
              cy={RING_CENTER_Y}
              r={RING_RADIUS}
            />
            {ring.arcPaths.map((d, i) => (
              <path key={'arc' + i} className={styles.miniRingArc} d={d} />
            ))}
            <text
              className={styles.miniRingText}
              data-tier={tone}
              x={RING_TEXT_X}
              y={RING_TEXT_BASELINE}
            >
              {tone === 'peak' ? '高峰' : '空闲'}
            </text>
          </svg>
          {/*
            「现在」那颗珠子：**坐在环上**，不是把环挖个洞再塞进去。两层同色径向渐变
            叠出实心核 + 一圈晕（配方与大图那颗点一致，见 CSS 的 .miniRingDot）。
            画布 1:1，所以 point() 的坐标就是像素；尺寸与收尾百分比全在 CSS 里，
            可见半径 RING_DOT_REACH 由 spec 读回 CSS 核对。
          */}
          <span
            className={styles.miniRingDot}
            data-tier={tone}
            style={{ left: at.x, top: at.y }}
          />
        </span>
      </Tooltip>
    </span>
  )
}
