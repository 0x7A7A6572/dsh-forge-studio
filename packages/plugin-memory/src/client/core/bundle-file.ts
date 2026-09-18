/**
 * 备份文件的浏览器侧读写。
 *
 * 导出走 Blob + <a download>，导入走 <input type="file"> 读文本 —— 全程不经过 host，
 * 因为文件本来就只在浏览器和用户的磁盘之间流动，绕一圈没必要也不安全。
 */

/** 备份文件里各部分的条数（选完文件先亮给用户看，免得导错文件）。 */
export interface BundlePeek {
  readonly records: number
  readonly entities: number
  readonly edges: number
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** 备份文件名：memory-backup-YYYYMMDD-HHmmss.json（固定宽度，字典序即时间序）。 */
export function bundleFileName(at: number = Date.now()): string {
  const d = new Date(at)
  return 'memory-backup-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
    + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + '.json'
}

/** 触发浏览器下载一段文本。 */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 立刻 revoke 有的浏览器还没把数据取走，挪到下一轮事件循环再回收。
  setTimeout(() => { URL.revokeObjectURL(url) }, 0)
}

/** 读一个文件为文本（UTF-8）。 */
export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { resolve(typeof reader.result === 'string' ? reader.result : '') }
    reader.onerror = () => { reject(new Error('读取文件失败，试试把它复制到本地再选')) }
    reader.readAsText(file, 'utf-8')
  })
}

/**
 * 选完文件先peek一眼：不是 JSON / 不是本插件的备份 / 条数是多少。
 * 这里只做够用的浅校验（真正写库前的完整校验在 host 的 validateMemoryBundle），
 * 目的是让用户在点「导入」之前就知道自己选错了没有。
 */
export function peekBundle(text: string): BundlePeek {
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    throw new Error('这个文件不是 JSON，可能选错了')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('这个文件不是 JSON 对象')
  const record = raw as Record<string, unknown>
  if (record.schema !== 'memory-bundle') throw new Error('不是 plugin-memory 的备份文件')
  if (!Array.isArray(record.records) || !Array.isArray(record.entities) || !Array.isArray(record.edges)) {
    throw new Error('备份文件结构不完整（缺 records / entities / edges）')
  }
  return { records: record.records.length, entities: record.entities.length, edges: record.edges.length }
}
