import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import controls from '../styles/notes-controls.module.css'

export interface NoteSelectOption {
  readonly value: string
  readonly label: string
  readonly title?: string
  readonly disabled?: boolean
}

export interface NoteSelectGroup {
  readonly label: string
  readonly options: readonly NoteSelectOption[]
}

export interface NoteSelectProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly options?: readonly NoteSelectOption[]
  readonly groups?: readonly NoteSelectGroup[]
  readonly disabled?: boolean
  readonly ariaLabel: string
  readonly title?: string
  readonly variant?: 'default' | 'inline'
  readonly maxWidth?: number
  readonly style?: React.CSSProperties
}

const EDGE = 8
const MENU_MAX = 320

interface MenuPos {
  readonly left: number
  readonly width: number
  readonly top?: number
  readonly bottom?: number
  readonly maxHeight: number
}

export function NoteSelect(props: NoteSelectProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()
  const variant = props.variant ?? 'default'

  const groups = useMemo<readonly NoteSelectGroup[]>(() => {
    if (props.groups !== undefined) return props.groups
    const flat = props.options ?? []
    return flat.length === 0 ? [] : [{ label: '', options: flat }]
  }, [props.groups, props.options])

  const allOptions = useMemo(() => groups.flatMap((group) => group.options), [groups])
  const current = useMemo(
    () => allOptions.find((option) => option.value === props.value),
    [allOptions, props.value],
  )
  const navigable = useMemo(
    () => allOptions.map((option, index) => (option.disabled === true ? -1 : index)).filter((index) => index >= 0),
    [allOptions],
  )

  const close = (focusTrigger: boolean): void => {
    setOpen(false)
    setActive(-1)
    if (focusTrigger) triggerRef.current?.focus()
  }

  const openMenu = (): void => {
    if (props.disabled === true) return
    const index = allOptions.findIndex((option) => option.value === props.value)
    setActive(navigable.includes(index) ? index : (navigable[0] ?? -1))
    setOpen(true)
  }

  const pick = (option: NoteSelectOption): void => {
    if (option.disabled === true) return
    props.onChange(option.value)
    close(true)
  }

  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const node = triggerRef.current
      if (node === null) return
      const rect = node.getBoundingClientRect()
      const below = window.innerHeight - rect.bottom - EDGE
      const above = rect.top - EDGE
      const useAbove = below < Math.min(220, above) && above > below
      const space = Math.max(120, Math.min(MENU_MAX, useAbove ? above : below))
      setPos({
        left: Math.max(EDGE, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 180) - EDGE)),
        width: Math.max(rect.width, 180),
        ...(useAbove ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
        maxHeight: space,
      })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) === true) return
      if (menuRef.current?.contains(target) === true) return
      close(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  useEffect(() => {
    if (!open || active < 0) return
    const node = menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const step = (delta: number): void => {
    if (navigable.length === 0) return
    const at = navigable.indexOf(active)
    const next = at < 0 ? (delta > 0 ? 0 : navigable.length - 1) : (at + delta + navigable.length) % navigable.length
    setActive(navigable[next] ?? -1)
  }

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openMenu()
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      step(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      step(-1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = active >= 0 ? allOptions[active] : undefined
      if (option !== undefined) pick(option)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  const triggerClass = [
    controls.selectTrigger,
    variant === 'inline' ? controls.selectTriggerInline : '',
  ].filter((name) => name !== '').join(' ')

  let optionIndex = -1
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        style={{ ...(props.maxWidth !== undefined ? { maxWidth: props.maxWidth } : {}), ...props.style }}
        disabled={props.disabled}
        title={props.title}
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close(true) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={controls.selectValue}>{current?.label ?? ''}</span>
        <svg className={controls.selectCaret} viewBox="0 0 10 6" width="10" height="6" aria-hidden="true" focusable="false">
          <path
            d="M2.74 2.65 Q1 1 3.40 1 L6.60 1 Q9 1 7.26 2.65 L6.74 3.15 Q5 4.80 3.26 3.15 Z"
            fill="currentColor"
          />
        </svg>
      </button>
      {open && pos !== null
        ? (createPortal(
            <div
              ref={menuRef}
              id={listId}
              role="listbox"
              aria-label={props.ariaLabel}
              className={controls.selectMenu}
              style={{
                left: pos.left,
                width: pos.width,
                ...(pos.top !== undefined ? { top: pos.top } : {}),
                ...(pos.bottom !== undefined ? { bottom: pos.bottom } : {}),
                maxHeight: pos.maxHeight,
              }}
            >
              {groups.map((group, groupIndex) => (
                <div key={`g:${groupIndex}`} role="group" aria-label={group.label === '' ? undefined : group.label}>
                  {group.label !== '' && <div className={controls.selectMenuGroup}>{group.label}</div>}
                  {group.options.map((option) => {
                    optionIndex += 1
                    const index = optionIndex
                    return (
                      <button
                        key={`${groupIndex}:${option.value}`}
                        type="button"
                        role="option"
                        data-index={index}
                        aria-selected={option.value === props.value}
                        data-active={active === index}
                        disabled={option.disabled}
                        title={option.title}
                        className={controls.selectOption}
                        onMouseEnter={() => setActive(option.disabled === true ? -1 : index)}
                        onClick={() => pick(option)}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>,
            document.body,
          ) as unknown as React.ReactNode)
        : null}
    </>
  )
}
