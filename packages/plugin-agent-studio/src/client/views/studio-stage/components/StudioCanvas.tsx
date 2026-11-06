/**
 * 像素舞台画布组件：canvas 角色与无障碍名在此，绘制编排交给 usePixelStage。
 */
import type { StudioStageModel } from '../../../core/pixel/scene-types.ts'
import { usePixelStage } from '../../../hooks/usePixelStage.ts'
import styles from './StudioCanvas.module.css'

function ariaLabelOf(model: StudioStageModel): string {
  const all = [...model.occupants, ...model.overflowMembers, ...model.roamers]
  const running = all.filter((o) => o.visual === 'working').length
  const idle = all.filter((o) => o.visual === 'idle').length
  const failed = all.filter((o) => o.visual === 'error').length
  return `团队 ${all.length} 人：${running} 运行中，${idle} 空闲，${failed} 失败`
}

export function StudioCanvas({ model, paused = false }: {
  readonly model: StudioStageModel
  /** 页签不可见时暂停 RAF（挂载状态由 keepMounted 保留）。 */
  readonly paused?: boolean
}) {
  const canvasRef = usePixelStage(model, paused)
  return (
    <div className={styles.container}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label={ariaLabelOf(model)}
        width={model.scene.canvas.width * 2}
        height={model.scene.canvas.height * 2}
      />
    </div>
  )
}
