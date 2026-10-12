/**
 * 内置「线条 M」主题：左侧一条平滑的 M 型峰谷曲线 + 一颗「现在」的点，右侧金额与预算条。
 * 几何全在 core/line-geometry.ts，这里只摆放；宽态才画，36px 的 rail 塞不下 75px 的图。
 */
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useId } from 'react'
import type { Theme, ThemeProps, TierShapeData } from '../../shape/index.ts'
import { CURVE_WIDTH, MINI_CURVE_HEIGHT, curveAriaLabel, miniCurve } from '../core/line-geometry.ts'
import { curveTitleText, nowText, visualTone } from '../core/tier-curve.ts'
import { EntryShell } from './entry-shell.tsx'
import styles from './builtin-line.module.css'

export const BUILTIN_LINE_THEME_ID = 'builtin-line'

function LineChart(props: { data: TierShapeData }): JSX.Element {
  const { data } = props
  const curve = miniCurve(data)
  const tone = visualTone(data.tone)
  const left = (curve.x(data.minute) / CURVE_WIDTH) * 100 + '%'
  const top = (curve.y(data.minute) / MINI_CURVE_HEIGHT) * 100 + '%'
  // 侧栏与输入框下方会同时挂着别的曲线：渐变 / 蒙版的 id 必须各自唯一。
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const toneId = uid + 'tone'
  const fadeId = uid + 'fade'
  const maskId = uid + 'fade-mask'
  return (
    // 容器在 Tooltip 外面：交给 Tooltip 去包，它自己的包裹元素会顶掉 flex: none。
    <span className={styles.chart} data-dsh-ub-curve-mini>
      <Tooltip
        label={() => curveTitleText(data) + ' · ' + nowText(data, data.minute)}
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
            aria-label={curveAriaLabel(data, data.minute)}
          >
            <defs>
              <linearGradient id={toneId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={CURVE_WIDTH} y2="0">
                {curve.tones.map((stop, i) => (
                  <stop key={i} offset={stop.offset} className={styles.tierCurveStop} data-tone={stop.tone} />
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
            <path className={styles.tierCurveArea} d={curve.area} fill={`url(#${toneId})`} mask={`url(#${maskId})`} />
            <path
              className={styles.tierCurveLine}
              d={curve.line}
              fill="none"
              stroke={`url(#${toneId})`}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span className={styles.miniCurveDot} data-tier={tone} style={{ left, top }} aria-hidden="true" />
        </span>
      </Tooltip>
    </span>
  )
}

export function BuiltinLineTheme(props: ThemeProps): JSX.Element {
  const { data, view } = props
  const chart = view.showTier && data !== null ? <LineChart data={data} /> : null
  return <EntryShell themeId={BUILTIN_LINE_THEME_ID} view={view} chart={chart} />
}

export const builtinLineTheme: Theme = {
  id: BUILTIN_LINE_THEME_ID,
  label: '内置：线条 M + 金额',
  component: BuiltinLineTheme,
}
