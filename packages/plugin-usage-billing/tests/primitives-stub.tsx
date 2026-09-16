/**
 * `@deepseek-ai/dsh-client-ui-primitives` 的测试替身。
 *
 * 宿主原语是**浏览器包**：`lib/index.js` 里 import 了 `clsx` 等只在宿主 app 打包时
 * 才解析得到的依赖，Node 里直接 import 会 `Cannot find package 'clsx'`。
 * plugin-memory / plugin-daily-log 的用法都是本地 `vi.mock` 一个透传壳，这里沿用同一姿态 ——
 * 测的是「我们给原语传了什么、界面结构是什么」，而不是宿主原语自己怎么渲染。
 *
 * 替身刻意**保真**的三处（否则用例会假绿）：
 * - `Modal` 真的 `createPortal(..., document.body)` —— 弹窗内容的查询必须走 `document`，
 *   用 `render` 返回的 container 会永远查不到（那正是真环境里的行为）。
 * - `Switch` 保留 `role="switch"` + `aria-checked` + 必填可访问名。
 * - `Button` / `Pill` 透传 `disabled` / `aria-*` / `onClick`。
 */

import { useEffect } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Button({
  variant, size, icon, className, children, ...rest
}: {
  variant?: string
  size?: string
  icon?: ReactNode
  className?: string
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  void variant; void size; void icon
  return (
    <button type={rest.type ?? 'button'} {...rest} className={className}>{children}</button>
  )
}

export function Input({
  icon, className, ...rest
}: { icon?: ReactNode; className?: string } & InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  void icon
  return <span className={className}><input {...rest} /></span>
}

export function Pill({
  active, className, children, onClick, ...rest
}: {
  active?: boolean
  className?: string
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const marker = active === true ? 'true' : undefined
  if (onClick === undefined) return <span className={className} data-active={marker}>{children}</span>
  return (
    <button type="button" className={className} data-active={marker} onClick={onClick} {...rest}>
      {children}
    </button>
  )
}

export function Tag({
  tone, className, children,
}: { tone?: string; className?: string; children?: ReactNode }): JSX.Element {
  return <span className={className} data-tone={tone ?? 'outline'}>{children}</span>
}

export function Switch({
  checked, onChange, label, disabled = false, title, className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  title?: string
  className?: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      className={className}
      onClick={() => { onChange(!checked) }}
    >
      <span />
    </button>
  )
}

export function Modal({
  open, onClose, title, closeLabel, description, children, footer, className, contentClassName,
}: {
  open: boolean
  onClose: () => void
  title: string
  closeLabel?: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  className?: string
  contentClassName?: string
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, onClose])
  if (!open) return null
  return createPortal((
    <div role="presentation">
      <div aria-hidden="true" onClick={onClose} />
      <div className={className} role="dialog" aria-modal="true" aria-label={title}>
        <div className={contentClassName}>
          <h2>{title}</h2>
          <button type="button" aria-label={closeLabel} onClick={onClose}>×</button>
          {description === undefined ? null : <p>{description}</p>}
          {children}
        </div>
        {footer === undefined ? null : <div>{footer}</div>}
      </div>
    </div>
  ), document.body)
}
