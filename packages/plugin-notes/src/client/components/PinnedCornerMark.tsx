/**
 * 置顶角标：铺在容器右上角的直角三角（容器须 position: relative）。
 * 视觉语义 = 「置顶的便签把右上角折了起来」；颜色跟随便签环色（noteColorMeta.ring）。
 * 占位极小（默认 12px），不参与布局、不拦截点击/拖拽。
 */

/** 置顶直角三角角标。 */
export function PinnedCornerMark(props: {
  readonly color: string
  readonly size?: number
}): JSX.Element {
  const size = props.size ?? 12
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      focusable="false"
      style={{
        position: 'absolute',
        top: 3,
        right: 3,
        display: 'block',
        pointerEvents: 'none',
      }}
    >
      {/* 直角在容器右上角：两条直角边沿顶边与右边，斜边由内向角点斜切。 */}
      <polygon points={`0,0 ${size},0 ${size},${size}`} fill={props.color} />
    </svg>
  )
}
