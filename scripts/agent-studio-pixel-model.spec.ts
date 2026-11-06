import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OFFICE_SCENE } from '../packages/plugin-agent-studio/src/client/core/pixel/scene-office.ts'
import { assignCharacters } from '../packages/plugin-agent-studio/src/client/core/pixel/avatar-sprite.ts'
import {
  composeStageModel,
  type StudioRosterMember,
} from '../packages/plugin-agent-studio/src/client/core/pixel/studio-model.ts'
import {
  advanceVisualState,
  clipFrameIndex,
  resolveVisualState,
} from '../packages/plugin-agent-studio/src/client/core/pixel/state-machine.ts'
import {
  addDebugSandboxMember,
  applyDebugSandbox,
  removeDebugSandboxMember,
  resetDebugSandbox,
  setDebugMemberPhase,
  setDebugMemberRunning,
} from '../packages/plugin-agent-studio/src/client/core/pixel/debug-bus.ts'

const pixelDir = 'packages/plugin-agent-studio/src/client/core/pixel'

function member(overrides: Partial<StudioRosterMember> & { id: string }): StudioRosterMember {
  return { name: overrides.id, role: 'teammate', phase: 'active', running: false, ...overrides }
}

function team(count: number): StudioRosterMember[] {
  const roster = [member({ id: 'lead-1', role: 'lead' })]
  for (let i = 1; i <= count; i++) roster.push(member({ id: `m${i}` }))
  return roster
}

