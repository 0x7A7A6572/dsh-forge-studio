/**
 * id → 角色选型与去重分配：纯函数，不 import react、不触 DOM。
 * 素材优先；atlas 不可用时由 composeAvatar 产出自绘 fallback。
 */
import { fnv1a32 } from './seed-hash.ts'
import { buildFallbackSprite, fallbackSpecFromId } from './avatar-parts.ts'
import type { PixelSprite } from './scene-types.ts'

/** 主题角色面的最小切片：角色 entry 列表 + 每角色变体数。 */
export interface AvatarThemeSpec {
  readonly characters: readonly string[]
  readonly variantCount: number
}

/** 单个成员的选型结果；reused = 组合耗尽后的确定性复用。 */
export interface AvatarAssignment {
  readonly memberId: string
  readonly charIndex: number
  readonly accent: number
  readonly reused: boolean
}

/** 内置主题的角色面：chars 图集 4 个角色基座（entry = `<base>-<pose>`）× 6 个 LUT 强调色。 */
export const BUILTIN_AVATAR_THEME: AvatarThemeSpec = {
  characters: ['char-1', 'char-2', 'char-3', 'char-4'],
  variantCount: 6,
}

export function specFromId(
  id: string,
  charCount: number,
  variantCount: number,
): { charIndex: number; accent: number } {
  const hash = fnv1a32(id)
  return { charIndex: hash % charCount, accent: (hash >>> 8) % variantCount }
}

/**
 * 按 roster 顺序去重分配：撞 (charIndex, accent) 先 variant+1，
 * 变体耗尽换下一个角色；组合全部用尽后保留原选型并标 reused。
 */
export function assignCharacters(
  roster: readonly { readonly id: string }[],
  theme: AvatarThemeSpec = BUILTIN_AVATAR_THEME,
): readonly AvatarAssignment[] {
  const taken = new Set<string>()
  const total = theme.characters.length * theme.variantCount
  return roster.map((member) => {
    const base = specFromId(member.id, theme.characters.length, theme.variantCount)
    for (let step = 0; step < total; step++) {
      const charIndex = (base.charIndex + Math.floor(step / theme.variantCount)) % theme.characters.length
      const accent = (base.accent + step) % theme.variantCount
      const key = `${charIndex}:${accent}`
      if (taken.has(key)) continue
      taken.add(key)
      return { memberId: member.id, charIndex, accent, reused: false }
    }
    return { memberId: member.id, charIndex: base.charIndex, accent: base.accent, reused: true }
  })
}

/** id → 自绘 fallback 精灵（16×24）；素材缺失或 atlasAvailable=false 时使用。 */
export function composeAvatar(id: string): PixelSprite {
  const spec = fallbackSpecFromId(id)
  return buildFallbackSprite(spec.charIndex, spec.accent)
}
