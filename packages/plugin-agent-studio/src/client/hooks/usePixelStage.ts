/**
 * 像素舞台的渲染编排（§6.5）：RAF 12fps 量化、bg/chars 按主题加载重映射、
 * 静态层置脏合成、主题观察与降级。react 侧逻辑都在这里，绘制在 core/pixel/painter-*。
 */
import { useEffect, useRef, type MutableRefObject } from 'react'
import bgPng from '../assets/pixel-office.bg.png'
import charsPng from '../assets/pixel-office.chars.png'
import {
  atlasSizeMatches,
  createAtlasCache,
  decodeAtlasDataUrl,
  decodedToBitmap,
  type AtlasCache,
} from '../core/pixel/atlas.ts'
import { drawStageFrame } from '../core/pixel/painter-frame.ts'
import { drawStaticLayer } from '../core/pixel/painter-static.ts'
import type { AnyCanvas, AnyCtx, StageAssets, StageCaches } from '../core/pixel/painter-types.ts'
import { resolveStagePalette, themeKeyOf, type StagePalette } from '../core/pixel/stage-tokens.ts'
import { advanceTick } from '../core/pixel/stage-clock.ts'
import { composeAvatar } from '../core/pixel/avatar-sprite.ts'
import { onDebugStep, publishDebugFrame, readDebugFrozen } from '../core/pixel/debug-bus.ts'
import type { StudioOccupant, StudioStageModel } from '../core/pixel/scene-types.ts'

const LOGICAL_SCALE = 2

function currentThemeKey(): string {
  if (typeof document === 'undefined') return 'ssr|light'
  const attr = document.body?.dataset.dsDarkTheme
  const prefersDark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  return themeKeyOf(attr, prefersDark)
}

function createLayerCanvas(width: number, height: number): { canvas: AnyCanvas; ctx: AnyCtx } | null {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    return ctx === null ? null : { canvas, ctx: ctx as OffscreenCanvasRenderingContext2D }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  return ctx === null ? null : { canvas, ctx }
}

function prepareCtx(ctx: AnyCtx): void {
  ctx.setTransform(LOGICAL_SCALE, 0, 0, LOGICAL_SCALE, 0, 0)
  ctx.imageSmoothingEnabled = false
}

// bg/chars 可用性的单一来源：loader 应用时更新；模型层经 queryAtlasAvailable 读取。
let latestAtlasAvailable = false

/** 供模型层对齐 atlasAvailable（避免 model=true 但实际是占位图）。 */
export function queryAtlasAvailable(): boolean {
  return latestAtlasAvailable
}

/** 释放被替换的位图；canvas 兜底没有 close，忽略即可。 */
function closeBitmap(bitmap: ImageBitmap | HTMLCanvasElement): void {
  if (typeof (bitmap as ImageBitmap).close === 'function') {
    try {
      ;(bitmap as ImageBitmap).close()
    } catch {
      // 已关闭或实现不支持时忽略。
    }
  }
}

/** bg/chars 可用性单一来源在渲染层：模型声称可用但图是占位时，就地补 fallback。 */
function withFallbacks(model: StudioStageModel, available: boolean): StudioStageModel {
  if (available) return model
  const needsPatch = [...model.occupants, ...model.overflowMembers, ...model.roamers].some(
    (o) => o.character.fallback === undefined,
  )
  if (!needsPatch) return model
  const patch = (occupant: StudioOccupant): StudioOccupant =>
    occupant.character.fallback !== undefined
      ? occupant
      : {
          ...occupant,
          character: {
            ...occupant.character,
            // seed 不可知时用 memberId 兜底（与 avatar-sprite 的确定性一致）。
            fallback: composeAvatar(occupant.memberId),
          },
        }
  return {
    ...model,
    occupants: model.occupants.map(patch),
    overflowMembers: model.overflowMembers.map(patch),
    roamers: model.roamers.map(patch),
  }
}

