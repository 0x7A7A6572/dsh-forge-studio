/**
 * 今日费率带：一条 M 型的峰谷曲线 + 一个每分钟自己走的「现在」指针（长方形带状图）。
 * 形状（含横轴压缩与过渡坡的缓动）全在 core/tier-curve.ts 里算，这里只负责摆。
 *
 * 四处刻意的取舍：
 * - **带子上不放常驻文字**：标题、时刻、刻度都不画 —— 240px 宽的带子塞五个刻度只会更吵，
 *   而「今天几点是峰」要看的是形状。文字挂到鼠标划入的 tooltip 上，读屏走 SVG 的
 *   aria-label（两者同一份文案，见 core/tier-curve.ts）。
 * - **自带分钟时钟**：BillingPopover 是纯展示的（不持有状态），指针得有人推。放在这个叶子组件里，
 *   每分钟只重渲染这一小块，不会让整张弹窗的金额跟着每 60 秒重排一次。
 * - **指针的位置与颜色分开算**：位置取自曲线的插值（斜坡上也压在线上），颜色取窗口判档 ——
 *   与宿主判档同口径，所以「点变蓝」与「账单按半价」永远同时发生。
 * - **文字一律走 HTML**：曲线靠 preserveAspectRatio="none" 拉到弹窗宽度，SVG 里的文字会被
 *   横向拉扁；所以 tooltip 用宿主 primitives 的 Tooltip（HTML 气泡），不在 SVG 里写 <text>。
 */
import { useId } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useRuleMinute } from '../hooks/useRuleMinute.ts'
import {
  CURVE_HEIGHT, CURVE_PLOT_HEIGHT, CURVE_WIDTH, curveAriaLabel, curveTitleText, nowText, tierCurve,
  toneAtMinute,
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
  const curve = tierCurve(profile)
  const tone = toneAtMinute(profile, minute)
  // 横轴是注意力轴（深夜压扁），所以位置一律问曲线要 —— 直接拿分钟除以 1440 会画错。
  const left = (curve.x(minute) / CURVE_WIDTH) * 100 + '%'
  // 侧栏与输入框下方可能同时挂两个弹窗：渐变 / 蒙版的 id 必须各自唯一，否则后一个会覆盖前一个。
  // useId 的值带冒号（:r0:），而 url(#…) 里的它并不在所有浏览器里都稳，所以洗成纯标识符。
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const toneId = uid + 'tone'
  const fadeId = uid + 'fade'
  const maskId = uid + 'fade-mask'
  return (
    <div className={styles.tierCurve} data-dsh-ub-tier-curve>
      {/* 时刻每分钟在变，所以 label 交给函数：气泡不显示时一次都不求值。 */}
      <Tooltip
        label={() => curveTitleText(profile) + ' · ' + nowText(profile, minute)}
        side="top"
        delayMs={200}
        portal
      >
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
                {curve.tones.map((stop, i) => (
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
              d={curve.area}
              fill={`url(#${toneId})`}
              mask={`url(#${maskId})`}
            />
            {/* 非等比缩放会把描边横向拉粗，non-scaling-stroke 让它按设备像素画。 */}
            <path
              className={styles.tierCurveLine}
              d={curve.line}
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
            style={{ left, top: curve.y(minute) }}
            aria-hidden="true"
          />
        </div>
      </Tooltip>
    </div>
  )
}
