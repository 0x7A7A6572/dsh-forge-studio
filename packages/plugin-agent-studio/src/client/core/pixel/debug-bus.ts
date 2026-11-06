/**
 * 调试叠层的共享状态：设置、冻结/步进、帧快照。纯模块，无 react。
 * 帧快照由渲染层每帧发布；读不到快照时叠层显示等待提示。
 */
import type { FramePlan } from './painter-types.ts'
import type { StudioStageModel } from './scene-types.ts'
import type { StudioRosterMember } from './studio-model.ts'
import type { StudioMemberPhase } from './state-machine.ts'

export interface StudioDebugSettings {
  readonly enabled: boolean
  readonly showGrid: boolean
  readonly showSlots: boolean
  readonly showWalk: boolean
  readonly showPath: boolean
  readonly showHitbox: boolean
}

export type StudioDebugLayerKey = Exclude<keyof StudioDebugSettings, 'enabled'>

const STORAGE_KEY = 'dsh-agent-studio-debug'

const DEFAULT_SETTINGS: StudioDebugSettings = {
  enabled: false,
  showGrid: true,
  showSlots: true,
  showWalk: false,
  showPath: true,
  showHitbox: false,
}

function withUrlFlag(settings: StudioDebugSettings): StudioDebugSettings {
  // URL 带 agentStudioDebug=1 强制开启但不落盘：临时排查入口。
  if (typeof location === 'undefined') return settings
  const flagged = /[?#&]agentStudioDebug=1/.test(location.search + location.hash)
  return flagged && !settings.enabled ? { ...settings, enabled: true } : settings
}

function loadSettings(): StudioDebugSettings {
  if (typeof localStorage === 'undefined') return withUrlFlag(DEFAULT_SETTINGS)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return withUrlFlag(DEFAULT_SETTINGS)
    return withUrlFlag({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<StudioDebugSettings>) })
  } catch {
    // 存储不可用（隐私模式等）时仅内存生效。
    return withUrlFlag(DEFAULT_SETTINGS)
  }
}

let settings: StudioDebugSettings = loadSettings()
let frozen = false

const changeListeners = new Set<() => void>()
const stepListeners = new Set<() => void>()

function notifyChange(): void {
  for (const listener of changeListeners) listener()
}

export function readDebugSettings(): StudioDebugSettings {
  return settings
}

export function updateDebugSettings(patch: Partial<StudioDebugSettings>): void {
  settings = { ...settings, ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // 无存储时仅内存生效。
  }
  notifyChange()
}

export function toggleDebugEnabled(): void {
  updateDebugSettings({ enabled: !settings.enabled })
}

