# @zzerx/dsh-plugin-usage-billing

从**既有会话日志**聚合真实 token 用量，按事件发生时刻的价格**写时锁定**费用，并在计费入口（侧栏底部或输入框下方）、入口上的点击弹层与设置页的用量视图里展示。
不伪造样本：没有数据就显示空快照；未收录模型绝不静默计 0。

## 功能范围

- 五维费用：provider / model / 天 / 会话 / 工作区（cwd）。
- 计费入口，两处各自开关（设置里的「计费入口位置」下有两个开关，可只开一处、也可两处都开，都关掉则只能从设置页看用量），两者都是一个按钮：侧边栏底部是原来那张卡（lucide 钱包图标 + 两个小色块指标「月 / 今」+ 预算叠加条（整条 = 预算 → 已用段按档位着色 → 段内三段 = 最近项目 / 最近会话 / 今日；与 popup 里那两条不是同一件，见下），折叠成 36px rail 时只剩预算饼图）；输入框下方的状态区是「一个小小的预算饼图 + 当前会话金额」（与宿主自己的会话统计胶囊同一行的透明小胶囊，样式**独立**）。点击在锚点旁弹出 popup（不是居中大弹窗）：`本月已用 ¥已用 / ¥预算` 标题值（`/ ¥预算` 是**分母不是余额**，所以不单列余额行 —— 写成「余额 ¥473.95 / ¥600」会被读成「已用 ¥473.95」）+ 预算进度条 + 累计两行 + 今日分布条与三行 + 未收录提示；点面板外或 Esc 关闭。popup 分三块、三个时间轴：① 本月 = 标题值 + 一条**预算进度**（整条 = 本月总额度，填充 = 本月已用（所有项目），按档位着色；没设预算时整条不画，只在明细里写「预算 未设置」）；② **累计（不区分时间）** = 一行两个数（会话 / 项目，侧栏入口是「最近会话 / 最近项目」）—— 它们不进任何条（跟今天没有包含关系，塞进下面的分布条会溢出）；③ **今日消耗分布** = 整条 今日合计（所有项目），两段**并排铺满** = 本项目今日（绿，左端）/ 其他项目今日（琥珀），下面配三行数字（本项目今日 / 其他项目今日 / 今日合计）。三个时间轴上的金额都出自同一次响应（`todayCny` / `allCny` 随 byWorkspace 回来），不靠两次取数拼。两个入口卡上那条仍按数据的包含关系分三层，**每层一个色标**：整条 = 本月总量（预算，无色）→ 已用段 = 本月已用（所有项目，business 蓝；≥80% 转琥珀、超支转红，也就是这条的档位信号）→ 已用段之内才是本项目（绿，左端起）含本会话（`blue-600` 深蓝，贴在它左端之内）与今日（琥珀，从已用段右端起）。所以三段是在**已用段里**量长度的（÷ 本月已用），已用段里剩下的空白就是其他项目 / 其他日期。主题调色板只有蓝 / 绿 / 琥珀 / 红四族，所以四层里的两个蓝用「business 蓝」与更深的 `blue-600` 区分 —— 两段在条上不相邻（中间隔着绿色的本项目），不会糊成一片。位置与关闭直接用原语的 `useAnchoredPosition` / `useDismissOnOutsidePointer`（宿主 chat 的统计弹窗同一套），面板 portal 到 body 并按视口边距夹取。
- 用量视图（概览 / 趋势 / 明细）在设置页的计费分区里，由卡头的分段控件切换（弹窗已取消）。趋势图走 echarts（无 canvas 时降级到自绘 SVG）；三张表（逐日明细 / 按模型 / 生效价目）都带过滤框、可排序表头与分页，明细的「按工作区」是一张可展开的表格（行首是 disclosure 按钮，展开的会话行缩进 + 退一级底色）。侧栏刻意**不**显示日期、价表来源、未收录计数与估算角标 —— 这四样都有更合适的落点（popup / 概览 / 设置页），挤在 56px 宽的卡片里只会变成噪音。
- 设置页分区（宿主设置面板的平铺版式：13/600 小标题 + 分区之间一条 0.5px 细线，不套描边卡片）：预算（启用开关 + 月度金额输入，默认 ¥100，回车或点走焦点生效）、显示（子代理口径 / 入口开关）、用量（只有卡头，右侧是概览 / 趋势 / 明细的分段控件）、价表（自动刷新开关）、价面（价表来源 + 立即刷新 + 重算未计价历史 + 自定义单价 + 生效中的价目 + 手工别名）、账本状态与口径说明。「未收录模型提醒」开关已下线（配置字段保留兼容：旧值若为「关」仍照旧生效，只是不再有界面写入口）；未收录的计数与徽标本身一直是事实，不受该开关影响。
- 概览分区按「累计 → 今日 → 最近活跃度 → 分模型消耗」单列堆叠：两张 Hero 卡（超大 Token 数字 + 未命中输入 / 缓存读 / 输出 / 调用次数四格，金额并列显示）、活跃度热力图（12 / 21 / 52 周窗口 + 左下图例）、分模型消耗表（Provider / 模型 / 总 Token / 未命中输入 / 缓存读 / 输出 / 费用）。三路取数走 `'all'`（累计口径，不跟随趋势页的范围窗口）；预算条吃**当月切片**而不是累计金额。主数字用 Token 是因为 token 是观测事实，金额可能是未定价的未知 —— 未知写「—」，永不写成 ¥0.00。
- 月度预算分档：跨 50% / 80% / 100% 各提醒一次，提醒显示在设置页计费分区的顶部（月度口径，不受概览页所选范围影响），按「月份 + 档位」去重（记在设置 `notices.budgetNotified`）；进度条 ≥80% 琥珀、超支红。
- 回填披露（三处，见下）。
- 自动重取：入口与用量视图挂载期间由**一条共享心跳**驱动（页面可见时 60s 一拍、两拍之间至少隔 30s，切回前台立即补一拍，页面隐藏时一拍都不发），同一拍里重复的请求合并成一次 —— 两个入口都要的 `overview` / `byWorkspace` 因此只发一份。客户端的重取只是「再问一次」：账本折叠与金额计算全在 host 现算，账本行按 `<sessionId>__<seq>` 幂等 upsert，刷新与重取都不会重复计费。

