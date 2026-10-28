/**
 * 置顶角标：把卡片右上角画成折起的纸角（容器须 position: relative，
 * 置顶时卡片右上角同步改成直角）。大小随卡片缩放，不参与布局也不拦点击。
 */

import { useId } from 'react'

export function PinnedCornerMark(props: {
  readonly color: string
  readonly size?: number
}): JSX.Element {
  const size = props.size ?? 30
  const identity = useId().replace(/:/g, '')
  const gradientId = `fold-${identity}`
  const shadowId = `fold-shadow-${identity}`
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      focusable="false"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        display: 'block',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      <defs>
        <linearGradient id={gradientId} x1={size} y1="0" x2="0" y2={size} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.42" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.16" />
        </linearGradient>
        <filter id={shadowId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
      </defs>
      <path
        d={`M0 0 L${size} ${size}`}
        stroke="#000000"
        strokeOpacity="0.22"
        strokeWidth="2.4"
        filter={`url(#${shadowId})`}
      />
      <path d={`M${size} 0 H0 L${size} ${size} Z`} fill={`url(#${gradientId})`} />
      <path
        d={`M0 0 L${size} ${size}`}
        stroke={props.color}
        strokeOpacity="0.5"
        strokeWidth="1"
      />
    </svg>
  )
}