export function onDebugChange(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

export function readDebugFrozen(): boolean {
  return frozen
}

export function setDebugFrozen(value: boolean): void {
  if (frozen === value) return
  frozen = value
  notifyChange()
}

/** 冻结时步进一帧：模型重算与 tick 推进各走一次。 */
export function stepDebug(): void {
  for (const listener of stepListeners) listener()
}

export function onDebugStep(listener: () => void): () => void {
  stepListeners.add(listener)
  return () => {
    stepListeners.delete(listener)
  }
}

/** 一帧的全部调试事实：model 与 plan 同源，叠层不做二次推导。 */
export interface StudioDebugFrame {
  readonly tick: number
  readonly now: number
  readonly themeKey: string
  readonly reducedMotion: boolean
  readonly atlasAvailable: boolean
  readonly model: StudioStageModel
  readonly plan: FramePlan
}

let latestFrame: StudioDebugFrame | null = null
const frameListeners = new Set<() => void>()

export function publishDebugFrame(frame: StudioDebugFrame): void {
  latestFrame = frame
  for (const listener of frameListeners) listener()
}

export function readDebugFrame(): StudioDebugFrame | null {
  return latestFrame
}

export function onDebugFrame(listener: () => void): () => void {
  frameListeners.add(listener)
  return () => {
    frameListeners.delete(listener)
  }
}

/** 实验沙盒：模拟成员 + 对真实成员的状态强制；只内存不持久化，刷新即清。 */
export interface StudioDebugMemberState {
  readonly running?: boolean
  readonly phase?: StudioMemberPhase
}

export interface StudioDebugSandbox {
  readonly extra: readonly StudioRosterMember[]
  readonly forces: Readonly<Record<string, StudioDebugMemberState>>
}

const MOCK_ID_PREFIX = 'debug-'
const EMPTY_SANDBOX: StudioDebugSandbox = { extra: [], forces: {} }
let sandbox: StudioDebugSandbox = EMPTY_SANDBOX

export function readDebugSandbox(): StudioDebugSandbox {
  return sandbox
}

function replaceSandbox(next: StudioDebugSandbox): void {
  sandbox = next
  notifyChange()
}

/** 全清（模拟成员 + 强制）；测试与"彻底还原"用。 */
export function resetDebugSandbox(): void {
  replaceSandbox(EMPTY_SANDBOX)
}

export function addDebugSandboxMember(): void {
  const next = sandbox.extra.reduce(
    (max, member) => Math.max(max, Number(new RegExp(`^${MOCK_ID_PREFIX}(\\d+)$`).exec(member.id)?.[1] ?? 0)),
    0,
  ) + 1
  const member: StudioRosterMember = {
    id: `${MOCK_ID_PREFIX}${next}`,
    name: `模拟${next}`,
    role: 'teammate',
    phase: 'active',
    running: false,
  }
  replaceSandbox({ ...sandbox, extra: [...sandbox.extra, member] })
}

export function removeDebugSandboxMember(id: string): void {
  if (!id.startsWith(MOCK_ID_PREFIX)) return
  const forces = { ...sandbox.forces }
  delete forces[id]
  replaceSandbox({ forces, extra: sandbox.extra.filter((member) => member.id !== id) })
}

/** 只清模拟成员（及其强制）；真实成员的强制保留。 */
export function clearDebugSandboxMembers(): void {
  const mockIds = new Set(sandbox.extra.map((member) => member.id))
  const forces = Object.fromEntries(
    Object.entries(sandbox.forces).filter(([id]) => !mockIds.has(id)),
  )
  replaceSandbox({ forces, extra: [] })
}

export function setDebugMemberRunning(id: string, running: boolean): void {
  if (id.startsWith(MOCK_ID_PREFIX)) {
    replaceSandbox({
      ...sandbox,
      extra: sandbox.extra.map((member) => (member.id === id ? { ...member, running } : member)),
    })
    return
  }
  replaceSandbox({
    ...sandbox,
    forces: { ...sandbox.forces, [id]: { ...sandbox.forces[id], running } },
  })
}

export function setDebugMemberPhase(id: string, phase: StudioMemberPhase): void {
  if (id.startsWith(MOCK_ID_PREFIX)) {
    replaceSandbox({
      ...sandbox,
      extra: sandbox.extra.map((member) => (member.id === id ? { ...member, phase } : member)),
    })
    return
  }
  const force = { ...sandbox.forces[id] }
  if (phase === 'active') delete force.phase
  else force.phase = phase
  const forces = { ...sandbox.forces }
  if (force.running === undefined && force.phase === undefined) delete forces[id]
  else forces[id] = force
  replaceSandbox({ ...sandbox, forces })
}

/** 组装模型输入：强制真实成员状态 + 追加模拟成员；沙盒未启用时原引用返回。 */
export function applyDebugSandbox(
  members: readonly StudioRosterMember[],
): readonly StudioRosterMember[] {
  const { extra, forces } = sandbox
  if (extra.length === 0 && Object.keys(forces).length === 0) return members
  const forced = members.map((member) => {
    const force = forces[member.id]
    if (force === undefined) return member
    return {
      ...member,
      ...(force.running !== undefined ? { running: force.running } : {}),
      ...(force.phase !== undefined ? { phase: force.phase } : {}),
    }
  })
  return [...forced, ...extra]
}

/** 请求清空场景记忆（游走/工位/边沿），下一帧按全新状态重新认领。 */
let memoResetPending = false

export function requestDebugMemoReset(): void {
  memoResetPending = true
  notifyChange()
}

export function consumeDebugMemoReset(): boolean {
  const pending = memoResetPending
  memoResetPending = false
  return pending
}
