/**
 * 模型选择框：输入即筛当前价表，点一条即填入；也允许直接写价表里没有的名字。
 *
 * 候选只是**填空辅助** —— 不改写账本、也不做校验：填了什么，别名就绑什么。
 */
import { useMemo, useState } from 'react'
import { Input, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { filterModelOptions, type ModelOption } from '../model-search.ts'
import styles from '../../../styles/settings-section.module.css'

export interface ModelPickerProps {
  value: string
  options: readonly ModelOption[]
  disabled: boolean
  onChange: (next: string) => void
}

export function ModelPicker(props: ModelPickerProps): JSX.Element {
  const { value, options, disabled, onChange } = props
  const [open, setOpen] = useState(false)
  const items = useMemo<MenuEntry[]>(() => {
    const list = filterModelOptions(options, value)
    if (list.length === 0) {
      const empty: MenuEntry = { type: 'label', id: 'no-match', text: '价表里没有匹配的模型名' }
      return [empty]
    }
    return list.map((option): MenuEntry => ({
      id: option.key,
      label: option.custom === true
        ? <>{option.key}<span className={styles.subTag}>自定义</span></>
        : option.key,
    }))
  }, [options, value])

  return (
    <Menu
      open={open}
      items={items}
      onSelect={(id) => { onChange(id); setOpen(false) }}
      onClose={() => { setOpen(false) }}
      // 弹窗里的滚动容器会裁掉就地渲染的列表，所以走 portal 固定定位。
      portal
      dense
      anchor={(
        <Input
          className={styles.inputMd}
          placeholder="渠道/模型名，如 ds-hk/deepseek-flash"
          value={value}
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onFocus={() => { setOpen(true) }}
          onChange={(event) => { onChange(event.currentTarget.value); setOpen(true) }}
        />
      )}
    />
  )
}
