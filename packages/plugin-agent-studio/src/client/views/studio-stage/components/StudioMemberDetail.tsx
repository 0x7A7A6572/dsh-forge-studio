/**
 * 成员详情浮层：角色信息 + 该成员跑过的子智能体任务。
 * 取数在 useStudioMemberDetail；这里只做 JSX 与纯文案映射。
 */
import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StudioDetailCapabilities } from '../../../core/capabilities.ts'
import type { StudioOccupant } from '../../../core/pixel/scene-types.ts'
import {
  memberRoleTextOf,
  memberStatusOf,
  subagentDotOf,
  workstationTextOf,
  type StudioCatalogRow,
  type StudioMemberProfileSnapshot,
} from '../../../core/pixel/detail-model.ts'
import {
  useStudioMemberDetail,
  type StudioDetailHooks,
} from '../../../hooks/useStudioMemberDetail.ts'
import {
  UNASSIGNED_TASK_OWNER_TEXT,
  type StudioSharedTaskProjection,
} from '../../../core/pixel/task-model.ts'
import { PixelAvatar } from '../../../components/PixelAvatar.tsx'
import type { StudioRailAvatars } from './StudioRosterRail.tsx'
import styles from './StudioMemberDetail.module.css'

export interface StudioMemberDetailProps {
  readonly occupant: StudioOccupant
  readonly profile?: StudioMemberProfileSnapshot
  /** lead 会话的共享任务板；成员卡按 ownerName 过滤，lead 卡全量。 */
  readonly tasks?: readonly StudioSharedTaskProjection[]
  /** lead 会话 id：「成员会话」行的 openSession 目标。 */
  readonly leadId: string
  readonly hooks: StudioDetailHooks
  readonly capabilities: StudioDetailCapabilities
  /** 成员名 → 头像（profile.id + 配色档）；缺省按 memberId 兜底。 */
  readonly avatars?: StudioRailAvatars | undefined
  onClose(): void
}

/** 宿主没有会话跳转能力时，任务行内必须能看见的降级说明。 */
const OPEN_SESSION_HINT = '当前环境不支持打开子会话'

