/**
 * bot 头像选型：worker 机器人 4 种形状 × 5 种配色 + 团队章，共 21 帧。
 * 形状按 profile.id 确定性；配色档位可在设置里显式指定，缺省取形状序号。
 * 纯函数，不 import react、不触 DOM。
 */
import { fnv1a32 } from './seed-hash.ts'

/** 精灵图单帧边长（src/client/assets/bot-avatars.png 的帧规格，菱形 13px 宽决定）。 */
export const BOT_AVATAR_FRAME = 13
export const BOT_SHAPE_COUNT = 4
export const BOT_SCHEME_COUNT = 5
/** 团队章固定帧号（资产表最后一帧）。 */
export const BOT_TEAM_FRAME = BOT_SHAPE_COUNT * BOT_SCHEME_COUNT
export const BOT_FRAME_COUNT = BOT_TEAM_FRAME + 1

/** 配色档位色值（设置页色块用）。 */
export const BOT_SCHEME_HEX: readonly string[] = [
  '#4da6ff',
  '#a78bfa',
  '#4ade80',
  '#fb923c',
  '#fb7185',
]

export function botShapeIndex(id: string): number {
  return fnv1a32(id) % BOT_SHAPE_COUNT
}

/** 帧号 = shape × 5 + scheme；scheme 缺省取形状序号。 */
export function botAvatarFrame(id: string, scheme?: number): number {
  const shape = botShapeIndex(id)
  const resolved = scheme ?? shape
  return shape * BOT_SCHEME_COUNT + Math.min(resolved, BOT_SCHEME_COUNT - 1)
}