describe('agent studio pixel core invariants', () => {
  it('assignCharacters keeps 10 members unique and flags reuse beyond combos', () => {
    const roster = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, seed: `seed-${i}` }))
    const assignments = assignCharacters(roster)
    expect(new Set(assignments.map((a) => `${a.charIndex}:${a.accent}`)).size).toBe(10)
    expect(assignments.every((a) => !a.reused)).toBe(true)
    const exhausted = assignCharacters(
      Array.from({ length: 25 }, (_, i) => ({ id: `m${i}`, seed: `s${i}` })),
    )
    expect(exhausted[24].reused).toBe(true)
  })

  it('scene stations and anchors fit the canvas', () => {
    expect(OFFICE_SCENE.canvas).toEqual({ width: 256, height: 224, cell: 8 })
    for (const slot of OFFICE_SCENE.slots) {
      expect(slot.station.x + slot.station.w).toBeLessThanOrEqual(256)
      expect(slot.station.y + slot.station.h).toBeLessThanOrEqual(224)
      expect(slot.anchor.x).toBeLessThanOrEqual(256)
      expect(slot.anchor.y).toBeLessThanOrEqual(224)
    }
  })

  it('maps phase/running to the 5.5 visual states', () => {
    expect(resolveVisualState({ phase: 'active', running: true })).toBe('working')
    expect(resolveVisualState({ phase: 'active', running: false })).toBe('idle')
    expect(resolveVisualState({ phase: 'provisioning' })).toBe('provisioning')
    expect(resolveVisualState({ phase: 'failed' })).toBe('error')
  })

  it('fires the done edge once and holds 2400ms via memo round-trip', () => {
    const roster = [member({ id: 'lead-1', role: 'lead' }), member({ id: 'm1', running: true })]
    const stopped = [member({ id: 'lead-1', role: 'lead' }), member({ id: 'm1', running: false })]
    const visualOf = (model: ReturnType<typeof composeStageModel>, id: string) =>
      [...model.occupants, ...model.overflowMembers, ...model.roamers].find(
        (o) => o.memberId === id,
      )?.visual
    const frame1 = composeStageModel({ roster, scene: OFFICE_SCENE, atlasAvailable: true, now: 1000 })
    const frame2 = composeStageModel({
      roster: stopped,
      scene: OFFICE_SCENE,
      atlasAvailable: true,
      now: 1100,
      memo: frame1.memo,
    })
    expect(visualOf(frame2, 'm1')).toBe('done')
    expect(frame2.memo.doneUntil?.m1).toBe(1100 + OFFICE_SCENE.clips.done.holdMs)
    const frame3 = composeStageModel({
      roster: stopped,
      scene: OFFICE_SCENE,
      atlasAvailable: true,
      now: 2000,
      memo: frame2.memo,
    })
    expect(visualOf(frame3, 'm1')).toBe('done')
    const frame4 = composeStageModel({
      roster: stopped,
      scene: OFFICE_SCENE,
      atlasAvailable: true,
      now: 1100 + OFFICE_SCENE.clips.done.holdMs,
      memo: frame3.memo,
    })
    expect(visualOf(frame4, 'm1')).toBe('idle')
  })

  it('shares workstations: idle roams, workers claim nearest free seat, seat frees on leave', () => {
    const lead = member({ id: 'lead-1', role: 'lead' })
    // 全 idle：无人占工位，全部进入游走列表。
    const idle = composeStageModel({
      roster: [lead, member({ id: 'm1' }), member({ id: 'm2' })],
      scene: OFFICE_SCENE,
      atlasAvailable: true,
      now: 0,
    })
    expect(idle.occupants.map((o) => o.memberId)).toEqual(['lead-1'])
    expect(idle.roamers.map((o) => o.memberId)).toEqual(['m1', 'm2'])
    expect(idle.emptySlots.map((s) => s.id)).toEqual([
      'seat-A1', 'seat-A2', 'seat-B1', 'seat-B2', 'seat-C1', 'seat-C2', 'seat-D1', 'seat-D2',
    ])

    // working：首帧无位置 → 从候客区就近认领（B1 最近，其次 B2）。
    const workingRoster = [lead, member({ id: 'm1', running: true }), member({ id: 'm2', running: true })]
    const frame1 = composeStageModel({ roster: workingRoster, scene: OFFICE_SCENE, atlasAvailable: true, now: 0 })
    expect(frame1.occupants.find((o) => o.memberId === 'm1')?.slot.id).toBe('seat-B1')
    expect(frame1.occupants.find((o) => o.memberId === 'm2')?.slot.id).toBe('seat-B2')
    // 同一次干活期间不挪窝。
    const frame2 = composeStageModel({ roster: workingRoster, scene: OFFICE_SCENE, atlasAvailable: true, now: 83, memo: frame1.memo })
    expect(frame2.occupants.find((o) => o.memberId === 'm1')?.slot.id).toBe('seat-B1')

    // done 窗口内仍占位；窗口结束转 idle 时人还在锚点上 → 短暂持有；再一帧起身游走并释放。
    const stopped = [lead, member({ id: 'm1' }), member({ id: 'm2', running: true })]
    const holdMs = OFFICE_SCENE.clips.done.holdMs
    const doneFrame = composeStageModel({ roster: stopped, scene: OFFICE_SCENE, atlasAvailable: true, now: 1000, memo: frame2.memo })
    expect(doneFrame.occupants.find((o) => o.memberId === 'm1')?.visual).toBe('done')
    expect(doneFrame.occupants.find((o) => o.memberId === 'm1')?.slot.id).toBe('seat-B1')
    const idleFrame = composeStageModel({
      roster: stopped, scene: OFFICE_SCENE, atlasAvailable: true, now: 1000 + holdMs, memo: doneFrame.memo,
    })
    expect(idleFrame.occupants.find((o) => o.memberId === 'm1')?.slot.id).toBe('seat-B1')
    const goneFrame = composeStageModel({
      roster: stopped, scene: OFFICE_SCENE, atlasAvailable: true, now: 1000 + holdMs + 83, memo: idleFrame.memo,
    })
    expect(goneFrame.roamers.map((o) => o.memberId)).toContain('m1')
    expect(goneFrame.emptySlots.map((s) => s.id)).toContain('seat-B1')
    // 其他干活成员不受影响。
    expect(goneFrame.occupants.find((o) => o.memberId === 'm2')?.slot.id).toBe('seat-B2')

    // 释放出的工位立即可以被新干活成员就近认领。
    const claimFrame = composeStageModel({
      roster: [...stopped, member({ id: 'm3', running: true })],
      scene: OFFICE_SCENE, atlasAvailable: true, now: 1000 + holdMs + 166, memo: goneFrame.memo,
    })
    expect(claimFrame.occupants.find((o) => o.memberId === 'm3')?.slot.id).toBe('seat-B1')
  })

  it('caps concurrent work at 8 shared stations; extras wait at the sofa', () => {
    const roster = team(10).map((m) => (m.role === 'lead' ? m : { ...m, running: true }))
    const model = composeStageModel({ roster, scene: OFFICE_SCENE, atlasAvailable: true, now: 0 })
    expect(model.occupants).toHaveLength(9)
    expect(model.overflowMembers.map((o) => o.memberId)).toEqual(['m9', 'm10'])
    expect(model.overflowMembers[0].slot.id).toBe('overflow')
    expect(model.overflowMembers.map((o) => o.seat)).toEqual([0, 1])
    expect(model.roamers).toHaveLength(0)
  })

  it('advances clip frames by tick with per-clip fps incl. 8fps error', () => {
    const idle = OFFICE_SCENE.clips.idle
    expect(clipFrameIndex(idle, 0)).toBe(0)
    expect(clipFrameIndex(idle, 2)).toBe(1)
    expect(clipFrameIndex(idle, 4)).toBe(0)
    const done = OFFICE_SCENE.clips.done
    expect(clipFrameIndex(done, 7)).toBe(7)
    expect(clipFrameIndex(done, 1000)).toBe(7)
    const error = OFFICE_SCENE.clips.error
    expect(clipFrameIndex(error, 1)).toBe(0)
    expect(clipFrameIndex(error, 6)).toBe(3)
    expect(clipFrameIndex(error, 97)).toBe(3)
  })

  it('lets higher priority states preempt the done window', () => {
    const inWindow = { visual: 'done' as const, doneUntil: 5000 }
    expect(advanceVisualState(inWindow, { phase: 'failed' }, 1000).visual).toBe('error')
    expect(advanceVisualState(inWindow, { phase: 'provisioning' }, 1000).visual).toBe('provisioning')
    expect(advanceVisualState(inWindow, { phase: 'active', running: true }, 1000).visual).toBe('working')
  })

  it('provides fallback sprites when the atlas is unavailable', () => {
    const model = composeStageModel({ roster: team(3), scene: OFFICE_SCENE, atlasAvailable: false, now: 0 })
    for (const occupant of [...model.occupants, ...model.overflowMembers, ...model.roamers]) {
      expect(occupant.character.fallback?.width).toBe(16)
      expect(occupant.character.fallback?.height).toBe(24)
    }
    expect(model.roamers.length).toBeGreaterThan(0)
    const withAtlas = composeStageModel({ roster: team(3), scene: OFFICE_SCENE, atlasAvailable: true, now: 0 })
    const everyone = [...withAtlas.occupants, ...withAtlas.overflowMembers, ...withAtlas.roamers]
    expect(everyone.every((o) => o.character.fallback === undefined)).toBe(true)
  })

  it('core/pixel sources never import react', () => {
    const files = readdirSync(pixelDir).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(5)
    for (const file of files) {
      const text = readFileSync(join(pixelDir, file), 'utf8')
      expect(text.includes("from 'react'"), `${file} imports react`).toBe(false)
    }
  })

  it('debug sandbox adds mock members and forces real member states', () => {
    resetDebugSandbox()
    const base: StudioRosterMember[] = [member({ id: 'm1' })]
    // 沙盒未启用：原引用返回，不触发下游重算。
    expect(applyDebugSandbox(base)).toBe(base)
    // 真实成员强制：running / phase。
    setDebugMemberRunning('m1', true)
    expect(applyDebugSandbox(base)[0]?.running).toBe(true)
    setDebugMemberPhase('m1', 'provisioning')
    expect(applyDebugSandbox(base)[0]?.phase).toBe('provisioning')
    // phase 归位 active 时撤销强制。
    setDebugMemberPhase('m1', 'active')
    expect(applyDebugSandbox(base)[0]?.phase).toBe('active')
    // 模拟成员：追加、改名、可单独操作与移除。
    addDebugSandboxMember()
    const applied = applyDebugSandbox(base)
    expect(applied).toHaveLength(2)
    expect(applied[1]).toMatchObject({ id: 'debug-1', name: '模拟1', role: 'teammate', running: false })
    setDebugMemberRunning('debug-1', true)
    expect(applyDebugSandbox(base)[1]?.running).toBe(true)
    setDebugMemberPhase('debug-1', 'failed')
    expect(applyDebugSandbox(base)[1]?.phase).toBe('failed')
    removeDebugSandboxMember('debug-1')
    expect(applyDebugSandbox(base)).toHaveLength(1)
    resetDebugSandbox()
    expect(applyDebugSandbox(base)).toBe(base)
  })
})
