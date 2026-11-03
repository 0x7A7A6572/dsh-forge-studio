/**
 * 办公室槽位表：数据真源 = scripts/pixel-office.placement.json，
 * 种子由 build-pixel-atlas.mjs --compose-bg 生成到 scene-office-slots.generated.ts（提交）。
 * 坐姿统一：所有工位共用「拉椅 + 坐姿人」工作态区域资产；空态 = bg 收椅。
 */
import type { StudioSlot } from './scene-types.ts'
import { GENERATED_LEAD_SEED, GENERATED_OVERFLOW, GENERATED_SEAT_SEEDS } from './scene-office-slots.generated.ts'

type Seed = (typeof GENERATED_SEAT_SEEDS)[number]

function seatSlot(seed: Seed): StudioSlot {
  const side = seed.id.endsWith('1') ? 'left' : 'right'
  return {
    id: seed.id,
    role: 'member',
    anchor: { x: seed.anchor[0], y: seed.anchor[1] },
    station: { x: seed.station[0], y: seed.station[1], w: seed.station[2], h: seed.station[3] },
    side: side as 'left' | 'right',
    capacity: 1,
    anchorStep: 0,
    order: seed.order,
  }
}

/** Lead 位：站姿精灵（接待台旁），无坐姿区域。 */
const LEAD_SLOT: StudioSlot = { ...seatSlot(GENERATED_LEAD_SEED), role: 'lead' }

/** 溢出沙发位：2 座（anchorStep 16），状态走 DOM。 */
const OVERFLOW_SLOT: StudioSlot = {
  id: 'overflow',
  role: 'member',
  anchor: { x: GENERATED_OVERFLOW.x, y: GENERATED_OVERFLOW.y },
  station: {
    x: GENERATED_OVERFLOW.station[0],
    y: GENERATED_OVERFLOW.station[1],
    w: GENERATED_OVERFLOW.station[2],
    h: GENERATED_OVERFLOW.station[3],
  },
  capacity: GENERATED_OVERFLOW.capacity,
  anchorStep: GENERATED_OVERFLOW.step,
  order: 100,
}

export const OFFICE_SLOTS: readonly StudioSlot[] = [
  LEAD_SLOT,
  ...GENERATED_SEAT_SEEDS.map(seatSlot),
  OVERFLOW_SLOT,
]