**非目标（明确不做）**：订阅套餐额度 / 多厂商余额 / 中转站额度 / 余额对账 / 声明端点 / 云 API；峰谷分时计价与切档提醒；首字延时与生成速度面板；多语种与双币种（统一人民币展示）；CSV/JSON 导出；主题装饰孔位。
本插件**不注册任何模型工具、不注入任何系统提示段**。

## 在 profile 里启用

1. 在 profile 的 `package.json` 中加 link 依赖，并把包名追加进 `dsh.profile.bundles`：

   ```json
   {
     "dependencies": {
       "@zzerx/dsh-plugin-usage-billing": "link:D:/codes/dsh-desk-studio/packages/plugin-usage-billing"
     },
     "dsh": { "profile": { "bundles": ["@zzerx/dsh-plugin-usage-billing"] } }
   }
   ```

2. 在该 profile 目录执行 `pnpm install`（`link:` 依赖需要重装才生效）。
3. 校验（`git check-ignore` 确认 profile 目录被忽略，不要提交）：
   - `dsh plugin --profile <name> list` 应列出该包；
   - `dsh --profile <name> --dump-config` 应出现 `- id: usage-billing-zzerx`。
4. 重启宿主后生效。

client 侧 slot id 一律带前缀：`zzerx-usage-billing`（`sidebar.footer.action` 入口、`settings.section` 分区）、`zzerx-usage-billing-composer`（`conversation.composer.dock` 输入框下方的入口）。两个入口槽都常驻注册，谁渲染由设置的落点决定；明细不再有独立浮层（原来是 `shell.overlay`），所以只有三个 slot。不带前缀的 `usage-billing` 属于同时挂载的参考插件。

## 计费口径

