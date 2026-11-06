/**
 * 会话头入口：小按钮 toggle 右侧栏的「智能体团队」页。
 * 可用态/打开态直接订阅侧栏服务发布的观测值（零额外 RPC、无本地猜测）。
 * 团队有成员在干活时，立方体图标播放线条流动动画（轻量轮询 roster，5s 一拍）。
 */
import { useCallback, useEffect, useSyncExternalStore, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { StudioIcon } from '../../components/StudioIcon.tsx'
import { unwrap } from '../../core/result.ts'
import type { AgentStudioRemote } from '../../core/remote.ts'
import {
  STUDIO_STAGE_KIND,
  studioTabOpenedIn,
  studioToggleActionOf,
  type StudioOpenTabRef,
  type StudioToggleAction,
} from '../../core/stage-entry.ts'
import styles from './StudioStageHeaderButton.module.css'

/** `ctx.sidebarRight.mounted` 的最小切片（SessionId 在这里只当字符串用）。 */
export interface StudioMountedSource {
  getSnapshot(): string | undefined
  subscribe(listener: () => void): () => void
}

/** `ctx.sidebarRight.openTabs` 的最小切片。 */
export interface StudioOpenTabsSource {
  getSnapshot(): readonly StudioOpenTabRef[]
  subscribe(listener: () => void): () => void
}

/** 侧栏当前激活 tab 的最小切片；不是订阅源，重渲染与点击各读一次。 */
export interface StudioActiveTabRef {
  readonly id: string
  readonly kind: string
}

export interface StudioHeaderButtonProps {
  readonly openStudio: () => void
  readonly mounted: StudioMountedSource
  readonly openTabs: StudioOpenTabsSource
  /** 读当前激活 tab：区分「收起本页」与「聚焦已开在别处的页」。缺省时退化为“已开即收起”。 */
  readonly readActiveTab?: (() => StudioActiveTabRef | undefined) | undefined
  /** roster 查询（干活动画用）；缺省不播动画。失败静默——动画只是辅助信息。 */
  readonly roster?: Pick<AgentStudioRemote, 'listRoster'> | undefined
}

/** 三态文案与无障碍名一致：disabled 无会话 / close 我们的页正显示 / open 打开或聚焦。 */
function labelOf(state: StudioToggleAction, opened: boolean): string {
  if (state === 'disabled') return '打开智能体团队'
  if (state === 'close') return '收起智能体团队'
  return opened ? '聚焦智能体团队' : '打开智能体团队'
}

export function StudioHeaderButton(props: StudioHeaderButtonProps): JSX.Element {
  const { mounted, openTabs } = props
  // subscribe/getSnapshot 以方法形式调用，避免把观测值对象的方法解绑。
  const subscribeMounted = useCallback(
    (listener: () => void) => mounted.subscribe(listener),
    [mounted],
  )
  const readMounted = useCallback(() => mounted.getSnapshot(), [mounted])
  const subscribeOpenTabs = useCallback(
    (listener: () => void) => openTabs.subscribe(listener),
    [openTabs],
  )
  const readOpenTabs = useCallback(() => openTabs.getSnapshot(), [openTabs])

  const sessionId = useSyncExternalStore(subscribeMounted, readMounted, readMounted)
  const tabs = useSyncExternalStore(subscribeOpenTabs, readOpenTabs, readOpenTabs)
  const opened = studioTabOpenedIn(tabs, sessionId)
  // 没有激活 tab 通道时按旧口径（已开即收起）呈现，避免凭空猜 active。
  // 防御：宿主跨版本时 readActiveTab 可能抛错，按钮渲染不能因此拖垮入口。
  let activeKind: string | undefined
  try {
    activeKind = props.readActiveTab === undefined
      ? (opened ? STUDIO_STAGE_KIND : undefined)
      : props.readActiveTab()?.kind
  } catch {
    activeKind = opened ? STUDIO_STAGE_KIND : undefined
  }
  const state = studioToggleActionOf({ mounted: sessionId, activeKind })
  const label = labelOf(state, opened)

  // 干活动画：轻量轮询 roster（5s 一拍），任一成员 running/provisioning 就让线条流动。
  const [working, setWorking] = useState(false)
  useEffect(() => {
    const roster = props.roster
    if (sessionId === undefined || sessionId === '' || roster === undefined) {
      setWorking(false)
      return
    }
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const rows = unwrap(await roster.listRoster(sessionId))
        if (!cancelled) setWorking(rows.some((row) => row.status === 'running' || row.status === 'provisioning'))
      } catch {
        // 静默：动画只是辅助信息，roster 不可用就不播。
      }
    }
    void tick()
    const timer = window.setInterval(() => { void tick() }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [sessionId, props.roster])

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      icon={
        <span className={working ? `${styles.cube} ${styles.working}` : styles.cube}>
          <StudioIcon name="cube-iso" />
        </span>
      }
      aria-label={label}
      aria-pressed={state === 'close'}
      aria-expanded={state === 'close'}
      disabled={state === 'disabled'}
      title={state === 'disabled' ? '当前没有打开的会话' : label}
      onClick={props.openStudio}
    />
  )
}