/** Tab 循环的候选：dialog 内所有可用控件，禁用的任务行不参与。 */
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** 任务 / 会话行共用渲染：catalog 行走 openTask，「成员会话」行走 openMemberSession。 */
function DetailTaskRows(props: {
  readonly rows: readonly StudioCatalogRow[]
  readonly canOpen: boolean
  onOpen(row: StudioCatalogRow): void
}): JSX.Element {
  return (
    <ul className={styles.taskList}>
      {props.rows.map((row) => {
        const openable = props.canOpen && row.openable
        const secondary = props.canOpen
          ? row.secondary
          : [row.secondary, OPEN_SESSION_HINT].filter((part) => part !== '').join(' · ')
        return (
          <li key={row.id} className={styles.taskItem} data-activity={row.activity}>
            <button
              type="button"
              className={styles.taskButton}
              disabled={!openable}
              title={
                openable
                  ? `打开 ${row.label}`
                  : props.canOpen
                    ? '外部执行没有可打开的本地会话'
                    : '宿主未提供会话跳转能力'
              }
              onClick={() => props.onOpen(row)}
            >
              <StateDot state={subagentDotOf(row.activity)} size={10} className={styles.taskDot} />
              <span className={styles.taskLabel}>{row.label}</span>
              <span className={styles.taskTokens}>{row.tokensText ?? '—'}</span>
              <span className={styles.taskDuration}>{row.durationText ?? '—'}</span>
              <span className={styles.taskArrow} aria-hidden="true">
                ↗
              </span>
              <span className={styles.taskSecondary}>{secondary}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function StudioMemberDetail(props: StudioMemberDetailProps): JSX.Element {
  const { occupant, profile, avatars, onClose } = props
  const isLead = occupant.role === 'lead'
  const detail = useStudioMemberDetail({
    memberId: occupant.memberId,
    memberName: occupant.name,
    isLead,
    leadId: props.leadId,
    tasks: props.tasks,
    hooks: props.hooks,
    capabilities: props.capabilities,
    onClose,
  })
  const cardRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // 焦点循环：首尾调用 preventDefault 后手动跳，避免 Tab 逃出浮层。
  const trapFocus = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab') return
    const card = cardRef.current
    if (card === null) return
    const focusables = Array.from(
      card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((node) => node.tabIndex >= 0)
    if (focusables.length === 0) {
      event.preventDefault()
      card.focus()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    const inside = active !== null && card.contains(active)
    const outsideBoundary = !inside || active === card
    if (event.shiftKey) {
      if (outsideBoundary || active === first) {
        event.preventDefault()
        last.focus()
      }
      return
    }
    if (outsideBoundary || active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const status = memberStatusOf(occupant.visual)
  const model = detail.model ?? occupant.model ?? profile?.model
  const provider = detail.provider ?? profile?.provider
  const description = profile?.description
  return (
    <section
      ref={cardRef}
      className={styles.card}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={trapFocus}
    >
      <header className={styles.header}>
        <StateDot state={status.dot} />
        <span className={styles.avatar}>
          <PixelAvatar
            id={(avatars?.[occupant.name]?.id) ?? occupant.memberId}
            size={22}
            color={avatars?.[occupant.name]?.color}
          />
        </span>
        <h2 id={titleId} className={styles.name}>{occupant.name}</h2>
        <span className={styles.role}>{memberRoleTextOf(occupant.role)}</span>
        <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="关闭详情">
          ×
        </button>
      </header>
      {detail.title !== undefined && <p className={styles.sessionTitle}>{detail.title}</p>}
      <p className={styles.status}>{status.text}</p>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>模型</dt>
          <dd>{model ?? '—'}</dd>
        </div>
        <div className={styles.fact}>
          <dt>提供商</dt>
          <dd>{provider ?? '—'}</dd>
        </div>
        <div className={styles.fact}>
          <dt>工位</dt>
          <dd>{workstationTextOf(occupant.slot)}</dd>
        </div>
        <div className={styles.fact}>
          <dt>令牌</dt>
          <dd>{detail.tokensText ?? '—'}</dd>
        </div>
        <div className={styles.fact}>
          <dt>活跃时长</dt>
          <dd>{detail.durationText ?? '—'}</dd>
        </div>
      </dl>
      <p className={styles.description}>{description ?? '暂无角色描述'}</p>
      {occupant.error !== undefined && <p className={styles.error}>{occupant.error}</p>}
      {detail.error !== '' && <p className={styles.error}>{detail.error}</p>}
      <section className={styles.tasks} aria-label={isLead ? '当前会话' : '成员会话'}>
        <h3 className={styles.tasksTitle}>{isLead ? '当前会话' : '成员会话'}</h3>
        <DetailTaskRows
          rows={[detail.memberSession]}
          canOpen={detail.canOpen}
          onOpen={() => detail.openMemberSession()}
        />
      </section>
      <section className={styles.tasks} aria-label="共享任务">
        <h3 className={styles.tasksTitle}>共享任务</h3>
        {detail.sharedTasks.length === 0 ? (
          <p className={styles.muted}>{isLead ? '任务板还没有任务' : '没有分给该成员的任务'}</p>
        ) : (
          <ul className={styles.sharedTaskList}>
            {detail.sharedTasks.map((task) => (
              <li key={task.taskId} className={styles.sharedTaskItem} data-status={task.status}>
                <StateDot state={task.dot} size={10} className={styles.sharedTaskDot} />
                <span className={styles.sharedTaskLabel}>{task.subject}</span>
                <span className={styles.sharedTaskStatus}>{task.statusText}</span>
                {detail.showTaskOwner && (
                  <span className={styles.sharedTaskOwner}>
                    {task.ownerName ?? UNASSIGNED_TASK_OWNER_TEXT}
                  </span>
                )}
                {task.writeScopes.length > 0 && (
                  <span className={styles.sharedTaskScopes}>{task.writeScopes.join(' · ')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.tasks} aria-label={isLead ? '成员会话' : '子智能体会话'}>
        <h3 className={styles.tasksTitle}>{isLead ? '成员会话' : '子智能体会话'}</h3>
        {detail.catalog.phase === 'error' && (
          <div className={styles.catalogNotice}>
            <p className={styles.error}>
              {detail.catalog.errorMessage ?? (isLead ? '无法读取成员会话' : '无法读取子智能体会话')}
            </p>
            <button type="button" className={styles.retry} onClick={detail.retry} disabled={!detail.canRetry}>
              重试
            </button>
          </div>
        )}
        {detail.catalog.phase === 'loading' && detail.catalog.rows.length === 0 && (
          <div className={styles.catalogNotice}>
            <p className={styles.muted}>{isLead ? '正在加载成员会话…' : '正在加载子智能体会话…'}</p>
            <button type="button" className={styles.retry} onClick={detail.retry} disabled={!detail.canRetry}>
              重试
            </button>
          </div>
        )}
        {detail.catalog.phase === 'ready' && detail.catalog.rows.length === 0 && (
          <p className={styles.muted}>{isLead ? '还没有成员会话' : '还没有子智能体会话'}</p>
        )}
        {detail.catalog.rows.length > 0 && (
          <DetailTaskRows
            rows={detail.catalog.rows}
            canOpen={detail.canOpen}
            onOpen={(row) => detail.openTask(row.id, row.mode)}
          />
        )}
      </section>
    </section>
  )
}
