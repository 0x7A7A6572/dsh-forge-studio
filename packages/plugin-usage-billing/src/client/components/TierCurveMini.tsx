/**
 * mini 峰谷图：侧栏计费入口卡**左侧**那一小块（75×35 CSS px）里的今日费率形状。
 *
 * 几何一个数都不在这里算 —— 形状全问 core/tier-curve.ts 要（`miniCurve`），与大图
 * （TierCurve，`tierCurve`）共用同一条注意力轴与同一套路径构造，但**折点不同**：
 * 这里是一条完全平滑的 M（峰窗不做平顶，只在窗口中点取一次顶；谷分三级深浅），
 * 理由见 core 里两张形状的说明。
 *
 * 四处由尺寸逼出来的差异（不是口味）：
 * - **画布是死尺寸 75×35**，不跟任何容器走：侧栏在 264–420px 之间变宽，图不该跟着变；
 *   大图那条 240px 是弹窗宽度的**因**，这里反过来，图是常量、卡吃剩下的宽度。
 * - **纵向口径是 mini 自己的**（MINI_CURVE_HEIGHT = 30，不是大图的 44）：大图那 44 单位里
 *   有 20 单位是边距，照搬到 35px 高就是 43% 的空白。所以 y 一律按 MINI_CURVE_HEIGHT 换算。
 * - **指针只有一颗点，没有竖线**（6px 点 + 1px 环）：竖线在小图里比曲线本身还抢眼，
 *   去掉后横向位置由点自己给；点比大图那颗相对更重（大图 8px，但画布是这里的三倍宽），
 *   75px 的带子里要一眼看见「现在」在哪。环仍然要留 —— 点压在同色的曲线上，
 *   没有这圈底色就看不见它。
 * - **不给读屏多一遍**：整块是 role="img" 的位图，读数走 SVG 的 aria-label，
 *   与 hover tooltip 同一份文案（见 core/tier-curve.ts）—— 这块上没有常驻文字，
 *   75px 宽的带子塞任何刻度都只会更吵。
 */
import { useId } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useRuleMinute } from '../hooks/useRuleMinute.ts'
import {
  CURVE_WIDTH, MINI_CURVE_HEIGHT, curveAriaLabel, curveTitleText, miniCurve, nowText, toneAtMinute,
} from '../core/tier-curve.ts'
import type { TierDayProfile } from '../../pricing/tiers.ts'
import styles from '../styles/settings-section.module.css'

export interface TierCurveMiniProps {
  /** 今日费率形状；调用方负责在它缺席（旧宿主 / 分时价未启用 / 开关关掉）时不渲染本组件。 */
  profile: TierDayProfile
}

export function TierCurveMini(props: TierCurveMiniProps): JSX.Element {
  const profile = props.profile
  // 自带分钟时钟：这块与大图各自每分钟重渲染自己，不连累对方（也不连累整张卡）。
  const minute = useRuleMinute(profile.utcOffsetMinutes)
  const curve = miniCurve(profile)
  const tone = toneAtMinute(profile, minute)
  // 横轴是注意力轴（深夜压扁），位置一律问曲线要 —— 拿分钟除以 1440 会画错。
  const left = (curve.x(minute) / CURVE_WIDTH) * 100 + '%'
  // 纵向同理：容器高度（35）不是 viewBox 高度（30），只有百分比与画布无关。
  const top = (curve.y(minute) / MINI_CURVE_HEIGHT) * 100 + '%'
  // 侧栏与输入框下方可能同时挂着别的曲线：渐变 / 蒙版的 id 必须各自唯一。
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const toneId = uid + 'tone'
  const fadeId = uid + 'fade'
  const maskId = uid + 'fade-mask'
  return (
    // 容器在 Tooltip **外面**（与大图同构）：75×35 的盒子才是 flex 行里的那一项，
    // 交给 Tooltip 去包就可能被它自己的包裹元素顶掉 flex: none。
    <span className={styles.miniCurve} data-dsh-ub-curve-mini>
      <Tooltip
        label={() => curveTitleText(profile) + ' · ' + nowText(profile, minute)}
        side="top"
        delayMs={200}
        portal
      >
        <span className={styles.miniCurvePlot}>
          <svg
            className={styles.miniCurveCanvas}
            viewBox={`0 0 ${CURVE_WIDTH} ${MINI_CURVE_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={curveAriaLabel(profile, minute)}
          >
            <defs>
              {/* 横向按档位着色 + 纵向淡出（面积只做衬底，读数靠曲线）—— 与大图逐字同款。 */}
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
              <linearGradient id={fadeId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={MINI_CURVE_HEIGHT}>
                <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
                <stop offset="1" stopColor="#fff" stopOpacity="0.12" />
              </linearGradient>
              <mask id={maskId}>
                <rect x="0" y="0" width={CURVE_WIDTH} height={MINI_CURVE_HEIGHT} fill={`url(#${fadeId})`} />
              </mask>
            </defs>
            <path
              className={styles.tierCurveArea}
              d={curve.area}
              fill={`url(#${toneId})`}
              mask={`url(#${maskId})`}
            />
            {/* preserveAspectRatio="none" 会把描边横向拉粗，non-scaling-stroke 让它按设备像素画。 */}
            <path
              className={styles.tierCurveLine}
              d={curve.line}
              fill="none"
              stroke={`url(#${toneId})`}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {/* 「现在」只用一颗点，不画竖线：75px 宽的图里竖线比曲线本身还抢眼。 */}
          <span
            className={styles.miniCurveDot}
            data-tier={tone}
            style={{ left, top }}
            aria-hidden="true"
          />
        </span>
      </Tooltip>
    </span>
  )
}
