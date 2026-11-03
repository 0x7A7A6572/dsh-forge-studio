/**
 * 调试叠层逻辑：订阅帧快照与设置变化，画布绘制、指针读数、复制、冻结/步进。
 * 指针事件挂在父容器（场景盒）上：叠层本体 pointer-events none，不挡热区。
 */
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  addDebugSandboxMember,
  clearDebugSandboxMembers,
  onDebugChange,
  onDebugFrame,
  readDebugFrame,
  readDebugFrozen,
  readDebugSettings,
  removeDebugSandboxMember,
  requestDebugMemoReset,
  setDebugFrozen,
  setDebugMemberPhase,
  setDebugMemberRunning,
  stepDebug,
  updateDebugSettings,
  type StudioDebugLayerKey,
  type StudioDebugSettings,
} from '../../core/pixel/debug-bus.ts'
import type { StudioMemberPhase } from '../../core/pixel/state-machine.ts'
import { drawDebugOverlay } from '../../core/pixel/debug-overlay-painter.ts'
import {
  debugGlobalLines,
  debugMemberLines,
  debugMemberRows,
  debugSnapshotText,
  describePoint,
  type DebugMemberRow,
} from '../../core/pixel/debug-text.ts'
import type { PixelPoint } from '../../core/pixel/scene-types.ts'

const CANVAS_W = 256
const CANVAS_H = 224

export type DebugUiState = {
  readonly settings: StudioDebugSettings
  readonly frozen: boolean
}

