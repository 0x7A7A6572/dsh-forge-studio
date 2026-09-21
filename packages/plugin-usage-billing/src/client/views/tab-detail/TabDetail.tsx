/**
 * 明细：按工作区下钻到会话 + 按模型。
 *
 * 版式：两张表，都用同一张表皮肤 —— 工作区那张的行可展开（第一列是 disclosure 按钮，
 * 展开的会话行缩进 + 灰底），模型那张是平表。以前工作区用「一摞圆角卡片、层级靠缩进」
 * 表达，和下面那张表两套语言；两件事的数据形状本来就都是「行」，统一成表格更省一次扫读。
 */
import { Fragment } from 'react'
import { ChevronRight } from 'lucide-react'
import { backfilledDisclosure, formatCny, formatDateTime, formatInt, isUnpricedTotal } from '../../core/format.ts'
import { Card } from '../../components/Card.tsx'
import { DataTable } from '../../components/DataTable.tsx'
import type { TableColumn } from '../../components/DataTable.tsx'
import { ListPager } from '../../components/ListPager.tsx'
import { ListToolbar } from '../../components/ListToolbar.tsx'
import { useTabDetail } from './useTabDetail.ts'
import type { TabDetailProps } from './useTabDetail.ts'
import type { ModelRow, SessionRow, WorkspaceRow } from '../../../view.ts'
import styles from '../../styles/settings-section.module.css'

const modelSearch = (m: ModelRow): string =>
  m.providers.join(' ') + ' ' + m.model + ' ' + m.rawModels.join(' ')

/** 分模型表与状态无关，模块级常量（身份稳定，列表 memo 才有效）。 */
const MODEL_COLUMNS: ReadonlyArray<TableColumn<ModelRow>> = [
  {
    key: 'model',
    header: '模型',
    main: true,
    sortValue: (m) => m.model,
    // 同名模型跨 provider 并成一行：provider 一个都不丢，全列出来。
    render: (m) => m.providers.join(' / ') + ' / ' + m.model,
  },
  { key: 'input', header: '输入', align: 'right', sortValue: (m) => m.input, render: (m) => formatInt(m.input) },
  { key: 'cacheRead', header: '缓存读', align: 'right', sortValue: (m) => m.cacheRead, render: (m) => formatInt(m.cacheRead) },
  { key: 'output', header: '输出', align: 'right', sortValue: (m) => m.output, render: (m) => formatInt(m.output) },
  {
    key: 'cost',
    header: '费用',
    align: 'right',
    sortValue: (m) => m.costCny,
    // 未计价行绝不能显示 ¥0.00：那读起来是「免费」。零额 + 未计价时明确写未收录。
    render: (m) => (!m.priced && m.costCny === 0
      ? <span className={styles.unpriced}>未收录</span>
      : <>{formatCny(m.costCny)}</>),
  },
  {
    key: 'note',
    header: '备注',
    // 三段都是本单元格的直接文本节点：getByText 才读得到完整备注。
    render: (m) => (!m.priced ? '未收录 · ' : '')
      + (m.mixedRate ? '混合单价 · ' : '')
      + (m.rawModels.length > 1 ? m.rawModels.length + ' 个原始 id' : ''),
  },
]

/** 工作区自己不带 lastTime：拿它名下会话的最晚活跃时刻当这一列（空集合给 null）。 */
const workspaceLast = (w: WorkspaceRow): number | null =>
  w.sessions.reduce<number | null>((max, s) => (max === null || s.lastTime > max ? s.lastTime : max), null)

