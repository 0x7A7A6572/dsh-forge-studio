/**
 * L4 标签锚点：实时头顶 = 绘制精灵顶边 − 固定间距。
 * 与 painter-frame 同口径：坐姿帧含 SIT_FRAME_DROP 下坠、行走帧比站姿高 1-3px，
 * 否则坐下的人标签会漂离头顶。纯函数放 core：视图与测试共用同一口径，spec 不必 import view（tsx）。
 */
import { findAtlasEntry } from './atlas.ts'
import { SIT_FRAME_DROP } from './scene-office.ts'
import type { PixelPoint, StudioOccupant } from './scene-types.ts'

/** 标签与头顶的固定间距（px）。 */
export const LABEL_HEAD_GAP_PX = 4

/** 标签锚点：随 foot 移动（姿态口径与 painter 一致：坐姿下沉、行走帧更高）。 */
export function labelAnchorOf(occupant: StudioOccupant): PixelPoint {
  // 在座非 idle = 坐姿帧（含 9px 下坠）；在座 idle = 站姿帧；游走/归位 = 行走帧。
  const pose = occupant.seated
    ? (occupant.visual === 'idle' ? 'idle' : 'sit')
    : 'walk-1'
  const entry = findAtlasEntry(`${occupant.character.entry}-${pose}`) ??
    findAtlasEntry(occupant.character.entry)
  const height = entry?.h ?? 24
  return {
    x: occupant.foot.x,
    y: occupant.foot.y - height + (pose === 'sit' ? SIT_FRAME_DROP : 0) - LABEL_HEAD_GAP_PX,
  }
}