- **写时锁定**：每条 `assistant/message` 的 `usage` 按**该事件 `time`** 解析出的价表计价，金额一次写入账本，之后改价不影响历史。账本行 id = `ledgerKey(sessionId, seq)`（即 `<sessionId>__<seq>`），重复折叠幂等。
- **存储键路径安全**：per-record 后端的键会变成文件路径的一段，只接受 `/^[a-zA-Z0-9_-]+$/`，不匹配的键在写入时直接抛错。五张表的键**一律**由 `src/storage-key.ts` 产出：`[a-z0-9-]` 原样保留，其余（`#` / `_` / `/` / `.` / NUL / 大写 / 非 ASCII）逐码元转义成 `_hhhh`，分片之间用 `__` 连接（`_` 只作转义引导，故 `__` 不可能出现在分片内部，拼接无歧义）。编码单射且可逆，典型 `session-<uuid>` 原样不变。
- **四桶与汇率**：计费输入 = `inputTokens + cacheReadTokens + cacheWriteTokens`（`inputTokens` 只含未命中缓存部分），`reasoningTokens` 已并入 output 计数、不单独计价。条目原生币种为 USD 时按**该快照锁定的 `usdToCny`** 折算。
- **价表快照账本只追加**：一条 `base` 全量 + 后续 `delta` 差量（`reason: install | catalog-refresh | custom-price | manual-refresh`）。「时刻 t 生效的价表」= base 累加所有 `at <= t` 的 delta；自定义价在解析时覆盖目录价。delta 键 = `snapshotDeltaKey(reason, at)`（`snap__<reason>__<at>`，键长恒定；同毫秒撞键由 `uniqueSnapshotDeltaKey` 顺延）。
- **诊断有界**：诊断键稳定于 `(sessionId, kind)`，同一故障反复出现只 upsert（`{at, lastAt, count, detail}`），并保留最近 `MAX_DIAGNOSTICS = 50` 条（超限从最旧裁剪）。会话读取失败**不推进水位**（下一轮会重试），但重试只累加计数，不会让存储无界增长。
- **查价顺序**：自定义价 → 目录价精确命中 `<provider>/<model>` → 别名解析后的 canonical key → 同 provider 兜底 `<provider>/*` → 全局兜底 `*/*` → **未收录**。
- **未收录 vs 汇率不可用**：两者都**不写金额**（`priced: false, costCny: 0`）。未收录是价表里没有任何候选命中；汇率不可用是命中了 USD 条目但该快照 `usdToCny` 非正 —— 宁可标成不可计价，也不猜汇率、不锁一个 0 进账本。
- **别名只在展示层**：账本永远保存原始 provider + model id；别名（内置规范化规则 + 手工绑定）只把多行在视图层相加，且**只在同一 provider 内合并**。别名变更立即影响展示，不触碰账本。
- **重算是唯一例外**：已锁定行永不重算。只有 `priced: false` 的行可通过设置-计费里的「按当前价表重算未计价历史」重算，它只改变未计价行数，已计价金额不变。

### 回填（安装前历史）与三处披露

插件不可能知道安装前的真实价格，因此 `time < installAt` 的事件一律按安装时快照（`reason: 'install'`）估算，并分三处披露：

1. 首次聚合后，设置页计费分区顶部显示**一次性可关闭**的提示条（关闭状态写入设置 `notices.backfillDismissed`，之后不再出现）。侧栏入口卡不再重复这个标记：它要的是「花了多少」，披露的完整形态在概览页与设置页的计费口径里。
2. 概览 / 趋势 / 明细中所有属于回填区间的数值带**「估算」角标**（趋势图不做区间底色区分）。
3. 设置页**常驻**口径说明（含 `installAt` 与回填快照 id），不可关闭。

### 价表来源与降级

内置表 + models.dev 联网投影（联网优先、内置兜底），汇率取 open.er-api.com。启动拉一次，默认每 6 小时后台刷新（`pricing.refreshHours`，可在设置里关掉自动刷新），费率页另有「立即刷新」。只有发生**实质价变**时才追加 delta；联网失败一律降级为内置价 + 默认汇率，UI 标「内置价」徽标与上次成功时间，**不假装是实时价**；投影失败写诊断，不抛。设置-计费里另有「立即刷新」与「重算未计价历史」。

**响应被截断时整次失败，不合并半份目录**：宿主抓取层有单次响应上限（`@deepseek-ai/dsh-web-fetch-http` 的 `maxBodyChars`，默认 100000 **字符**；字节上限默认 5MB 不构成瓶颈），而 models.dev 的 api.json 远大于前者，且 `WebFetchRequest` 只有 `url`、请求侧无法放宽。插件因此检查 `WebFetchResult.truncated`：一旦置位就报「响应被截断」并继续用内置价 —— 半份目录在快照层看起来是合法结果，缺失的模型会被当成「目录里已删」而清掉价，比整次失败危险得多。要恢复实时价，需在 profile 的 patch 层把该插件的 `maxBodyChars` 调大（例如 2000000）。

### 自定义单价与别名

- 设置-计费里可直接新增 / 删除自定义单价：key 支持 `<provider>/<model>`、`<provider>/*`、`*/*`，币种 CNY 或 USD，四个价（input / cacheRead / cacheWrite / output）。写入即追加 `custom-price` delta，立即影响此后折叠的事件；删除后回落到目录价。
- 设置-计费里可把某个未收录 / 疑似改名的原始 id 手工绑定到 canonical 模型（以 `provider` + `rawModel` 为键，仅同 provider 生效），解绑即恢复。存储键 = `aliasKey(provider, rawModel)`（`<provider>__<rawModel>`，**不是** NUL 分隔 —— NUL 键在真实后端上不是路径安全键，每次写入都被拒）。

### 其他口径

