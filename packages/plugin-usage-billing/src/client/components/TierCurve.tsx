/**
 * 今日费率带：一条 M 型的峰谷曲线 + 一个每分钟自己走的「现在」指针（长方形带状图）。
 *
 * 三处刻意的取舍：
 * - **自带分钟时钟**：BillingPopover 是纯展示的（不持有状态），指针得有人推。放在这个叶子组件里，
 *   每分钟只重渲染这一小块，不会让整张弹窗的金额跟着每 60 秒重排一次。
 * - **指针的位置与颜色分开算**：位置取自曲线的插值（斜坡上也压在线上），颜色取窗口判档 ——
 *   与宿主判档同口径，所以「点变蓝」与「账单按半价」永远同时发生。
 * - **文字一律用 HTML**：曲线靠 preserveAspectRatio="none" 拉到弹窗宽度，SVG 里的文字会被
 *   横向拉扁；所以刻度、标题、指针都是 HTML 元素（见 styles/settings-section.module.css）。
 */
import { useId } from 'react'
import { useRuleMinute } from '../hooks/useRuleMinute.ts'
import {
  AXIS_TICKS, CURVE_HEIGHT, CURVE_PLOT_HEIGHT, CURVE_WIDTH, areaPath, curveAriaLabel,
  curvePoints, curveTitleText, curveTones, curveYAt, linePath, nowText, toneAtMinute,
} from '../core/tier-curve.ts'
import type { TierDayProfile } from '../../pricing/tiers.ts'
import styles from '../styles/settings-section.module.css'

export interface TierCurveProps {
  /** 今日费率形状；调用方负责在它缺席（旧宿主 / 分时价未启用）时不渲染本组件。 */
  profile: TierDayProfile
}

export function TierCurve(props: TierCurveProps): JSX.Element {
  const profile = props.profile
  const minute = useRuleMinute(profile.utcOffsetMinutes)
  const points = curvePoints(profile)
  const tone = toneAtMinute(profile, minute)
  const left = (minute / CURVE_WIDTH) * 100 + '%'
  // 侧栏与输入框下方可能同时挂两个弹窗：渐变 / 蒙版的 id 必须各自唯一，否则后一个会覆盖前一个。
  // useId 的值带冒号（:r0:），而 url(#…) 里的它并不在所有浏览器里都稳，所以洗成纯标识符。
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const toneId = uid + 'tone'
  const fadeId = uid + 'fade'
  const maskId = uid + 'fade-mask'
  return (
    <div className={styles.tierCurve} data-dsh-ub-tier-curve>
      <div className={styles.tierCurveHead}>
        <span className={styles.tierCurveTitle}>{curveTitleText(profile)}</span>
        <span className={styles.tierCurveNow} data-tier={tone} data-dsh-ub-tier-now>{nowText(profile, minute)}</span>
      </div>
      <div className={styles.tierCurvePlot} style={{ height: CURVE_PLOT_HEIGHT }}>
        <svg
          className={styles.tierCurveCanvas}
          width="100%"
          height={CURVE_HEIGHT}
          viewBox={`0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={curveAriaLabel(profile, minute)}
        >
          <defs>
            {/* 横向按档位着色 + 纵向淡出：面积只做衬底，读数靠曲线。 */}
            <linearGradient id={toneId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={CURVE_WIDTH} y2="0">
              {curveTones(profile).map((stop, i) => (
                <stop
                  key={i}
                  offset={stop.offset}
                  className={styles.tierCurveStop}
                  data-tone={stop.tone}
                />
              ))}
            </linearGradient>
            <linearGradient id={fadeId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={CURVE_HEIGHT}>
              <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.12" />
            </linearGradient>
            <mask id={maskId}>
              <rect x="0" y="0" width={CURVE_WIDTH} height={CURVE_HEIGHT} fill={`url(#${fadeId})`} />
            </mask>
          </defs>
          <path
            className={styles.tierCurveArea}
            d={areaPath(points)}
            fill={`url(#${toneId})`}
            mask={`url(#${maskId})`}
          />
          {/* 非等比缩放会把描边横向拉粗，non-scaling-stroke 让它按设备像素画。 */}
          <path
            className={styles.tierCurveLine}
            d={linePath(points)}
            fill="none"
            stroke={`url(#${toneId})`}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* 指针：横向用百分比（跟着弹窗宽度走），纵向用 px（与 viewBox 1:1，不会被拉扁）。 */}
        <span
          className={styles.tierCurveGuide}
          data-tier={tone}
          style={{ left, height: CURVE_PLOT_HEIGHT }}
          aria-hidden="true"
        />
        <span
          className={styles.tierCurveDot}
          data-tier={tone}
          style={{ left, top: curveYAt(points, minute) }}
          aria-hidden="true"
        />
      </div>
      <div className={styles.tierCurveAxis}>
        {AXIS_TICKS.map((tick) => (
          <span
            key={tick}
            className={styles.tierCurveTick}
            data-edge={tick === 0 ? 'from' : tick === CURVE_WIDTH ? 'to' : undefined}
            style={{ left: (tick / CURVE_WIDTH) * 100 + '%' }}
          >
            {tick / 60}
          </span>
        ))}
      </div>
    </div>
  )
}