/** 返回挂到 <canvas> 的 ref；模型变化、tick 推进与主题切换都会触发重绘。 */
export function usePixelStage(
  model: StudioStageModel,
  /** 页签不可见时停 RAF（仍按模型重画一帧，恢复后无缝继续）。 */
  paused = false,
): MutableRefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const modelRef = useRef(model)
  modelRef.current = model
  const tickRef = useRef(0)
  const lastTickMsRef = useRef(0)
  const rafRef = useRef(0)
  const loadTokenRef = useRef(0)
  const themeKeyRef = useRef(currentThemeKey())
  const paletteRef = useRef<StagePalette | null>(null)
  const cacheRef = useRef<AtlasCache | null>(null)
  const assetsRef = useRef<StageAssets>({})
  const availableRef = useRef(false)
  const staticDirtyRef = useRef(true)
  const staticLayerRef = useRef<AnyCanvas | null>(null)
  const cachesRef = useRef<StageCaches>({
    variant: new Map(),
    fallback: new Map(),
    tickStart: new Map(),
  })

  function drawOnce(): void {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    prepareCtx(ctx)
    const palette = paletteRef.current
    if (palette === null) return
    const currentModel = withFallbacks(modelRef.current, availableRef.current)
    if (staticDirtyRef.current || staticLayerRef.current === null) {
      const { width, height } = currentModel.scene.canvas
      let layer = staticLayerRef.current
      if (layer === null) {
        const made = createLayerCanvas(width * LOGICAL_SCALE, height * LOGICAL_SCALE)
        if (made === null) return
        layer = made.canvas
        staticLayerRef.current = layer
      }
      const layerCtx = (layer as HTMLCanvasElement).getContext('2d') ??
        (layer as OffscreenCanvas).getContext('2d')
      if (layerCtx !== null) {
        prepareCtx(layerCtx)
        drawStaticLayer(layerCtx, currentModel.scene, assetsRef.current, palette)
      }
      cachesRef.current.staticLayer = layer
      staticDirtyRef.current = false
    }
    const now = performance.now()
    const reducedMotion =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const drawOpts = {
      tick: tickRef.current,
      // 时钟契约：now 与 memo.doneUntil 必须同一时钟——卡 4 生成 doneUntil
      // 时必须用 performance.now()（state-machine 只做数学，不取时间）。
      now,
      themeKey: themeKeyRef.current,
      palette,
      assets: assetsRef.current,
      reducedMotion,
      caches: cachesRef.current,
    }
    const plan = drawStageFrame(ctx, currentModel, drawOpts)
    publishDebugFrame({
      tick: tickRef.current,
      now,
      themeKey: themeKeyRef.current,
      reducedMotion,
      atlasAvailable: availableRef.current,
      model: currentModel,
      plan,
    })
  }

  function reloadAtlas(): void {
    if (paletteRef.current === null) paletteRef.current = resolveStagePalette()
    if (cacheRef.current === null) cacheRef.current = createAtlasCache()
    const themeKey = themeKeyRef.current
    const token = ++loadTokenRef.current
    const promise = cacheRef.current.getOrLoad(`atlas:${themeKey}`, async () => {
      // bg：层合成产物，原色 1:1（不做 LUT 重映射，§5.2）。
      const bgDecoded = await decodeAtlasDataUrl(bgPng, 'bg')
      // chars 保持原色：强调色变体在每角色画布上单独重映射。
      const charsDecoded = await decodeAtlasDataUrl(charsPng, 'chars')
      // bg/chars 可用性拆开：任一缺失只降级对应层（bg→代码占位背景，chars→角色 fallback）。
      const bgOk = atlasSizeMatches('bg', bgDecoded.width, bgDecoded.height)
      const charsOk = atlasSizeMatches('chars', charsDecoded.width, charsDecoded.height)
      const assets: StageAssets = {}
      if (bgOk) assets.bg = await decodedToBitmap(bgDecoded)
      if (charsOk) assets.charsDecoded = charsDecoded
      const available = bgOk && charsOk
      if (token !== loadTokenRef.current) {
        if (assets.bg !== undefined) closeBitmap(assets.bg.bitmap)
        return []
      }
      // 主题切换保留旧资产直到新图就绪（P2-3）：一次性替换并释放旧位图。
      const previous = assetsRef.current
      assetsRef.current = assets
      availableRef.current = available
      latestAtlasAvailable = available
      if (previous.bg !== undefined && previous.bg !== assets.bg) {
        closeBitmap(previous.bg.bitmap)
      }
      cachesRef.current.variant.clear()
      cachesRef.current.fallback.clear()
      staticDirtyRef.current = true
      drawOnce()
      return assets.bg ? [assets.bg] : []
    })
    // 卸载/切主题时旧加载会被 generation 拒绝；真实失败要留下诊断信息。
    promise.catch((err: unknown) => {
      if (token === loadTokenRef.current) {
        console.warn('[pixel-stage] atlas load failed', err)
      }
    })
  }

  function applyThemeChange(): void {
    const nextKey = currentThemeKey()
    if (nextKey === themeKeyRef.current) return
    themeKeyRef.current = nextKey
    paletteRef.current = resolveStagePalette()
    // clear 旧主题 atlas 缓存并强制重载：A→B→A 每次都执行 loader。
    // 旧 assets 保留到新图就绪再替换，切换期间继续画旧主题（不闪空）。
    cacheRef.current?.clear()
    staticDirtyRef.current = true
    reloadAtlas()
    drawOnce()
  }

  // 主题观察：body 主题属性 + 系统深浅色；变化只重算颜色与 atlas，不重建场景。
  useEffect(() => {
    if (cacheRef.current === null) cacheRef.current = createAtlasCache()
    const caches = cachesRef.current
    const cache = cacheRef.current
    paletteRef.current = resolveStagePalette()
    staticDirtyRef.current = true
    reloadAtlas()
    const observer = new MutationObserver(applyThemeChange)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    const media = matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', applyThemeChange)
    const offStep = onDebugStep(() => {
      if (!readDebugFrozen()) return
      tickRef.current += 1
      drawOnce()
    })
    return () => {
      observer.disconnect()
      media.removeEventListener('change', applyThemeChange)
      offStep()
      loadTokenRef.current += 1
      latestAtlasAvailable = false
      cache.clear()
      assetsRef.current = {}
      caches.variant.clear()
      caches.fallback.clear()
      caches.tickStart.clear()
      caches.staticLayer = undefined
      staticLayerRef.current = null
    }
  }, [])

  // 模型变化：RAF 停止时（隐藏/减动效）也要立刻画出最新模型。
  useEffect(() => {
    drawOnce()
  }, [model])

  // RAF 循环：12fps 量化、掉帧不补帧；隐藏、暂停或减动效时停。
  useEffect(() => {
    let disposed = false
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const loop = () => {
      if (disposed) return
      rafRef.current = requestAnimationFrame(loop)
      // 调试冻结：停 tick 推进但不卸 RAF，步进事件仍能单帧前进。
      if (readDebugFrozen()) return
      const next = advanceTick(tickRef.current, performance.now(), lastTickMsRef.current)
      if (!next.due) return
      tickRef.current = next.tick
      lastTickMsRef.current = next.lastMs
      drawOnce()
    }
    const start = () => {
      if (disposed || rafRef.current !== 0) return
      lastTickMsRef.current = performance.now()
      rafRef.current = requestAnimationFrame(loop)
    }
    const stop = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    const sync = () => {
      if (paused || document.visibilityState === 'hidden' || media.matches) stop()
      else start()
    }
    const onVisibility = () => {
      sync()
      drawOnce()
    }
    const onMotion = () => {
      sync()
      drawOnce()
      // 已知限制：减动效切换不清 tickStart——清掉会连带重置 done/error 的 clip
      // 起点与坐/站相位（跳变更明显）；保留起点使各成员动画无缝继续。
    }
    document.addEventListener('visibilitychange', onVisibility)
    media.addEventListener('change', onMotion)
    sync()
    return () => {
      disposed = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      media.removeEventListener('change', onMotion)
    }
  }, [paused])

  return canvasRef
}
