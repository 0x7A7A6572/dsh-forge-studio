/**
 * 置顶角标：卡片右上角向内折下的纸角。容器须 position: relative；
 * 卡片本体按同一尺寸用 clip-path 切掉右上三角，这里只画折片、折痕与投影。
 */

import { useId } from 'react'

export function PinnedCornerMark(props: {
  readonly color: string
  readonly size?: number
}): JSX.Element {
  const size = props.size ?? 22
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
        <linearGradient
          id={gradientId}
          x1={size / 2}
          y1={size / 2}
          x2="0"
          y2={size}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#000000" stopOpacity="0.26" />
          <stop offset="0.5" stopColor="#000000" stopOpacity="0.1" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.32" />
        </linearGradient>
        <filter id={shadowId} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="-1" dy="1" stdDeviation="1.2" floodColor="#000000" floodOpacity="0.34" />
        </filter>
      </defs>
      <path
        d={`M0 0 L0 ${size} L${size} ${size} Z`}
        fill={`url(#${gradientId})`}
        filter={`url(#${shadowId})`}
      />
      <path
        d={`M0 0 L0 ${size} L${size} ${size}`}
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.22"
        strokeWidth="0.8"
      />
      <path d={`M0 0 L${size} ${size}`} stroke={props.color} strokeOpacity="0.55" strokeWidth="1" />
    </svg>
  )
}
