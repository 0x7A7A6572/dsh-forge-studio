/**
 * 置顶折角：可点击的便签右上角。折片用便签自身颜色（纸背同色），
 * 未置顶时悬停露出虚影提示，点击切换置顶；卡片主体按同一尺寸切角。
 */

import { useEffect, useId, useState } from 'react'

export function PinnedCornerMark(props: {
  readonly pinned: boolean
  readonly color: string
  readonly size?: number
  readonly onToggle: () => void
  readonly onHoverChange?: (hover: boolean) => void
}): JSX.Element {
  const size = props.size ?? 22
  const identity = useId().replace(/:/g, '')
  const gradientId = `fold-${identity}`
  const shadowId = `fold-shadow-${identity}`
  const [hovered, setHovered] = useState(false)

  const setHover = (next: boolean): void => {
    setHovered(next)
    props.onHoverChange?.(next)
  }

  useEffect(() => {
    if (props.pinned) return
    setHovered(false)
    props.onHoverChange?.(false)
  }, [props.pinned, props.onHoverChange])

  const opacity = props.pinned ? 1 : hovered ? 0.42 : 0
  const scale = props.pinned ? (hovered ? 1.05 : 1) : hovered ? 0.92 : 0.6

  return (
    <button
      type="button"
      aria-label={props.pinned ? '取消置顶' : '置顶'}
      aria-pressed={props.pinned}
      title={props.pinned ? '点击取消置顶' : '点击置顶'}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setHover(false)
        props.onToggle()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        zIndex: 3,
        display: 'block',
        width: size,
        height: size,
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
      }}
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
        <g
          style={{
            opacity,
            transform: `scale(${scale})`,
            transformOrigin: '100% 0%',
            transition: 'opacity 160ms ease, transform 200ms cubic-bezier(0.22, 0.61, 0.36, 1)',
          }}
        >
          <path
            d={`M0 0 L0 ${size} L${size} ${size} Z`}
            fill={props.color}
            filter={`url(#${shadowId})`}
          />
          <path
            d={`M0 0 L0 ${size} L${size} ${size} Z`}
            fill={`url(#${gradientId})`}
          />
          <path
            d={`M0 0 L0 ${size} L${size} ${size}`}
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.32"
            strokeWidth="0.8"
          />
          <path
            d={`M0 0 L${size} ${size}`}
            stroke="#000000"
            strokeOpacity="0.22"
            strokeWidth="1"
          />
        </g>
      </svg>
    </button>
  )
}
