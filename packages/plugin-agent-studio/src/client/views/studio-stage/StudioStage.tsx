/**
 * 智能体团队视图（§6.2 三件套之一）：只编排 JSX，状态与取数全部在 useStudioStage。
 * 成员列表不占版面：底部悬浮药丸按钮，点击向上弹出。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AgentStudioRemote } from '../../core/remote.ts'
import {
  NO_STUDIO_CAPABILITIES,
  type StudioDetailCapabilities,
} from '../../core/capabilities.ts'
import { onStageChange, readStageEnabled } from '../../core/stage-pref.ts'
import { StudioCanvas } from './components/StudioCanvas.tsx'
import { StudioDebugLayer } from './components/StudioDebugLayer.tsx'
import { StudioHotspots } from './components/StudioHotspots.tsx'
import { StudioMemberDetail } from './components/StudioMemberDetail.tsx'
import { StudioOverlayLabels } from './components/StudioOverlayLabels.tsx'
import { StudioRosterRail } from './components/StudioRosterRail.tsx'
import { useStudioStage, type StudioEmptyKind, type StudioStageProps } from './useStudioStage.ts'
import styles from './StudioStage.module.css'

const EMPTY_TEXT: Record<StudioEmptyKind, string> = {
  unbound: '本会话未绑定团队或智能体——用输入框左侧的「智能体」按钮选择后，这里就是你们的智能体团队。',
  solo: '本会话绑定的是单人智能体；「智能体团队」按团队展示，切到团队即可入住。',
  loading: '正在等待团队成员启动…',
  unavailable: '团队投影暂时不可用。可以手动刷新一次成员快照。',
}

function EmptyState({ kind, onRefresh, busy }: { kind: StudioEmptyKind; onRefresh(): void; busy: boolean }): JSX.Element {
  return (
    <div className={styles.empty} role="status">
      <p className={styles.emptyText}>{EMPTY_TEXT[kind]}</p>
      {kind === 'unavailable' && (
        <button className={styles.refresh} onClick={onRefresh} disabled={busy}>
          {busy ? '刷新中…' : '刷新成员快照'}
        </button>
      )}
    </div>
  )
}

export function StudioStage(props: StudioStageProps): JSX.Element {
  const stageEnabled = useSyncExternalStore(onStageChange, readStageEnabled, readStageEnabled)
  const state = useStudioStage(props)
  const pane = props.variant === 'pane'
  // 成员列表弹层：默认收起，底部药丸按钮 toggle。
  const [railOpen, setRailOpen] = useState(false)
  useEffect(() => {
    if (!railOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setRailOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [railOpen])
  if (!stageEnabled) {
    return (
      <div className={pane ? `${styles.root} ${styles.pane}` : styles.root}>
        <p className={styles.emptyText} role="status">
          工作预览（实验）已在插件设置（智能体工坊）中关闭。
        </p>
      </div>
    )
  }
  if (state.error !== '') {
    return (
      <div className={styles.root}>
        <p className={styles.error}>{state.error}</p>
      </div>
    )
  }
  if (state.empty !== null || state.model === null) {
    return <EmptyState kind={state.empty ?? 'loading'} onRefresh={state.refresh} busy={state.refreshBusy} />
  }
  const memberCount = state.model.occupants.length + state.model.overflowMembers.length + state.model.roamers.length
  return (
    <div className={pane ? `${styles.root} ${styles.pane}` : styles.root}>
      {railOpen && (
        <button
          type="button"
          className={styles.railBackdrop}
          tabIndex={-1}
          aria-label="关闭团队成员列表"
          onClick={() => setRailOpen(false)}
        />
      )}
      <div className={pane ? `${styles.scene} ${styles.paneScene}` : styles.scene}>
        <StudioCanvas model={state.model} paused={props.paused === true} />
        <StudioOverlayLabels model={state.model} avatars={state.profileAvatars} />
        {state.selectedId !== null && (
          <button
            type="button"
            className={styles.dismiss}
            tabIndex={-1}
            aria-label="关闭成员详情"
            onClick={state.dismiss}
          />
        )}
        <StudioHotspots
          model={state.model}
          selectedId={state.selectedId}
          onSelect={state.select}
        />
        {state.debugOn && <StudioDebugLayer />}
        {state.selected !== null && (
          <StudioMemberDetail
            key={state.selected.memberId}
            occupant={state.selected}
            {...(state.selectedProfile !== undefined ? { profile: state.selectedProfile } : {})}
            avatars={state.profileAvatars}
            tasks={state.tasks}
            leadId={state.leadId}
            hooks={{ useSessions: props.useSessions, useSessionStatus: props.useSessionStatus }}
            capabilities={props.capabilities}
            onClose={state.dismiss}
          />
        )}
      </div>
      <button
        type="button"
        className={styles.railTab}
        onClick={() => setRailOpen((value) => !value)}
        aria-expanded={railOpen}
        aria-label="团队成员"
      >
        <svg className={styles.railSlope} viewBox="0 0 23 20" preserveAspectRatio="none" aria-hidden="true">
          <path d="M23 20 V5 Q23 0 18.6 2.8 L0 20 Z" />
        </svg>
        <span className={styles.railTabLabel}>团队成员 · {memberCount}</span>
        <svg className={styles.railSlope} viewBox="0 0 23 20" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 20 V5 Q0 0 4.4 2.8 L23 20 Z" />
        </svg>
      </button>
      {railOpen && (
        <div className={styles.railPop}>
          <StudioRosterRail
            model={state.model}
            selectedId={state.selectedId}
            avatars={state.profileAvatars}
          />
        </div>
      )}
    </div>
  )
}

/** 卡 5 适配组件：从平铺的 ConvViewProps（标准 props + inject）取出本面板需要的值。 */
export function StudioStageView(props: ConvViewProps): JSX.Element {
  const injected = props as unknown as {
    studio: AgentStudioRemote
    capabilities?: StudioDetailCapabilities
  }
  return (
    <StudioStage
      studio={injected.studio}
      capabilities={injected.capabilities ?? NO_STUDIO_CAPABILITIES}
      sessionId={props.sessionId}
      useSession={props.useSession}
      useSessions={props.useSessions}
      useSessionStatus={props.useSessionStatus}
    />
  )
}
