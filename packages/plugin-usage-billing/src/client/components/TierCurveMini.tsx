/**
 * mini 峰谷图：侧栏计费入口卡**左侧**那一小块（75×35 CSS px）里的今日费率形状。
 *
 * 现在它是一个**12 小时钟盘**：一圈 12 小时、**一天转两圈**，12:00 与 00:00 都在正上方、
 * 顺时针一周；峰窗是两段琥珀弧，环上那一点就是此刻。几何一个数都不在这里算 ——
 * 全问 core/tier-curve.ts 要（`tierRing`）。
 *
 * 为什么从「平滑的 M 曲线」换成环：
 * - **对上时间点**。曲线版的横轴是注意力轴（深夜压扁），点的横向位置只是一个相对量；
 *   环上的角度就是时刻本身（12 小时一圈、每分钟 0.5°，与机械钟同一个读法），
 *   「现在在哪」是可以拿整点方位核对的读数。
 * - **75×35 里曲线读不出来**。24 个折点的精确形状塞进 75px，圆肩会被压成折角；
 *   环只有「弧在不在、点在不在弧上」两件事，缩到多小都成立。
 * - **与大图是同一把尺子**：双轨的横坐标就是分钟本身，环的角度是同一把尺子折成两圈
 *   （一圈 720 分钟 = 半天），两处读的是同一个时刻。
 *
 * 一处必须知道的取舍：**弧只画此刻那半天**。12 小时盘上同一条弧对应两个时刻
 * （09:00 与 21:00 落在同一格），一圈画不下两套弧 —— 所以 `tierRing(profile, minute)`
 * 把峰窗裁进当前这 12 小时再画。点与弧因此永远出自同一个半天，读数不可能错；
 * 代价是看不到另一半天的峰（那件事归弹窗大图）。
 *
 * 四处由尺寸与几何逼出来的差异（不是口味）：
 * - **画布是死尺寸 75×35**，不跟任何容器走：侧栏在 264–420px 之间变宽，图不该跟着变；
 *   大图那条 240px 是弹窗宽度的**因**，这里反过来，图是常量、卡吃剩下的宽度。
 *   viewBox 与容器**1:1**，所以与大图不同：不需要 preserveAspectRatio="none"，
 *   也不需要 vector-effect —— 环不会被拉扁，描边粗细就是 CSS 里那个数。
 * - **那颗珠子叠在 HTML 层上**（改主意了，原先是画在 SVG 里的）：点要的是 CSS 那套
 *   `radial-gradient` 粒子语法 —— 与大图那颗点**同一个配方**，改一处两处一起变。
 *   塞进 SVG 就得另建 `<defs><radialGradient>` 并给每个实例发一个 id，
 *   同一份配方抄两遍，迟早分叉。代价只是 `left/top` 要自己算：画布 1:1，
 *   `ring.point()` 给的就是像素，直接写进去，不存在百分比与 px 对不上的坑。
 * - **环上没有刻度，是一根普通粗环**。底环与峰弧用同一条 `stroke-width`（CSS 里那条
 *   并列选择器），合起来就是一根环的两段颜色，而不是「细底环 + 更粗的弧」。
 *   左上那一格的方位因此不再靠刻度核对，改由断言钉死（12:00 与 00:00 精准在正上方、
 *   06:00 与 18:00 精准在正下方）。
 * - **环上有两个字（高峰 / 空闲）**。这与旧版「75px 宽的带子塞任何刻度都只会更吵」相反，
 *   是环的几何逼出来的：曲线的高低自己会说贵不贵，而环上的弧只说明「哪些时段是峰」，
 *   此刻是峰是谷得看点在不在弧上 —— 两个字比让用户去比角度便宜得多。
 *   它同时在无障碍上顶一份：整块是 role="img" 的位图，读屏走 SVG 的 aria-label，
 *   与 hover tooltip 同一份文案（见 core/tier-curve.ts）。
 */
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  RING_CENTER_X, RING_CENTER_Y, RING_HEIGHT, RING_RADIUS,
  RING_TEXT_BASELINE, RING_TEXT_X, RING_WIDTH,
  curveAriaLabel, curveTitleText, nowText, tierRing,
} from '../core/tier-curve.ts'
import type { TierShapeSource, TierTone } from '../core/tier-curve.ts'
import styles from '../styles/settings-section.module.css'

export interface TierCurveMiniProps {
  /** 今日费率形状（契约的 `TierShapeData` 也满足它）；调用方负责在它缺席时不渲染本组件。 */
  profile: TierShapeSource
  /** 此刻：规则时区当日分钟。**由宿主注入** —— 时钟只有宿主那一个，形状不自己开。 */
  minute: number
  /** 此刻的画面档位。由调用方判好传进来，本组件不自己判档（否则两处判档会分叉）。 */
  tone: TierTone
}

export function TierCurveMini(props: TierCurveMiniProps): JSX.Element {
  const { profile, minute, tone } = props
  // 环是**此刻那半天**的：弧随 minute 换半天而整片换位（一天两圈，见 core/tier-curve.ts）。
  const ring = tierRing(profile, minute)
  const at = ring.point(minute)
  return (
    // 容器在 Tooltip **外面**（与大图同构）：75×35 的盒子才是 flex 行里的那一项，
    // 交给 Tooltip 去包就可能被它自己的包裹元素顶掉 flex: none。
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
            {/* 底色环 = 空闲价，一整天常驻；琥珀弧盖在它上面 = 高峰窗。两者同宽，合成一根普通粗环。 */}
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
