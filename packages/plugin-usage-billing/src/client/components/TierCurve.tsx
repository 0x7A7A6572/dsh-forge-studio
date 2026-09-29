/**
 * 今日费率带（**落差光场 · 发丝亮芯**）：上轨 = 高峰价、下轨 = 空闲价，外加一个每分钟自己走的「现在」点。
 *
 * 形状（块的划分、坐标、渐变停点）全在 core/tier-curve.ts 里算，这里只负责摆。
 *
 * 七处刻意的取舍：
 * - **价格是阶跃的，就画成阶跃**：09:00 那一秒价格翻倍，画成斜坡是在说谎。所以这里没有曲线，
 *   只有「哪一段亮在哪条轨上」；两轨之间那片光场的浓淡就是「半价」本身。
 * - **落差光场是主角**：它画的不是某一段，而是两级价之间那段落差 —— 全天常驻，
 *   所以「另一档在哪」不需要靠一段活动块来提示，凌晨那条带子也不会退化成一根孤零零的蓝条。
 * - **亮芯只该是一根线，不该是一团雾**：档位 = 「光场 + 一根细芯 + 一层弥散」。
 *   试过把档位做成四层同心描边叠出的柔光（没有硬边），结果段与段的边界反而糊了 ——
 *   四层叠加把没亮的轨也抬起来，亮的那段就没那么突出了。光场负责面积，芯负责读数，各管一头。
 * - **芯的浓淡沿一天走，边界不跟着淡**：渐变横跨整天（正午最亮、两头压暗），
 *   而不是每段一条 —— 每段一条必然让每段两端自己淡下去，边界就跟着糊了。
 * - **落差光柱只画在「现在」**：它是这一刻的读数（离另一档有多远），不是装饰。
 *   在峰上画实（你正付全价），在谷里画虚 —— 虚实与档位同源。
 * - **带子上不放常驻文字**：标题、时刻、刻度都不画 —— 240px 宽的带子塞五个刻度只会更吵。
 *   文字挂到鼠标划入的 tooltip 上，读屏走 SVG 的 aria-label（两者同一份文案，见 core/tier-curve.ts）。
 *   「现在」那颗点仍然用 HTML 定位（见 .tierRailDot）：SVG 被 preserveAspectRatio="none"
 *   横拉到弹窗宽度，画在里面的圆会被横向压扁。
 * - **自带分钟时钟**：BillingPopover 是纯展示的（不持有状态），指针得有人推。放在这个叶子组件里，
 *   每分钟只重渲染这一小块，不会让整张弹窗的金额跟着每 60 秒重排一次。
 *
 * 一条线的颜色分两层给：色相（`--ub-peak` / `--ub-valley`）在这里写进渐变停点，
 * 粗细与每层透明度留给 CSS —— 前者是主题，后者是观感，混在一起换主题就得改几何。
 *
 * 渐变的 id 必须**每个实例一份**：两个入口（输入框下方与侧栏）的弹窗可能同时开着，
 * 文档里出现两份同名渐变时浏览器只认第一份。useId 出来的串带冒号，进 url(#…) 前先滤成安全字符。
 */
import { useId } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useRuleMinute } from '../hooks/useRuleMinute.ts'
import {
  RAIL_BEAM_LAYERS, RAIL_CORE_LAYERS, RAIL_CORE_STOPS, RAIL_FIELD_BLEED, RAIL_FIELD_STOPS,
  RAIL_HEIGHT, RAIL_PEAK_Y, RAIL_PLOT_HEIGHT, RAIL_VALLEY_Y, RAIL_WIDTH,
  curveAriaLabel, curveTitleText, nowText, railYOf, tierRails, toneAtMinute,
} from '../core/tier-curve.ts'
import type { TierTone } from '../core/tier-curve.ts'
import type { TierDayProfile } from '../../pricing/tiers.ts'
import styles from '../styles/settings-section.module.css'

export interface TierCurveProps {
  /** 今日费率形状；调用方负责在它缺席（旧宿主 / 分时价未启用）时不渲染本组件。 */
  profile: TierDayProfile
}

/** 两轨之间那片竖向渐变：上沿峰色、中间透明、下沿谷色。全天一份。 */
function FieldGradient(props: { id: string }): JSX.Element {
  return (
    <linearGradient id={props.id} x1="0" y1="0" x2="0" y2="1">
      {RAIL_FIELD_STOPS.map(stop => (
        <stop
          key={`${stop.at}-${stop.tone}`}
          offset={stop.at}
          stopColor={`var(--ub-${stop.tone})`}
          stopOpacity={stop.alpha}
        />
      ))}
    </linearGradient>
  )
}

/**
 * 亮芯沿一天的浓淡：每档一条，横跨整天（0..1440）。
 *
 * 走 userSpaceOnUse 的具体值而不是 objectBoundingBox —— 横线的包围盒高度是 0，
 * 用包围盒算的渐变在 SVG 里是未定义行为。全天一条也让横坐标仍然是时刻本身。
 */
