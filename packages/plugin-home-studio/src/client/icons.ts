/**
 * 图标入口（占位）：home-studio 全部 UI 图标统一用 lucide-react，
 * 命名导入即 tree-shake（sideEffects:false，esbuild 只保留用到的图标）。
 *
 * 用法：
 *   import { Pin, Plus, X } from 'lucide-react'
 *   <Pin size={16} style={{ color: 'var(--dsw-alias-label-secondary)' }} />
 *
 * 需要全插件统一的图标别名时，在此集中 re-export，例如：
 *   export { Pin } from 'lucide-react'
 *   export type { LucideIcon } from 'lucide-react'
 */

export type { LucideIcon, LucideProps } from 'lucide-react'