export interface StudioDebugLayerModel {
  readonly ui: DebugUiState
  /** 实验沙盒的成员行（250ms 采样自帧快照；React 渲染保证按钮稳定可点）。 */
  readonly members: readonly DebugMemberRow[]
  readonly rootRef: MutableRefObject<HTMLDivElement | null>
  readonly canvasRef: MutableRefObject<HTMLCanvasElement | null>
  readonly panelRef: MutableRefObject<HTMLDivElement | null>
  readonly hoverRef: MutableRefObject<HTMLDivElement | null>
  toggleLayer(key: StudioDebugLayerKey): void
  toggleFrozen(): void
  stepOnce(): void
  copySnapshot(): void
  close(): void
  addMember(): void
  removeMember(id: string): void
  clearMembers(): void
  toggleRunning(id: string, currentlyRunning: boolean): void
  setPhase(id: string, phase: StudioMemberPhase): void
  resetScene(): void
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function renderPanel(panel: HTMLDivElement | null, frame: ReturnType<typeof readDebugFrame>): void {
  if (panel === null || frame === null) return
  const global = debugGlobalLines(frame)
    .map((line) => `<div class="global">${escapeHtml(line)}</div>`)
    .join('')
  const members = debugMemberLines(frame)
    .map((line) => `<div${line.state === undefined ? '' : ` data-state="${line.state}"`}>${escapeHtml(line.text)}</div>`)
    .join('')
  panel.innerHTML = global + members
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function sameRows(
  prev: readonly DebugMemberRow[],
  next: readonly DebugMemberRow[],
): boolean {
  return (
    prev.length === next.length &&
    prev.every((row, index) => {
      const other = next[index]
      return other !== undefined &&
        row.id === other.id &&
        row.name === other.name &&
        row.visual === other.visual &&
        row.mock === other.mock
    })
  )
}

function sizeCanvas(canvas: HTMLCanvasElement | null, root: HTMLDivElement | null): boolean {
  if (canvas === null || root === null) return false
  const width = Math.max(1, Math.round(root.clientWidth))
  const height = Math.max(1, Math.round(root.clientHeight))
  if (canvas.width === width && canvas.height === height) return false
  canvas.width = width
  canvas.height = height
  return true
}

export function useStudioDebugLayer(): StudioDebugLayerModel {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const hoverRef = useRef<HTMLDivElement | null>(null)
  const hoverPointRef = useRef<PixelPoint | null>(null)
  const [ui, setUi] = useState<DebugUiState>(() => ({
    settings: readDebugSettings(),
    frozen: readDebugFrozen(),
  }))
  const [members, setMembers] = useState<readonly DebugMemberRow[]>([])

  // 沙盒成员行低频采样：React 稳定渲染按钮；面板数值仍走 12fps innerHTML。
  useEffect(() => {
    const sample = () => {
      const rows = debugMemberRows(readDebugFrame())
      setMembers((prev) => (sameRows(prev, rows) ? prev : rows))
    }
    sample()
    const timer = window.setInterval(sample, 250)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const sync = () => setUi({ settings: { ...readDebugSettings() }, frozen: readDebugFrozen() })
    const draw = () => {
      const canvas = canvasRef.current
      if (canvas === null) return
      sizeCanvas(canvas, rootRef.current)
      const ctx = canvas.getContext('2d')
      if (ctx === null) return
      drawDebugOverlay(ctx, { width: canvas.width, height: canvas.height }, hoverPointRef.current)
    }
    const render = () => renderPanel(panelRef.current, readDebugFrame())
    const onFrame = () => {
      draw()
      render()
    }
    const offChange = onDebugChange(() => {
      sync()
      draw()
      render()
    })
    const offFrame = onDebugFrame(onFrame)
    const root = rootRef.current
    let observer: ResizeObserver | null = null
    const scene = root?.parentElement ?? null
    const toLogical = (event: MouseEvent): PixelPoint | null => {
      if (scene === null) return null
      const rect = scene.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      return {
        x: ((event.clientX - rect.left) / rect.width) * CANVAS_W,
        y: ((event.clientY - rect.top) / rect.height) * CANVAS_H,
      }
    }
    const showHover = (text: string) => {
      if (hoverRef.current !== null) hoverRef.current.textContent = text
    }
    const onMove = (event: MouseEvent) => {
      const point = toLogical(event)
      hoverPointRef.current = point
      showHover(point === null ? '' : describePoint(point, readDebugFrame()))
      draw()
    }
    const onLeave = () => {
      hoverPointRef.current = null
      showHover('')
      draw()
    }
    const onClick = (event: MouseEvent) => {
      const point = toLogical(event)
      if (point === null) return
      void copyText(describePoint(point, readDebugFrame())).then((ok) => {
        showHover(ok ? '已复制坐标 ✓' : '复制失败（剪贴板不可用）')
        window.setTimeout(() => {
          if (hoverRef.current !== null) hoverRef.current.textContent = ''
        }, 1200)
      })
    }
    if (root !== null) {
      observer = new ResizeObserver(() => draw())
      observer.observe(root)
      scene?.addEventListener('mousemove', onMove)
      scene?.addEventListener('mouseleave', onLeave)
      scene?.addEventListener('click', onClick)
    }
    draw()
    render()
    return () => {
      offChange()
      offFrame()
      observer?.disconnect()
      scene?.removeEventListener('mousemove', onMove)
      scene?.removeEventListener('mouseleave', onLeave)
      scene?.removeEventListener('click', onClick)
    }
  }, [])

  return {
    ui,
    members,
    rootRef,
    canvasRef,
    panelRef,
    hoverRef,
    toggleLayer: (key) => {
      updateDebugSettings({ [key]: !readDebugSettings()[key] })
    },
    toggleFrozen: () => {
      setDebugFrozen(!readDebugFrozen())
    },
    stepOnce: () => {
      stepDebug()
    },
    copySnapshot: () => {
      const frame = readDebugFrame()
      if (frame === null) return
      void copyText(debugSnapshotText(frame)).then((ok) => {
        if (hoverRef.current !== null) {
          hoverRef.current.textContent = ok ? '已复制快照 ✓' : '复制失败（剪贴板不可用）'
          window.setTimeout(() => {
            if (hoverRef.current !== null) hoverRef.current.textContent = ''
          }, 1200)
        }
      })
    },
    close: () => {
      updateDebugSettings({ enabled: false })
    },
    addMember: () => {
      addDebugSandboxMember()
    },
    removeMember: (id) => {
      removeDebugSandboxMember(id)
    },
    clearMembers: () => {
      clearDebugSandboxMembers()
    },
    toggleRunning: (id, currentlyRunning) => {
      setDebugMemberRunning(id, !currentlyRunning)
    },
    setPhase: (id, phase) => {
      setDebugMemberPhase(id, phase)
    },
    resetScene: () => {
      requestDebugMemoReset()
    },
  }
}