- **时区**：一律按宿主**本机时区**归天，`day` 为本地 `YYYY-MM-DD`。
- **缓存命中率**：`cacheRead / (input + cacheRead)`，分母含未计价行（它们同样带真实观测 token）。
- **子代理**：子代理会话计入账本并打 `isSubagent` 标（含 `delegationDepth`），UI 提供「含 / 不含子代理」筛选，默认含。

## 已知限制

- **分层价模型是延后的**（Task 12/14 记录）：某自定义价被取消后，若目录价随后变化，该 key 可能短暂显示刷新前的目录价；下一次目录刷新即自愈，且解析器永远不会取到错误层的值。
- **写价锁跨越网络往返**：目录刷新整个跑在价格写锁内（这是快照基线一致性的代价），而 `ctx.web.fetch` 没有超时 / `AbortSignal`，所以一次挂死的请求会连带阻塞 `setCustomPrice` / `removeCustomPrice`。
- **缓存条目保留写入时的 TTL**：修改 `pricing.refreshHours` 要等当前缓存条目过期才生效，不会即时重算。
- **性能（纯性能项）**：`activeOverridesAt` 对每条自定义记录重排并重解目录层，而非增量单遍；只影响刷新耗时，不影响正确性。
- **无障碍**：入口是按钮（`aria-expanded` 报开合，`aria-label` 说全本月与预算口径；饼图与进度条是纯装饰，不进 a11y 树），popup 是 `role=dialog` + `aria-label`，点外部与 Esc 都关闭；分段选择是 `role=group` + `aria-pressed`，选项都是真按钮；表格排序表头是真按钮、可用键盘触发；「按工作区」的展开按钮带 `aria-expanded`；热力图（echarts canvas）的单格明细只在悬停/触摸 tooltip 里，键盘用户读到的是上方的活跃天数与区间合计。
- **组件来源**：宿主 UI 原语（`@deepseek-ai/dsh-client-ui-primitives`）**没有** Table / List / Pagination，也**没有**分段选择（Segmented）—— 它的全部导出是 Button / Pill / Tag / Switch / Input / Menu / Modal / Tooltip / HoverCard / DisclosureRow / FoldToggle / JsonTree 与代码块组件。所以分段选择是本包自绘的 `client/components/SegmentedControl.tsx`（容器一条细边 + 选中项浅底，图表范围 / 指标 / 入口位置三处共用），展开行也是自绘的（`DisclosureRow` 是 24px 折叠行，形状对不上表格行）。shadcn-ui 需要 Tailwind，而本仓库与宿主都没有 Tailwind，所以表格与分页是**按 shadcn 的架构**自己实现的：结构与数据逻辑分离（纯函数在 `client/core/list-state.ts`，过滤 / 排序 / 分页状态在 `client/hooks/useList.ts`）、样式走 CSS Modules（`client/styles/settings-section.module.css`，类名由构建哈希，不手写 `ub-` 前缀）。若日后要整体换成 Tailwind + shadcn，替换点只有 `client/components/DataTable.tsx` 与 `client/components/ListToolbar.tsx` / `ListPager.tsx` 三个文件。
- **弹层不自己造定位**：原语已经导出 `useAnchoredPosition`（锚点测量 + 视口夹取 + 滚动/缩放跟随）与 `useDismissOnOutsidePointer`（点面板外关闭，portal 出去的面板可当内部），入口 popup 直接用这两个，自己只画皮肤（`client/styles/settings-section.module.css` 的 `.popover*`，照宿主 chat 的 stat-dialog）。
- **快照 delta 键不再链式**：旧写法 `${prevId}#delta` 既是非法存储键，又随条数线性加长（每追加一条 +6 字符，迟早撑爆文件系统单段 255 上限）。现在键 = `snap__<reason>__<at>`，长度恒定；同一毫秒的两次写入由 `uniqueSnapshotDeltaKey` 按序号错开。价格读-改-写仍然**必须**走 `serialize()` 串行链（那是基线一致性的要求），但键的唯一性已不再依赖它。
- **诊断表按上限裁剪**：`MAX_DIAGNOSTICS = 50`，整轮聚合末尾从最旧裁剪。若升级前已堆积大量旧诊断（例如实测故障期的 3014 条），下一次聚合会把它们收敛到上限内（这些记录属于本插件自己的 `diag` 表，不涉及其他插件的数据）。
- **会话维度没有独立的 wire 端点**：会话行由 `byWorkspace` 的分组结果带回（明细页展开工作区时才可见），不单独提供按会话聚合的远程方法。入口 popup 的「当前会话 / 本项目」同样复用 `byWorkspace('month')`（在月窗口里找会话行），因此仍然只有一条端点。
