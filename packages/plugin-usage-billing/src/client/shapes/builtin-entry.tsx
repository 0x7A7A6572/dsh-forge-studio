/**
 * 内置入口形状：默认那张侧栏计费卡 —— 左侧 12h 峰谷环（一天两圈），右侧（本月 / 今日 + 预算叠加条）。
 *
 * 它是**注册表里的第一条**（id = `BUILTIN_THEME_ID`），与用户主题走的是同一个接口：
 * 拿一份 {@link ThemeProps}，自己画完。这个文件就是「怎么写一个主题」的参考实现：
 *
 * - **不 import 任何宿主 hook**。连时钟都是宿主注入的（`data.minute`）——
 *   形状自己开时钟就会「一处走一处停」，「现在」不唯一。
 * - **不自己判档**。契约说得很清楚：`toneAtMinute` 只有一份实现，宿主已经判好了，
 *   直接读 `data.tone` 就行。这里只做一次**口径翻译**（判档说钱 peak/offPeak，画面说高低 peak/valley）。
 * - **只用契约给的数据**：宿主内部还有 `TierDayProfile` / `segments` / 原始金额，这个文件一概不碰。
 *   拿不到就画不出来 —— 这正是契约能冻住的原因。
 */
import type { TierEntryProgress, TierShapeData, Theme, ThemeProps } from '../../shape/index.ts'
import { BUILTIN_THEME_ID } from '../../shape/index.ts'
import { TierCurveMini } from '../components/TierCurveMini.tsx'
import { PieBadge } from '../components/PieBadge.tsx'
import { barRatio } from '../core/budget-display.ts'
import type { TierTone } from '../core/tier-curve.ts'
import styles from './builtin-entry.module.css'

/** 判档口径 → 画面口径：契约说钱（peak / offPeak），画面说高低（peak / valley）。 */
function visualTone(tone: TierShapeData['tone']): TierTone {
  return tone === 'peak' ? 'peak' : 'valley'
}

/**
 * 预算叠加条。契约给的是**比例**（整条的 `ratio`、已用段内三段的 `bands`），
 * 所以这里只做摆放：本项目打底、今日锚右端、会话锚左端（叠放关系是这张卡的口径）。
 */
function ShapeStackBar(props: { progress: TierEntryProgress }): JSX.Element {
  const { progress } = props
  return (
    <span className={styles.bar} data-dsh-ub-stack-bar>
      <span
        className={styles.barUsed}
        data-level={progress.level}
        style={{ width: (barRatio(progress.ratio) * 100).toFixed(2) + '%' }}
      >
        {progress.bands.map((band) => (
          <span
            key={band.key}
            className={styles.barPiece}
            data-kind={band.key}
            // 今日跨所有项目，锚在已用段的右端；其余两段从左侧起。
            style={{
              ...(band.key === 'today' ? { right: 0 } : { left: 0 }),
              width: (barRatio(band.ratio) * 100).toFixed(2) + '%',
            }}
          />
        ))}
      </span>
    </span>
  )
}

export function BuiltinEntryShape(props: ThemeProps): JSX.Element {
  const { data, view } = props
  const progress = view.progress
  return (
    <span className={styles.card} data-wide={String(view.wide)} data-dsh-ub-shape={BUILTIN_THEME_ID}>
      {/* 峰谷环只在宽态画：rail 是 36px 的方块，塞不下 75px 的图。showTier 是用户偏好，可选遵从。 */}
      {view.wide && view.showTier && data !== null ? (
        <span className={styles.ring}>
          <TierCurveMini profile={data} minute={data.minute} tone={visualTone(data.tone)} />
        </span>
      ) : null}
      {view.wide ? null : (
        // 收起来只留饼图：宽态有数字，不需要再放一个纯装饰的图标。
        <span className={styles.icon} data-dsh-ub-icon aria-hidden="true">
          <PieBadge ratio={progress?.ratio ?? null} level={progress?.level ?? 'ok'} size={18} />
        </span>
      )}
      <span className={styles.text} data-dsh-ub-entry-text>
        <span className={styles.line}>
          <span className={styles.amount} data-dsh-ub-amount>
            <span className={styles.dot} data-kind="used" title="本月已用" aria-hidden="true" />
            {view.monthText}
          </span>
          <span className={styles.today} data-dsh-ub-today>
            <span className={styles.dot} data-kind="today" title="今日已用" aria-hidden="true" />
            {view.todayText}
          </span>
        </span>
        {progress === null ? null : (
          // 条是纯装饰：口径已经在按钮的 aria-label 里说全了（宿主负责那个标签）。
          <span className={styles.budget} aria-hidden="true">
            <ShapeStackBar progress={progress} />
          </span>
        )}
      </span>
      {view.failed ? (
        <span className={styles.badge} data-dsh-ub-badge data-kind="error">
          读取失败
        </span>
      ) : null}
    </span>
  )
}

/** 注册进宿主集合的那一条。 */
export const builtinEntryShape: Theme = {
  id: BUILTIN_THEME_ID,
  label: '内置：峰谷环 + 金额',
  component: BuiltinEntryShape,
}
