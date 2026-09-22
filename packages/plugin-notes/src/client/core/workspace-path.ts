/**
 * 工作区路径展示辅助（纯函数，无依赖；host/client/编辑器/设置弹窗共用）。
 *
 * 下拉里只给**文件夹名**：完整绝对路径太长（Windows 还带盘符与多级目录），一整排
 * `D:\codes\...` 反而难扫。但同名目录（例如两个 `src`）必须能分辨，故仅在
 * **同名冲突**时补一层父目录（`parent/name`）。完整路径始终可经 title 悬停查看。
 */

/** 去掉尾部分隔符（`D:/a/b/` → `D:/a/b`）。 */
function stripTrailingSeparators(path: string): string {
  return path.trim().replace(/[\\/]+$/, '')
}

/** 路径末段（文件夹名）；根路径/空串按原样返回。 */
export function folderNameOf(path: string): string {
  const trimmed = stripTrailingSeparators(path)
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

/** 倒数第二段（父目录名）；没有父段时返回空串。 */
export function parentFolderNameOf(path: string): string {
  const trimmed = stripTrailingSeparators(path)
  const parts = trimmed.split(/[\\/]/)
  return parts.length >= 2 ? parts[parts.length - 2] ?? '' : ''
}

/**
 * 一组路径 → 展示标签：默认只有末段文件夹名；**同名冲突**时补父目录段
 * （`parent/name`），保证同一份列表里标签唯一可辨（否则用户会选错目录）。
 */
export function workspaceLabels(paths: readonly string[]): Map<string, string> {
  const names = paths.map(folderNameOf)
  const count = new Map<string, number>()
  for (const name of names) count.set(name, (count.get(name) ?? 0) + 1)
  const labels = new Map<string, string>()
  paths.forEach((path, index) => {
    const name = names[index] ?? path
    if ((count.get(name) ?? 0) <= 1) {
      labels.set(path, name)
      return
    }
    const parent = parentFolderNameOf(path)
    labels.set(path, parent === '' ? name : parent + '/' + name)
  })
  return labels
}

/** 一个下拉选项：完整路径（value/title）+ 只给文件夹名的展示标签。 */
export interface WorkspaceOption {
  readonly path: string
  readonly label: string
}

/**
 * 工作区下拉的选项集：候选目录 + 便签上已存的工作区。
 *
 * 为什么要带上「当前值」：便签里的 workspace 可能不在候选里（旧的显式值，或那个
 * 目录本就不在最近会话列表里）。不列出来，一进编辑器就会因 select 无匹配项而把旧值
 * 静默改掉。空值不占选项，由「请选择工作区」那一项承担（M1-4 起没有默认工作区，
 * 空值就是「还没选」，不再是「用默认」）。
 */
export function workspaceSelectOptions(
  candidates: readonly string[],
  current: string,
): readonly WorkspaceOption[] {
  const paths = [...candidates]
  const trimmed = current.trim()
  if (trimmed !== '' && !paths.includes(trimmed)) paths.push(trimmed)
  const labels = workspaceLabels(paths)
  return paths.map((path) => ({ path, label: labels.get(path) ?? folderNameOf(path) }))
}
