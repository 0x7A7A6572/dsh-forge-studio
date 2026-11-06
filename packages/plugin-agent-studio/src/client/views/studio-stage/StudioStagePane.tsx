/**
 * 右侧栏正文适配层：`sidebar.right.pane.tab` 是 session scope，
 * 宿主平铺注入 sessionId + 会话 hooks；这里取出本面板需要的值交给 StudioStage。
 */
import type { AgentStudioRemote } from '../../core/remote.ts'
import {
  NO_STUDIO_CAPABILITIES,
  type StudioDetailCapabilities,
} from '../../core/capabilities.ts'
import { StudioStage } from './StudioStage.tsx'
import type { StudioSessionHooks } from '../../hooks/useStudioRoster.ts'
import styles from './StudioStagePane.module.css'

/** 宿主 `hooks.tabInfo` 返回值里本面板要用的程度（UseSidebarRightTabInfo 的结构收窄）。 */
export interface StudioTabInfoLike {
  readonly tab: {
    /** 只有前台会话 + 展开 + 本页选中时才为真；false 时暂停重算与 RAF。 */
    readonly visible: boolean
  }
}

export interface StudioAsideProps {
  readonly sessionId: string
  readonly studio: AgentStudioRemote
  readonly capabilities?: StudioDetailCapabilities
  readonly useSession: StudioSessionHooks['useSession']
  readonly useSessions: StudioSessionHooks['useSessions']
  readonly useSessionStatus: StudioSessionHooks['useSessionStatus']
  /** pane.tab 槽位注入的页签信息 hook；宿主的可见性判定从这里读。 */
  readonly useTabInfo?: (() => StudioTabInfoLike) | undefined
}

/** 正文与可见性解耦：paused 只影响重算/RAF，不影响已渲染的样子。 */
function StudioAsideBody(props: StudioAsideProps & { paused: boolean }): JSX.Element {
  const capabilities = props.capabilities ?? NO_STUDIO_CAPABILITIES
  return (
    <div className={styles.aside}>
      <StudioStage
        key={props.sessionId}
        variant="pane"
        studio={props.studio}
        capabilities={capabilities}
        sessionId={props.sessionId}
        paused={props.paused}
        useSession={props.useSession}
        useSessions={props.useSessions}
        useSessionStatus={props.useSessionStatus}
      />
    </div>
  )
}

function StudioAsideWithTabInfo({
  useTabInfo,
  ...props
}: StudioAsideProps & { useTabInfo: () => StudioTabInfoLike }): JSX.Element {
  const { tab } = useTabInfo()
  return <StudioAsideBody {...props} paused={!tab.visible} />
}

function StudioAsideWithoutTabInfo(props: StudioAsideProps): JSX.Element {
  return <StudioAsideBody {...props} paused={false} />
}

export function StudioAside(props: StudioAsideProps): JSX.Element {
  const useTabInfo = props.useTabInfo
  // 分支按注册时的注入形态固定，不随渲染变化：hook 调用次序稳定。
  return useTabInfo === undefined
    ? <StudioAsideWithoutTabInfo {...props} />
    : <StudioAsideWithTabInfo {...props} useTabInfo={useTabInfo} />
}
