/**
 * 像素头像：worker 机器人 21 帧精灵图，按 profile.id + 配色档位取帧。
 * chip 选项（28）与设置行（32）共用，canvas 拉伸 + CSS pixelated。
 */
import { useEffect, useRef, useState } from 'react'
import sheetPng from '../assets/bot-avatars.png'
import { BOT_AVATAR_FRAME, BOT_FRAME_COUNT, botAvatarFrame } from '../core/pixel/bot-avatar.ts'

let sheetPromise: Promise<HTMLImageElement | null> | null = null

function sheetImage(): Promise<HTMLImageElement | null> {
  sheetPromise ??= new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = sheetPng
  })
  return sheetPromise
}

export interface PixelAvatarProps {
  /** 取形状键：同 id 恒同形状。 */
  readonly id: string
  /** 槽位边长（chip 选项 28 / 设置行 32）。 */
  readonly size: number
  /** 配色档位 0..4；缺省按形状取默认色。 */
  readonly color?: number
  /** 帧覆盖项（团队章等固定帧）；缺省按 id + color 解析。 */
  readonly overrideFrame?: number
}

export function PixelAvatar({ id, size, color, overrideFrame }: PixelAvatarProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    setFailed(false)
    void sheetImage().then((image) => {
      if (cancelled) return
      const canvas = canvasRef.current
      const ctx = canvas !== null ? canvas.getContext('2d') : null
      if (image === null || ctx === null) {
        setFailed(true)
        return
      }
      const frame = Math.min(overrideFrame ?? botAvatarFrame(id, color), BOT_FRAME_COUNT - 1)
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, size, size)
      ctx.drawImage(
        image,
        frame * BOT_AVATAR_FRAME, 0, BOT_AVATAR_FRAME, BOT_AVATAR_FRAME,
        0, 0, size, size,
      )
    })
    return () => { cancelled = true }
  }, [id, size, color, overrideFrame])

  // 素材完全不可用时的最后兜底：一枚 token 色圆点，保证不空白。
  if (failed) {
    return (
      <span
        style={{ width: size, height: size, borderRadius: size / 4, background: 'var(--dsw-alias-state-business-primary)' }}
        aria-hidden="true"
      />
    )
  }
  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
      aria-hidden="true"
    />
  )
}
