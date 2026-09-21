/** 分页器：每页条数 + 上一页/下一页。只有一页时不渲染（摆一排禁用箭头只是噪音）。 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { PAGE_SIZES } from '../core/list-state.ts'
import type { PageSize } from '../core/list-state.ts'
import { SegmentedControl } from './SegmentedControl.tsx'
import type { SegmentedOption } from './SegmentedControl.tsx'
import styles from '../styles/settings-section.module.css'

/** 模块级常量：身份稳定，翻页时这一组按钮不重建。 */
const SIZE_OPTIONS: ReadonlyArray<SegmentedOption<PageSize>> =
  PAGE_SIZES.map((size) => ({ value: size, label: String(size) }))

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
      <span className={styles.pagerSizes}>
        <SegmentedControl
          label="每页条数"
          value={props.size}
          options={SIZE_OPTIONS}
          onChange={props.onSize}
        />
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