function CoreGradient(props: { id: string; tone: TierTone }): JSX.Element {
  return (
    <linearGradient
      id={props.id}
      gradientUnits="userSpaceOnUse"
      x1={0} y1={0} x2={RAIL_WIDTH} y2={0}
    >
      {RAIL_CORE_STOPS[props.tone].map(stop => (
        <stop key={stop.at} offset={stop.at} stopColor={`var(--ub-${props.tone})`} stopOpacity={stop.alpha} />
      ))}
    </linearGradient>
  )
}

export function TierCurve(props: TierCurveProps): JSX.Element {
  const profile = props.profile
  const minute = useRuleMinute(profile.utcOffsetMinutes)
  const rails = tierRails(profile)
  const tone = toneAtMinute(profile, minute)
  // 横轴是等分的时间轴（位置 = 时刻），所以这里直接问 rails 要坐标，不自己乘除。
  const nowX = rails.x(minute)
  const left = (nowX / RAIL_WIDTH) * 100 + '%'
  // 纵向 1 单位 = 1px（viewBox 高就是容器高），所以「现在」点的 top 可以直接写画布坐标。
  const top = railYOf(tone)
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const fieldId = `ubTierField${uid}`
  const coreId = (tier: TierTone) => `ubTierCore${tier}${uid}`
  return (
    <div className={styles.tierRail} data-dsh-ub-tier-curve>
      {/* 时刻每分钟在变，所以 label 交给函数：气泡不显示时一次都不求值。 */}
      <Tooltip
        label={() => curveTitleText(profile) + ' · ' + nowText(profile, minute)}
        side="top"
        delayMs={200}
        portal
      >
        <div className={styles.tierRailPlot} style={{ height: RAIL_PLOT_HEIGHT }}>
          <svg
            className={styles.tierRailCanvas}
            width="100%"
            height={RAIL_HEIGHT}
            viewBox={`0 0 ${RAIL_WIDTH} ${RAIL_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={curveAriaLabel(profile, minute)}
          >
            <defs>
              <FieldGradient id={fieldId} />
              <CoreGradient id={coreId('peak')} tone="peak" />
              <CoreGradient id={coreId('valley')} tone="valley" />
            </defs>
            {/* 落差光场：两轨之间那片竖向渐变。fill 是 url(#…)，所以这里不挂类名。 */}
            <rect
              x={0}
              y={RAIL_PEAK_Y - RAIL_FIELD_BLEED}
              width={RAIL_WIDTH}
              height={RAIL_VALLEY_Y - RAIL_PEAK_Y + RAIL_FIELD_BLEED * 2}
              fill={`url(#${fieldId})`}
            />
            {/* 两根常驻发丝：光场的上下沿，给两级价一个不依赖任何时段的位置参照。 */}
            <line
              className={styles.tierRailTrack}
              data-tone="peak"
              x1={0} y1={RAIL_PEAK_Y} x2={RAIL_WIDTH} y2={RAIL_PEAK_Y}
            />
            <line
              className={styles.tierRailTrack}
              data-tone="valley"
              x1={0} y1={RAIL_VALLEY_Y} x2={RAIL_WIDTH} y2={RAIL_VALLEY_Y}
            />
            {/* 上轨：高峰窗的琥珀亮芯。窗口左闭右开，与判档同一口径。 */}
            {rails.peakBlocks.map(b => RAIL_CORE_LAYERS.map(layer => (
              <line
                key={'p' + b.from + '-' + layer}
                className={styles.tierRailCore}
                data-layer={layer}
                data-tone="peak"
                x1={b.x} y1={RAIL_PEAK_Y} x2={b.x + b.width} y2={RAIL_PEAK_Y}
                stroke={`url(#${coreId('peak')})`}
              />
            )))}
            {/* 下轨：剩下的时段。与上轨合起来正好铺满一整天。 */}
            {rails.valleyBlocks.map(b => RAIL_CORE_LAYERS.map(layer => (
              <line
                key={'v' + b.from + '-' + layer}
                className={styles.tierRailCore}
                data-layer={layer}
                data-tone="valley"
                x1={b.x} y1={RAIL_VALLEY_Y} x2={b.x + b.width} y2={RAIL_VALLEY_Y}
                stroke={`url(#${coreId('valley')})`}
              />
            )))}
            {/* 落差光柱：这一刻离另一档有多远。在峰上实、在谷里虚。 */}
            {RAIL_BEAM_LAYERS.map(layer => (
              <line
                key={'beam' + layer}
                className={styles.tierRailBeam}
                data-layer={layer}
                data-tone={tone}
                x1={nowX} y1={RAIL_VALLEY_Y} x2={nowX} y2={RAIL_PEAK_Y}
              />
            ))}
          </svg>
          {/* 指针：横向用百分比（跟着弹窗宽度走），纵向用 px（与 viewBox 1:1，不会被拉扁）。 */}
          <span
            className={styles.tierRailDot}
            data-tier={tone}
            style={{ left, top }}
            aria-hidden="true"
          />
        </div>
      </Tooltip>
    </div>
  )
}
