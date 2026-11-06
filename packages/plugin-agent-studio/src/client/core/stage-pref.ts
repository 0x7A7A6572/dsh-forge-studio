/**
 * 工作预览开关（插件设置里的偏好项）：localStorage 持久化，默认开启。
 * 关闭后会话头入口隐藏、舞台页显示关闭提示；设置里切换即时生效（onStageChange 通知）。
 */
const STORAGE_KEY = 'agentStudio.stageEnabled'

let enabled = loadEnabled()
const listeners = new Set<() => void>()

function loadEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === null ? true : JSON.parse(raw) !== false
  } catch {
    // 存储不可用（隐私模式等）时用默认值。
    return true
  }
}

export function readStageEnabled(): boolean {
  return enabled
}

export function writeStageEnabled(value: boolean): void {
  if (value === enabled) return
  enabled = value
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // 无存储时仅内存生效。
  }
  for (const listener of listeners) listener()
}

export function onStageChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
