/**
 * Sweetie16 → DSH token 的 16 项语义色板 LUT。
 * 只含纯数据与逐像素换色，不 import react，也不读 DOM。
 */

export type Rgb = readonly [number, number, number]

/** 一条映射：素材原色 from → 目标 CSS 颜色表达式 token。 */
export interface PixelLutEntry {
  readonly from: Rgb
  readonly token: string
  readonly note: string
}

/** 素材的 16 种不透明色（Sweetie 16），顺序与设计 5.2 表一一对应。 */
export const SWEETIE16_LUT: readonly PixelLutEntry[] = [
  { from: [0x1a, 0x1c, 0x2c], token: 'var(--dsw-alias-bg-base)', note: '描边阴影深色墙' },
  { from: [0x33, 0x3c, 0x57], token: 'var(--dsw-alias-bg-layer-3)', note: '墙阴桌下柜体' },
  { from: [0x56, 0x6c, 0x86], token: 'var(--dsw-alias-label-caption)', note: '隔断椅背设备' },
  { from: [0x94, 0xb0, 0xc2], token: 'var(--dsw-alias-label-tertiary)', note: '高光白板边地缝' },
  { from: [0xf4, 0xf4, 0xf4], token: 'var(--dsw-alias-label-primary)', note: '墙面纸张屏幕' },
  { from: [0x41, 0xa6, 0xf6], token: 'var(--dsw-alias-state-business-primary)', note: '地板天空亮屏' },
  { from: [0x29, 0x36, 0x6f], token: 'var(--dsw-alias-state-business-tertiary)', note: '桌体柜体深屏' },
  {
    from: [0x3b, 0x5d, 0xc9],
    token:
      'color-mix(in srgb, var(--dsw-alias-state-business-primary) 55%, var(--dsw-alias-state-business-tertiary))',
    note: '家具主色屏内容',
  },
  {
    from: [0x73, 0xef, 0xf7],
    token:
      'color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, var(--dsw-alias-label-primary))',
    note: '地板缝水面高光',
  },
  {
    from: [0x25, 0x71, 0x79],
    token:
      'color-mix(in srgb, var(--dsw-alias-state-business-tertiary) 70%, var(--dsw-alias-bg-layer-3))',
    note: '玻璃门阴影',
  },
  { from: [0x38, 0xb7, 0x64], token: 'var(--dsw-alias-state-success-primary)', note: '绿植成功状态' },
  { from: [0xa7, 0xf0, 0x70], token: 'var(--dsw-alias-state-success-secondary)', note: '植物高光贴纸' },
  { from: [0xff, 0xcd, 0x75], token: 'var(--dsw-alias-state-warn-secondary)', note: '灯光纸张皮肤亮部' },
  { from: [0xef, 0x7d, 0x57], token: 'var(--dsw-alias-state-warn-primary)', note: '皮肤橙色家具' },
  { from: [0xb1, 0x3e, 0x53], token: 'var(--dsw-alias-state-error-primary)', note: '椅子警示错误' },
  {
    from: [0x5d, 0x27, 0x5d],
    token:
      'color-mix(in srgb, var(--dsw-alias-state-error-primary) 25%, var(--dsw-alias-state-business-tertiary))',
    note: '装饰个别椅背',
  },
]

/** LUT 目标色的纯输入色（Sweetie16 原值），供测试与调试对照。 */
export const SWEETIE16_INPUTS: readonly Rgb[] = SWEETIE16_LUT.map((e) => e.from)

/** 素材源色 → LUT 目标色的数值键：r<<16 | g<<8 | b。 */
function rgbKey(rgb: Rgb): number {
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
}

/**
 * 按 Sweetie16 源色精确匹配原地换色；lut[i] 是 SWEETIE16_INPUTS[i] 的目标色。
 * 长度必须与 LUT 一致；alpha=0 与未命中像素保持原样。
 */
export function remapImageData(data: Uint8ClampedArray, lut: readonly Rgb[]): void {
  if (lut.length !== SWEETIE16_INPUTS.length) {
    throw new Error(`lut length ${lut.length} != ${SWEETIE16_INPUTS.length}`)
  }
  const table = new Map<number, Rgb>()
  for (let i = 0; i < lut.length; i++) table.set(rgbKey(SWEETIE16_INPUTS[i]), lut[i])
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const hit = table.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
    if (!hit) continue
    data[i] = hit[0]
    data[i + 1] = hit[1]
    data[i + 2] = hit[2]
  }
}
