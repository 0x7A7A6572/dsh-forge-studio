# @zzerx/dsh-plugin-usage-billing

从**既有会话日志**聚合真实 token 用量，按事件发生时刻的价格**写时锁定**费用，并在侧栏入口卡与全屏仪表盘里展示。
不伪造样本：没有数据就显示空快照；未收录模型绝不静默计 0。

## 功能范围

- 五维费用：provider / model / 天 / 会话 / 工作区（cwd）。
- 侧栏入口卡（本月费用 + 7 天 sparkline，折叠 rail 退化为图标钮）；点击打开全屏仪表盘，含概览 / 趋势 / 热力图 / 明细 / 费率五个分区。
- 设置页分区：预算、显示偏好、价表状态、自定义单价与手工别名、口径说明。
- 月度预算分档：跨 50% / 80% / 100% 各提醒一次，提醒显示在仪表盘弹窗顶部（月度口径，不受概览页所选范围影响），按「月份 + 档位」去重（记在设置 `notices.budgetNotified`）；进度条 ≥80% 琥珀、超支红。
- 回填披露（三处，见下）。

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

client 侧 slot id 一律带前缀：`zzerx-usage-billing`（`sidebar.footer.action` 入口、`settings.section` 分区）、`zzerx-usage-billing-dashboard`（`shell.overlay` 浮层）。不带前缀的 `usage-billing` 属于同时挂载的参考插件。

## 计费口径

- **写时锁定**：每条 `assistant/message` 的 `usage` 按**该事件 `time`** 解析出的价表计价，金额一次写入账本，之后改价不影响历史。账本行 id = `${sessionId}#${seq}`，重复折叠幂等。
- **四桶与汇率**：计费输入 = `inputTokens + cacheReadTokens + cacheWriteTokens`（`inputTokens` 只含未命中缓存部分），`reasoningTokens` 已并入 output 计数、不单独计价。条目原生币种为 USD 时按**该快照锁定的 `usdToCny`** 折算。
- **价表快照账本只追加**：一条 `base` 全量 + 后续 `delta` 差量（`reason: install | catalog-refresh | custom-price | manual-refresh`）。「时刻 t 生效的价表」= base 累加所有 `at <= t` 的 delta；自定义价在解析时覆盖目录价。
- **查价顺序**：自定义价 → 目录价精确命中 `<provider>/<model>` → 别名解析后的 canonical key → 同 provider 兜底 `<provider>/*` → 全局兜底 `*/*` → **未收录**。
- **未收录 vs 汇率不可用**：两者都**不写金额**（`priced: false, costCny: 0`）。未收录是价表里没有任何候选命中；汇率不可用是命中了 USD 条目但该快照 `usdToCny` 非正 —— 宁可标成不可计价，也不猜汇率、不锁一个 0 进账本。
- **别名只在展示层**：账本永远保存原始 provider + model id；别名（内置规范化规则 + 手工绑定）只把多行在视图层相加，且**只在同一 provider 内合并**。别名变更立即影响展示，不触碰账本。
- **重算是唯一例外**：已锁定行永不重算。只有 `priced: false` 的行可通过费率页「按当前价表重算未计价历史」重算，它只改变未计价行数，已计价金额不变。

### 回填（安装前历史）与三处披露

插件不可能知道安装前的真实价格，因此 `time < installAt` 的事件一律按安装时快照（`reason: 'install'`）估算，并分三处披露：

1. 首次聚合后，入口卡与仪表盘顶部显示**一次性可关闭**的提示条（关闭状态写入设置 `notices.backfillDismissed`，之后不再出现）；入口卡另带常驻的「含安装前估算」标记。
2. 概览 / 趋势 / 明细中所有属于回填区间的数值带**「估算」角标**，趋势图该区间底色区分。
3. 设置页**常驻**口径说明（含 `installAt` 与回填快照 id），不可关闭。

### 价表来源与降级

内置表 + models.dev 联网投影（联网优先、内置兜底），汇率取 open.er-api.com。启动拉一次，默认每 6 小时后台刷新（`pricing.refreshHours`，可在设置里关掉自动刷新），费率页另有「立即刷新」。只有发生**实质价变**时才追加 delta；联网失败一律降级为内置价 + 默认汇率，UI 标「内置价」徽标与上次成功时间，**不假装是实时价**；投影失败写诊断，不抛。

### 自定义单价与别名

- 费率页可直接新增 / 删除自定义单价：key 支持 `<provider>/<model>`、`<provider>/*`、`*/*`，币种 CNY 或 USD，四个价（input / cacheRead / cacheWrite / output）。写入即追加 `custom-price` delta，立即影响此后折叠的事件；删除后回落到目录价。
- 设置页可把某个未收录 / 疑似改名的原始 id 手工绑定到 canonical 模型（以 `provider` + `rawModel` 为键，仅同 provider 生效），解绑即恢复。

### 其他口径

- **时区**：一律按宿主**本机时区**归天，`day` 为本地 `YYYY-MM-DD`。
- **缓存命中率**：`cacheRead / (input + cacheRead)`，分母含未计价行（它们同样带真实观测 token）。
- **子代理**：子代理会话计入账本并打 `isSubagent` 标（含 `delegationDepth`），UI 提供「含 / 不含子代理」筛选，默认含。

## 已知限制

- **分层价模型是延后的**（Task 12/14 记录）：某自定义价被取消后，若目录价随后变化，该 key 可能短暂显示刷新前的目录价；下一次目录刷新即自愈，且解析器永远不会取到错误层的值。
- **写价锁跨越网络往返**：目录刷新整个跑在价格写锁内（这是快照基线一致性的代价），而 `ctx.web.fetch` 没有超时 / `AbortSignal`，所以一次挂死的请求会连带阻塞 `setCustomPrice` / `removeCustomPrice`。
- **缓存条目保留写入时的 TTL**：修改 `pricing.refreshHours` 要等当前缓存条目过期才生效，不会即时重算。
- **性能（纯性能项）**：`activeOverridesAt` 对每条自定义记录重排并重解目录层，而非增量单遍；只影响刷新耗时，不影响正确性。
- **无障碍（延后）**：仪表盘弹窗没有 Esc 关闭与焦点管理（spec §7.1 期望有 Esc）；热力图格子不可聚焦（只有悬停明细）；部分表格仍使用已废弃的 `<th align>`。
