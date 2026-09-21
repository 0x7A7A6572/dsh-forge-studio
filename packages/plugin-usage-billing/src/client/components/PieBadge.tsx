/**
 * 小小的饼图：本月预算用了多少。
 *
 * 实心扇形（不是圆环）：14px 上圆环的线宽会吃掉一半直径，实心块一眼就能看出占比。
 * 底圆是中性的「总量」，扇形从 12 点方向顺时针铺开；没有预算口径时只画底圆，不假装 0%。
 * 它不进 a11y 树 —— 精确数值由同排文字与所在按钮的 aria-label 说全。
 */
import styles from '../styles/settings-section.module.css'

/** 圆半径：viewBox 16 的圆心 8，留 2px 边距不裁切。 */
const RADIUS = 6

export function PieBadge(props: {
  /** 已用比例 0..1；null = 没有预算口径，只画底圆。 */
  ratio: number | null
  level: 'ok' | 'warn' | 'over'
  /** 直径（px）：输入框那条是 14，侧栏收成 36px 时给大一号。 */
  size?: number
}): JSX.Element {
  const used = props.ratio === null ? 0 : Math.min(Math.max(props.ratio, 0), 1)
  // 扇形路径：从 12 点（8, 8-r）顺时针到当前角度，再连回圆心闭合成扇形。
  const endAngle = used * 2 * Math.PI - Math.PI / 2
  const wedge = used <= 0 || used >= 0.999
    ? null
    : `M 8 8 L 8 ${8 - RADIUS} A ${RADIUS} ${RADIUS} 0 ${used > 0.5 ? 1 : 0} 1 `
      + `${8 + RADIUS * Math.cos(endAngle)} ${8 + RADIUS * Math.sin(endAngle)} Z`
  return (
    <svg
      className={styles.pie}
      viewBox="0 0 16 16"
      width={props.size ?? 14}
      height={props.size ?? 14}
      aria-hidden="true"
      focusable="false"
    >
      <circle className={styles.pieTrack} cx="8" cy="8" r={RADIUS} />
      {used <= 0 ? null : used >= 0.999
        // 满圆走 circle（弧的两个端点重合时 path 画不出来），颜色仍是档位色。
        ? <circle className={styles.pieValue} data-level={props.level} cx="8" cy="8" r={RADIUS} />
        : <path className={styles.pieValue} data-level={props.level} d={wedge ?? ''} />}
    </svg>
  )
}
