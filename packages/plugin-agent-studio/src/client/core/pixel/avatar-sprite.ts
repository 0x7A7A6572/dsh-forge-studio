/**
 * seed → 角色选型与去重分配（§6.6/§10.8）：纯函数，不 import react、不触 DOM。
 * 素材优先；atlas 不可用时由 composeAvatar 产出同 seed 的自绘 fallback。
 */
import { fnv1a32 } from './seed-hash.ts'
import { buildFallbackIcon, buildFallbackSprite, fallbackSpecFromSeed } from './avatar-parts.ts'
import type { PixelSprite } from './scene-types.ts'

/** §6.6 输入：seed 取 profile.avatarSeed（'default'/空退回 fallback = profile.id）。 */
export interface AvatarSeedInput {
  readonly seed: string
  readonly fallback: string
}

/** 主题角色面的最小切片（§10.8）：角色 entry 列表 + 每角色变体数。 */
export interface AvatarThemeSpec {
  readonly characters: readonly string[]
  readonly variantCount: number
}

/** 单个成员的选型结果；reused = 组合耗尽后的确定性复用（§10.8）。 */
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

export function specFromSeed(
  seed: string,
  fallback: string,
  charCount: number,
  variantCount: number,
): { charIndex: number; accent: number } {
  const effective = seed !== 'default' && seed.trim() !== '' ? seed : fallback
  const hash = fnv1a32(effective)
  return { charIndex: hash % charCount, accent: (hash >>> 8) % variantCount }
}

function entryFor(theme: AvatarThemeSpec, charIndex: number): string {
  return theme.characters[charIndex % theme.characters.length]
}

/** 头像变体缓存键（卡 6）：主题隔离开换主题，entry+accent 隔离变体。 */
export function avatarCacheKey(themeKey: string, entry: string, accent: number): string {
  return `${themeKey}:${entry}:${accent}`
}

/** 单人选型（不去重）：同 seed 恒同组合。 */
export function pickCharacter(
  input: AvatarSeedInput,
  theme: AvatarThemeSpec = BUILTIN_AVATAR_THEME,
): { entry: string; accent: number } {
  const spec = specFromSeed(input.seed, input.fallback, theme.characters.length, theme.variantCount)
  return { entry: entryFor(theme, spec.charIndex), accent: spec.accent }
}

/**
 * 按 roster 顺序去重分配（§6.6 第 3 条）：撞 (charIndex, accent) 先 variant+1，
 * 变体耗尽换下一个角色；组合全部用尽后保留原选型并标 reused。
 */
export function assignCharacters(
  roster: readonly { readonly id: string; readonly seed: string }[],
  theme: AvatarThemeSpec = BUILTIN_AVATAR_THEME,
): readonly AvatarAssignment[] {
  const taken = new Set<string>()
  const total = theme.characters.length * theme.variantCount
  return roster.map((member) => {
    const base = specFromSeed(member.seed, member.id, theme.characters.length, theme.variantCount)
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

/** seed → 自绘 fallback 精灵（16×24）；素材缺失或 atlasAvailable=false 时使用。 */
export function composeAvatar(seed: string, fallbackId: string): PixelSprite {
  const spec = fallbackSpecFromSeed(seed, fallbackId)
  return buildFallbackSprite(spec.charIndex, spec.accent)
}

/** seed → 自绘 8×8 图标（chip/设置行 fallback 用）。 */
export function composeAvatarIcon(seed: string, fallbackId: string): PixelSprite {
  const spec = fallbackSpecFromSeed(seed, fallbackId)
  return buildFallbackIcon(spec.charIndex)
}
