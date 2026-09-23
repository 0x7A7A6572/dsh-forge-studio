/**
 * 别名「归到哪个模型」下拉的候选筛选（纯函数）。
 *
 * 候选就是当前生效价表的 key。空查询给前若干条；有查询时「前缀命中」整档排在「子串命中」前面
 * —— 找人打模型名开头时，最想要的那个总在第一条。上限是硬截断：价表几百条，一次全塞进菜单
 * 既慢又不没法看。
 */
export interface ModelOption {
  /** 价表里的 key，形如 `provider/model`。 */
  key: string
  /** 是否来自自定义单价（界面上带个「自定义」小标）。 */
  custom: boolean
}

/** 候选上限：够滚一屏，又不至于把整个价表塞进菜单。 */
export const MODEL_OPTION_LIMIT = 30

/** 前缀档：整串前缀命中，或去掉 provider 前缀后的模型名前缀命中。 */
function isPrefixHit(key: string, query: string): boolean {
  if (key.startsWith(query)) return true
  const slash = key.indexOf('/')
  return slash >= 0 && key.slice(slash + 1).startsWith(query)
}

/**
 * 按查询筛候选：前缀档在前、子串档随后，各档内部**保持传入顺序**（稳定），最后按上限截断。
 */
export function filterModelOptions(
  options: readonly ModelOption[],
  query: string,
  limit = MODEL_OPTION_LIMIT,
): ModelOption[] {
  const q = query.trim().toLowerCase()
  const prefix: ModelOption[] = []
  const rest: ModelOption[] = []
  for (const option of options) {
    const key = option.key.toLowerCase()
    if (q === '') rest.push(option)
    else if (isPrefixHit(key, q)) prefix.push(option)
    else if (key.includes(q)) rest.push(option)
  }
  return [...prefix, ...rest].slice(0, limit)
}

/** 裸模型名（去掉 provider 前缀）。 */
function modelPartOf(key: string): string {
  const slash = key.indexOf('/')
  return slash >= 0 ? key.slice(slash + 1) : key
}

/**
 * 这个名字在价表里有没有计价档：整 key 或裸模型名命中即算有。
 *
 * 用来给「价表里没有这个名字」的提示定性 —— 填了不认识的名字照样能合并显示，但不会有钱。
 */
export function isKnownModelName(options: readonly ModelOption[], value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v === '') return true
  return options.some((option) => {
    const key = option.key.toLowerCase()
    return key === v || modelPartOf(key) === v
  })
}
