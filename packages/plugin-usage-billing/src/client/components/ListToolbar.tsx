/**
 * 列表筛选条：过滤框 + 命中计数 + 右侧插槽。
 *
 * 一个刻意的取舍：**只有一个匹配项时立刻显示它**。搜索框不做「回车才筛」，也不做延迟 ——
 * 这些表最多几百行，实时过滤没有性能问题，少一次交互。
 */
import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from '../styles/settings-section.module.css'

export function ListToolbar(props: {
  query: string
  onQuery: (query: string) => void
  placeholder?: string
  total: number
  filtered: number
  children?: ReactNode
}): JSX.Element {
  const placeholder = props.placeholder ?? '过滤…'
  return (
    <div className={styles.listbar} data-dsh-ub-listbar>
      <Input
        className={styles.inputSm + ' ' + styles.search}
        icon={<Search size={14} />}
        value={props.query}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => { props.onQuery(event.currentTarget.value) }}
      />
      <span className={styles.listbarCount} data-dsh-ub-count>
        {props.filtered === props.total
          ? '共 ' + props.total + ' 条'
          : '共 ' + props.total + ' 条 · 命中 ' + props.filtered + ' 条'}
      </span>
      {props.children === undefined ? null : (
        <span className={styles.listbarExtra}>{props.children}</span>
      )}
    </div>
  )
}
