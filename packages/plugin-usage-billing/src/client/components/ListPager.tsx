/** 分页器：每页条数 + 上一页/下一页。只有一页时不渲染（摆一排禁用箭头只是噪音）。 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import { PAGE_SIZES } from '../core/list-state.ts'
import type { PageSize } from '../core/list-state.ts'
import styles from '../styles/settings-section.module.css'

export function ListPager(props: {
  page: number
  pages: number
  size: PageSize
  onPage: (page: number) => void
  onSize: (size: PageSize) => void
}): JSX.Element | null {
  // 「共 N 条」已经由工具条负责说了，这里不重复。
  if (props.pages <= 1) return null
  return (
    <div className={styles.pager} data-dsh-ub-pager>
      <span className={styles.pagerSizes} role="group" aria-label="每页条数">
        {PAGE_SIZES.map((size) => (
          <Pill
            key={size}
            active={size === props.size}
            aria-label={'每页 ' + size + ' 条'}
            onClick={() => { props.onSize(size) }}
          >
            {String(size)}
          </Pill>
        ))}
      </span>
      <span className={styles.pagerNav}>
        <Button
          variant="ghost" size="sm" icon={<ChevronLeft size={14} />}
          disabled={props.page <= 1}
          onClick={() => { props.onPage(props.page - 1) }}
        >
          上一页
        </Button>
        <span className={styles.pagerPos} data-dsh-ub-page>
          {props.page} / {props.pages}
        </span>
        <Button
          variant="ghost" size="sm" icon={<ChevronRight size={14} />}
          disabled={props.page >= props.pages}
          onClick={() => { props.onPage(props.page + 1) }}
        >
          下一页
        </Button>
      </span>
    </div>
  )
}
