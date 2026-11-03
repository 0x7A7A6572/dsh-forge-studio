/**
 * 调试叠层视图：画布 + 控制条 + 实时面板。状态与绘制全在 useStudioDebugLayer。
 */
import type { StudioDebugLayerKey } from '../../../core/pixel/debug-bus.ts'
import { useStudioDebugLayer } from '../useStudioDebugLayer.ts'
import styles from './StudioDebugLayer.module.css'

const LAYERS: readonly { readonly key: StudioDebugLayerKey; readonly label: string }[] = [
  { key: 'showGrid', label: '网格' },
  { key: 'showSlots', label: '槽位' },
  { key: 'showWalk', label: '行走' },
  { key: 'showPath', label: '路径' },
  { key: 'showHitbox', label: '热区' },
]

export function StudioDebugLayer(): JSX.Element {
  const model = useStudioDebugLayer()
  const { ui } = model
  return (
    <div className={styles.layer} ref={model.rootRef}>
      <canvas ref={model.canvasRef} className={styles.canvas} aria-hidden="true" />
      <div className={styles.strip}>
        <button type="button" className={styles.btn} onClick={model.close}>关闭</button>
        <button type="button" className={styles.btn} onClick={model.toggleFrozen}>
          {ui.frozen ? '继续' : '冻结'}
        </button>
        <button type="button" className={styles.btn} onClick={model.stepOnce} disabled={!ui.frozen}>
          步进+1
        </button>
        <button type="button" className={styles.btn} onClick={model.copySnapshot}>复制快照</button>
        {LAYERS.map((layer) => (
          <label key={layer.key} className={styles.chk}>
            <input
              type="checkbox"
              checked={ui.settings[layer.key]}
              onChange={() => model.toggleLayer(layer.key)}
            />
            {layer.label}
          </label>
        ))}
      </div>
      <div className={styles.hover} ref={model.hoverRef} aria-hidden="true" />
      <div className={styles.sandbox}>
        <div className={styles.sandboxBar}>
          <span className={styles.sandboxTitle}>实验</span>
          <button type="button" className={styles.btn} onClick={() => model.addMember()}>＋模拟</button>
          <button
            type="button"
            className={styles.btn}
            disabled={model.members.every((member) => !member.mock)}
            onClick={() => model.clearMembers()}
          >
            清空
          </button>
          <button type="button" className={styles.btn} onClick={() => model.resetScene()}>重置场景</button>
        </div>
        {model.members.map((member) => (
          <div key={member.id} className={styles.sandboxRow}>
            <span className={styles.sandboxName}>{member.name}</span>
            <button
              type="button"
              className={styles.btn}
              data-active={member.visual === 'working'}
              onClick={() => model.toggleRunning(member.id, member.visual === 'working')}
            >
              {member.visual === 'working' ? '停止' : '干活'}
            </button>
            <button
              type="button"
              className={styles.btn}
              data-active={member.visual === 'provisioning'}
              onClick={() => model.setPhase(member.id, member.visual === 'provisioning' ? 'active' : 'provisioning')}
            >
              启动
            </button>
            <button
              type="button"
              className={styles.btn}
              data-active={member.visual === 'error'}
              onClick={() => model.setPhase(member.id, member.visual === 'error' ? 'active' : 'failed')}
            >
              失败
            </button>
            {member.mock && (
              <button
                type="button"
                className={styles.btn}
                aria-label={`移除 ${member.name}`}
                onClick={() => model.removeMember(member.id)}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className={styles.panel} ref={model.panelRef} aria-hidden="true" />
    </div>
  )
}
