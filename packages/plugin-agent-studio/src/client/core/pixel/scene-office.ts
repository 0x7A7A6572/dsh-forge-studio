/**
 * 办公室场景包：纯数据，无函数。
 * 坐姿统一：工作态「拉椅 + 坐姿人」为区域资产（pixel-office.work.png），
 * 帧表只含位移与头顶特效（无屏幕——显示器为侧面摆设）；provisioning 为落入动画。
 */
import type {
  PixelPoint,
  StudioAnimationFrame,
  StudioAnimationClip,
  StudioScenePack,
  StudioVisualState,
} from './scene-types.ts'
import { BUILTIN_STATE_MAPPING } from './scene-types.ts'
import { OFFICE_SLOTS } from './scene-office-slots.ts'

const frame = (index: number, offset: PixelPoint, effects: readonly string[] = []): StudioAnimationFrame => ({
  index,
  offset,
  effects,
})

/** 帧表：帧数/帧率/循环与验收口径一致；头顶特效（贴纸/星/爆炸/烟）保留。 */
const CLIPS: Readonly<Record<StudioVisualState, StudioAnimationClip>> = {
  idle: {
    state: 'idle',
    frameCount: 2,
    fps: 6,
    loop: true,
    holdMs: 0,
    frames: [
      frame(0, { x: 0, y: 0 }),
      frame(1, { x: 0, y: -1 }),
    ],
  },
  working: {
    state: 'working',
    frameCount: 4,
    fps: 6,
    loop: true,
    holdMs: 0,
    frames: [
      frame(0, { x: 0, y: 0 }),
      frame(1, { x: 0, y: -1 }),
      frame(2, { x: 0, y: 0 }),
      frame(3, { x: 0, y: 0 }),
    ],
  },
  done: {
    state: 'done',
    frameCount: 8,
    fps: 12,
    loop: false,
    holdMs: 2400,
    // 播完后的「淡出 2 帧」不做成帧：用 opacity 渐隐实现。
    frames: [
      frame(0, { x: 0, y: 0 }),
      frame(1, { x: 0, y: -1 }, ['sticker']),
      frame(2, { x: 0, y: -3 }, ['sticker']),
      frame(3, { x: 0, y: -5 }, ['sticker']),
      frame(4, { x: 0, y: -5 }, ['star']),
      frame(5, { x: 0, y: -5 }, ['star']),
      frame(6, { x: 0, y: -5 }, ['star']),
      frame(7, { x: 0, y: 0 }),
    ],
  },
  error: {
    state: 'error',
    frameCount: 4,
    fps: 8,
    loop: false,
    holdMs: 0,
    frames: [
      frame(0, { x: 0, y: 0 }),
      frame(1, { x: 0, y: 0 }),
      frame(2, { x: 0, y: 0 }, ['bang', 'smoke']),
      frame(3, { x: 0, y: 0 }, ['smoke']),
    ],
  },
  provisioning: {
    state: 'provisioning',
    frameCount: 6,
    fps: 12,
    loop: true,
    holdMs: 0,
    // 落入：坐姿区域从工位上方 8px 落到位。
    frames: [
      frame(0, { x: 0, y: -8 }),
      frame(1, { x: 0, y: -8 }),
      frame(2, { x: 0, y: -5 }),
      frame(3, { x: 0, y: -2 }),
      frame(4, { x: 0, y: 0 }),
      frame(5, { x: 0, y: 0 }),
    ],
  },
}

/** 内置办公室场景；等于一个 colorMode: 'token-lut' 的内置主题包（§6.4 v3 衔接）。 */
export const OFFICE_SCENE: StudioScenePack = {
  id: 'office',
  name: '办公室',
  description: '开放办公区：Lead 主管桌靠窗，成员共享工位（干活的坐拉椅），溢出进候客沙发区。',
  canvas: { width: 256, height: 224, cell: 8 },
  spriteDrawBox: { width: 24, height: 36 },
  scalePolicy: 'native-1x',
  atlas: { bg: 'pixel-office.bg', chars: 'pixel-office.chars' },
  states: BUILTIN_STATE_MAPPING,
  clips: CLIPS,
  layers: [
    { id: 'background', kind: 'background', static: true, z: 0 },
    { id: 'furniture', kind: 'furniture', static: true, z: 1 },
    { id: 'character', kind: 'character', static: false, z: 2 },
    { id: 'effects', kind: 'effects', static: false, z: 3 },
    { id: 'overlay', kind: 'overlay', static: false, z: 4 },
  ],
  slots: OFFICE_SLOTS,
  overflow: 'queue',
  ambient: [],
}

/**
 * 坐姿帧相对脚底锚点的额外下移：坐姿帧含下垂的腿，臀部落点在帧内 ≈ 底边上方 9px；
 * 锚点 = 椅面中心，故帧底要沉到锚点下方，臀部才落在椅面上。
 */
export const SIT_FRAME_DROP = 9

/**
 * 坐姿帧相对脚底锚点的水平微调（屏幕坐标）：共享工位两侧人物对齐椅子——
 * 西椅（尾数 1，左侧）右移 5px，东椅（尾数 2，右侧）左移 10px；lead/沙发溢出位不微调。
 */
export const SIT_FRAME_SHIFT_WEST = 5
export const SIT_FRAME_SHIFT_EAST = -10

/** 座位朝向：西侧椅子（id 尾数 1）的人面朝东，东侧面朝西（默认精灵朝左）。 */
export function seatSideOf(slot: { readonly id: string }): 'west' | 'east' {
  return slot.id.endsWith('1') ? 'west' : 'east'
}
