// 生成文件：scripts/build-pixel-atlas.mjs --compose-bg（真源 = pixel-office.placement.json），勿手改。
export interface GeneratedSeatSeed {
  id: string
  order: number
  anchor: [number, number]
  station: [number, number, number, number]
}

export const GENERATED_SEAT_SEEDS: readonly GeneratedSeatSeed[] = [
  { id: 'seat-A1', order: 1, anchor: [34, 92], station: [23, 73, 39, 30] },
  { id: 'seat-A2', order: 2, anchor: [94, 92], station: [63, 73, 39, 30] },
  { id: 'seat-B1', order: 3, anchor: [34, 121], station: [23, 103, 39, 30] },
  { id: 'seat-B2', order: 4, anchor: [94, 121], station: [63, 103, 39, 30] },
  { id: 'seat-C1', order: 5, anchor: [168, 92], station: [157, 73, 39, 30] },
  { id: 'seat-C2', order: 6, anchor: [228, 92], station: [197, 73, 39, 30] },
  { id: 'seat-D1', order: 7, anchor: [168, 121], station: [157, 103, 39, 30] },
  { id: 'seat-D2', order: 8, anchor: [228, 121], station: [197, 103, 39, 30] },
]

export const GENERATED_LEAD_SEED: GeneratedSeatSeed = { id: 'lead', order: 0, anchor: [174, 63], station: [157, 43, 43, 30] }

export const GENERATED_OVERFLOW = { x: 46, y: 151, step: 15, capacity: 2, station: [35, 140, 33, 16], labelAnchor: [47, 136] } as const
