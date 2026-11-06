// 生成文件：scripts/build-pixel-atlas.mjs --compose-bg（真源 = pixel-office.placement.json），勿手改。
export interface GeneratedSeatSeed {
  id: string
  order: number
  anchor: [number, number]
  station: [number, number, number, number]
}

export const GENERATED_SEAT_SEEDS: readonly GeneratedSeatSeed[] = [
  { id: 'seat-A1', order: 1, anchor: [34, 112], station: [23, 93, 39, 30] },
  { id: 'seat-A2', order: 2, anchor: [94, 112], station: [63, 93, 39, 30] },
  { id: 'seat-B1', order: 3, anchor: [34, 141], station: [23, 123, 39, 30] },
  { id: 'seat-B2', order: 4, anchor: [94, 141], station: [63, 123, 39, 30] },
  { id: 'seat-C1', order: 5, anchor: [168, 112], station: [157, 93, 39, 30] },
  { id: 'seat-C2', order: 6, anchor: [228, 112], station: [197, 93, 39, 30] },
  { id: 'seat-D1', order: 7, anchor: [168, 141], station: [157, 123, 39, 30] },
  { id: 'seat-D2', order: 8, anchor: [228, 141], station: [197, 123, 39, 30] },
]

export const GENERATED_LEAD_SEED: GeneratedSeatSeed = { id: 'lead', order: 0, anchor: [174, 83], station: [157, 63, 43, 30] }

export const GENERATED_OVERFLOW = { x: 46, y: 171, step: 15, capacity: 2, station: [35, 160, 33, 16], labelAnchor: [47, 156] } as const
