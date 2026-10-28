/**
 * 置顶折角：可点击的便签右上角。折片用便签自身颜色（纸背同色），
 * 未置顶时悬停露出虚影提示，点击切换置顶；卡片主体按同一尺寸切角。
 */

import { useId } from 'react'
import styles from '../styles/notes-board.module.css'

export function PinnedCornerMark(props: {
  readonly pinned: boolean
  readonly color: string
  readonly size?: number
  readonly onToggle: () => void
}): JSX.Element {
  const size = props.size ?? 22
  const identity = useId().replace(/:/g, '')
  const gradientId = `fold-${identity}`
  const shadowId = `fold-shadow-${identity}`

  return (
    <button
      type="button"
      className={styles.pinCorner}
      data-pinned={props.pinned ? 'true' : 'false'}
      aria-label={props.pinned ? '取消置顶' : '置顶'}
      aria-pressed={props.pinned}
      title={props.pinned ? '点击取消置顶' : '点击置顶'}
      style={{ width: size, height: size }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onToggle()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        focusable="false"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1={size / 2}
            y1={size / 2}
            x2="0"
            y2={size}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#000000" stopOpacity="0.34" />
            <stop offset="0.55" stopColor="#000000" stopOpacity="0.12" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0.3" />
          </linearGradient>
          <filter id={shadowId} x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="-1" dy="1" stdDeviation="1.2" floodColor="#000000" floodOpacity="0.3" />
          </filter>
        </defs>
        <g className={styles.pinFlap}>
          <path
            d={`M0 0 L0 ${size} L${size} ${size} Z`}
            fill={props.color}
            filter={`url(#${shadowId})`}
          />
          <path d={`M0 0 L0 ${size} L${size} ${size} Z`} fill={`url(#${gradientId})`} />
          <path
            d={`M0 0 L0 ${size} L${size} ${size}`}
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.32"
            strokeWidth="0.8"
          />
          <path d={`M0 0 L${size} ${size}`} stroke="#000000" strokeOpacity="0.22" strokeWidth="1" />
        </g>
      </svg>
    </button>
  )
}
