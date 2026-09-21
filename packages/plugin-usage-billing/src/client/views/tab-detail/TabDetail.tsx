/**
 * 明细：按工作区下钻到会话 + 按模型。
 *
 * 版式：工作区是「一行一卡、点开下钻」的列表（层级关系用缩进表达），
 * 模型是表格（列对齐才好纵向比大小）—— 两件事的数据形状本来就不同。
 */
import { backfilledDisclosure, formatCny, formatDateTime, formatInt, isUnpricedTotal } from '../../core/format.ts'
import { Card } from '../../components/Card.tsx'
import { DataTable } from '../../components/DataTable.tsx'
import type { TableColumn } from '../../components/DataTable.tsx'
import { ListPager } from '../../components/ListPager.tsx'
import { ListToolbar } from '../../components/ListToolbar.tsx'
import { useTabDetail } from './useTabDetail.ts'
import type { TabDetailProps } from './useTabDetail.ts'
import type { ModelRow } from '../../../view.ts'
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

export function TabDetail(props: TabDetailProps): JSX.Element {
  const { data, expanded, toggleExpanded, workspaceList } = useTabDetail(props)

  if (data === null) return <div className={styles.empty} data-dsh-ub-empty>正在读取用量…</div>
  const { workspaces, models } = data
  // 趋势 / 热力图都有的空态，明细同样要有（否则是两张空表）。
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

  return (
    <div className={styles.section} data-dsh-usage-billing>
      {hasBackfilled ? (
        <p className={styles.sub} data-dsh-ub-estimate>
          含安装前估算 · 安装前的历史用量按安装时点价表估算，可能与实际账单不一致。
        </p>
      ) : null}

      <Card title="按工作区" desc="点一行展开到会话（子代理会话单独标注）。">
        <ListToolbar
          query={workspaceList.query}
          onQuery={workspaceList.setQuery}
          placeholder="过滤工作区"
          total={workspaceList.view.total}
          filtered={workspaceList.view.filtered}
        />
        <div className={styles.list}>
          {workspaceList.view.rows.map((w) => {
            const open = expanded === w.cwd
            return (
              <div className={styles.item} key={w.cwd}>
                <button
                  type="button"
                  className={styles.itemHead}
                  aria-expanded={open}
                  onClick={() => { toggleExpanded(w.cwd) }}
                >
                  <span className={styles.itemTitle}>{w.cwd}</span>
                  <span className={styles.itemMeta}>
                    {rowMoney(w.costCny)} · {formatInt(w.calls)} 次
                  </span>
                </button>
                {open ? (
                  <div className={styles.itemBody}>
                    {w.sessions.map((s) => (
                      <div className={styles.itemBodyLine} key={s.sessionId}>
                        <span className={styles.itemBodyPath}>{s.sessionId}</span>
                        <span>
                          {' · '}{rowMoney(s.costCny)} · {formatInt(s.calls)} 次 · 最后活跃{' '}
                          {formatDateTime(s.lastTime)}
                        </span>
                        {s.isSubagent ? <span className={styles.itemMeta}>{' · 子代理'}</span> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
          {workspaceList.view.rows.length === 0 ? (
            <div className={styles.empty}>没有匹配的工作区。</div>
          ) : null}
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