export function TabDetail(props: TabDetailProps): JSX.Element {
  const { data, expanded, toggleExpanded, workspaceList } = useTabDetail(props)

  if (data === null) return <div className={styles.empty} data-dsh-ub-empty>正在读取用量…</div>
  const { workspaces, models } = data
  // 趋势 / 概览都有的空态，明细同样要有（否则是两张空表）。
  if (workspaces.length === 0 && models.length === 0) {
    return <div className={styles.empty} data-dsh-ub-empty>这个范围里还没有用量记录。</div>
  }
  const hasBackfilled = backfilledDisclosure(data.hasBackfilled)
  // 与下面模型表同一条「未计价行不写 ¥0.00」的规则：整份账一行都没定价时（唯一判据
  // isUnpricedTotal），工作区 / 会话这些金额列里的 0 同样是未知 —— 写「未收录」而不是 ¥0.00。
  const unpriced = isUnpricedTotal(
    workspaces.reduce((sum, w) => sum + w.costCny, 0),
    data.unpricedModels,
  )
  const rowMoney = (costCny: number): JSX.Element => (
    unpriced && costCny === 0
      ? <span className={styles.unpriced}>未收录</span>
      : <>{formatCny(costCny)}</>
  )
  const timeText = (time: number | null): string => (time === null ? '—' : formatDateTime(time))

  return (
    <div className={styles.section} data-dsh-usage-billing>
      {hasBackfilled ? (
        <p className={styles.sub} data-dsh-ub-estimate>
          含安装前估算 · 安装前的历史用量按安装时点价表估算，可能与实际账单不一致。
        </p>
      ) : null}

      <Card title="按工作区" desc="点一行展开到会话。">
        <ListToolbar
          query={workspaceList.query}
          onQuery={workspaceList.setQuery}
          placeholder="过滤工作区"
          total={workspaceList.view.total}
          filtered={workspaceList.view.filtered}
        />
        <div className={styles.tableWrap}>
          <table className={styles.table} data-dsh-ub-table data-dsh-ub-workspaces>
            <thead>
              <tr>
                <th scope="col">工作区</th>
                <th scope="col" className={styles.num}>会话</th>
                <th scope="col" className={styles.num}>调用</th>
                <th scope="col" className={styles.num}>费用</th>
                <th scope="col" className={styles.num}>最后活跃</th>
              </tr>
            </thead>
            <tbody>
              {workspaceList.view.rows.map((w) => {
                const open = expanded === w.cwd
                return (
                  <Fragment key={w.cwd}>
                    <tr data-open={open ? 'true' : undefined}>
                      <th scope="row" className={styles.cellMain}>
                        <button
                          type="button"
                          className={styles.disclose}
                          aria-expanded={open}
                          onClick={() => { toggleExpanded(w.cwd) }}
                        >
                          <ChevronRight
                            size={14}
                            className={styles.discloseMark}
                            data-open={open ? 'true' : undefined}
                            aria-hidden="true"
                          />
                          <span className={styles.cellPath}>{w.cwd}</span>
                        </button>
                      </th>
                      <td className={styles.num}>{formatInt(w.sessions.length)}</td>
                      <td className={styles.num}>{formatInt(w.calls)}</td>
                      <td className={styles.num}>{rowMoney(w.costCny)}</td>
                      <td className={styles.num}>{timeText(workspaceLast(w))}</td>
                    </tr>
                    {open ? w.sessions.map((s: SessionRow) => (
                      <tr key={s.sessionId} className={styles.subRow}>
                        <th scope="row" className={styles.subCell}>
                          <span className={styles.cellPath}>{s.sessionId}</span>
                          {s.isSubagent ? <span className={styles.subTag}>子代理</span> : null}
                        </th>
                        <td className={styles.num}>—</td>
                        <td className={styles.num}>{formatInt(s.calls)}</td>
                        <td className={styles.num}>{rowMoney(s.costCny)}</td>
                        <td className={styles.num}>{formatDateTime(s.lastTime)}</td>
                      </tr>
                    )) : null}
                  </Fragment>
                )
              })}
              {workspaceList.view.rows.length === 0 ? (
                <tr>
                  <td className={styles.tableEmpty} colSpan={5}>没有匹配的工作区。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <ListPager
          page={workspaceList.view.page}
          pages={workspaceList.view.pages}
          size={workspaceList.size}
          onPage={workspaceList.setPage}
          onSize={workspaceList.setSize}
        />
      </Card>

      <Card title="按模型">
        <DataTable
          columns={MODEL_COLUMNS}
          rows={models}
          rowKey={(m) => m.key}
          empty="这个范围里还没有按模型的用量。"
          defaultSort={{ key: 'cost', dir: 'desc' }}
          searchText={modelSearch}
          filterPlaceholder="过滤模型"
        />
      </Card>
    </div>
  )
}
