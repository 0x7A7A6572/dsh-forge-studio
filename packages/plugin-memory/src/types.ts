/**
 * plugin-memory 领域类型：品牌 id、记忆记录、查询/写入入参、设置与导入提示词。
 * 跨 host/client 共享；host 与 client 都从这里 type-only import。
 *
 * 作用域模型（本插件的核心设计）：
 * - global  全局记忆：跨项目通用（语气、格式、身份、职业、广泛偏好）
 * - project 项目记忆：只对「某一个工作区目录」成立的习惯与决策
 * 项目以工作区目录路径为键，比较前统一归一化（normalizeProjectKey）。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** 记忆条目 id。 */
export type MemoryId = Branded<'MemoryId'>

/** 设置命名空间：client 经 settingsScope 绑定同一命名空间读写开关。 */
export const MEMORY_NAMESPACE = 'forge-studio-memory'

/**
 * 记忆分类（人工可读的 6 类，对齐导入提示词的分类口径）：
 * - preference 指令/偏好：语气、格式、风格、始终做/绝不做
 * - user       身份/职业：姓名、所在地、背景、职位与技能
 * - project    项目：具体项目的功能、状态、关键决策
 * - decision   决策：做过的取舍与理由
 * - fact       事实：原子事实
 * - history    经历：发生过的经过
 */
export const MEMORY_KINDS = ['preference', 'user', 'project', 'decision', 'fact', 'history'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

/** 分类显示名（UI 徽标）。 */
export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  preference: '指令',
  user: '身份',
  project: '项目',
  decision: '决策',
  fact: '事实',
  history: '经历',
}

/**
 * 重要性 1-5 的简短中文标签。面板标牌、注入块、工具输出共用同一套，
 * 避免出现「面板写中文、提示词写 ★★★」这种两套说法。
 */
export const MEMORY_IMPORTANCE_LABELS = ['很低', '偏低', '普通', '重要', '关键'] as const

/** 取重要性标签；越界或非法值夹到 1-5，取不到时退回「普通」。 */
export function importanceLabel(importance: number): string {
  const level = Math.min(MEMORY_IMPORTANCE_LABELS.length, Math.max(1, Math.round(importance)))
  return MEMORY_IMPORTANCE_LABELS[level - 1] ?? '普通'
}

/** 作用域：全局 / 项目。 */
export const MEMORY_SCOPES = ['global', 'project'] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]

/** 一条记忆。 */
export interface MemoryRecord {
  readonly id: MemoryId
  readonly kind: MemoryKind
  readonly scope: MemoryScope
  /** 项目记忆所属工作区目录（原样保留用户路径）；全局记忆为空串。 */
  readonly projectPath: string
  readonly title: string
  readonly content: string
  /** 一行摘要（目录卡 / 关联视图用）；缺省空串，表示未写摘要。 */
  readonly summary: string
  /** 1-5；>= 注入门槛才会被自动注入。 */
  readonly importance: number
  readonly tags: string[]
  /** 别名：与 title 等价的其他写法。命中别名即视为同一条（wiki 的 redirect）。 */
  readonly aliases: string[]
  readonly pinned: boolean
  readonly archived: boolean
  readonly createdAt: number
  readonly updatedAt: number
  /** 来源：'agent'（模型工具写入）/ 'user'（面板手工写入）/ 'capture'（自动提炼）/ 'import'。 */
  readonly source: string
  /** 产生该记忆的会话 id（有则记）。 */
  readonly sessionId?: string
}

/** 写入入参（标题相同且同作用域时自动合并，不产生重复条目）。 */
export interface MemorySaveInput {
  readonly title: string
  readonly content: string
  /** 一行摘要；缺省不写。 */
  readonly summary?: string
  /** 别名；与已有条目的别名 / 标题撞上时并入那一条。 */
  readonly aliases?: readonly string[]
  /**
   * 关联实体（实体 id、名称或别名）。写记忆时声明「这条讲的是谁」：
   * 命中已有实体则复用，未命中则按名称新建，并落一条 about 边。
   */
  readonly entities?: readonly string[]
  readonly kind?: MemoryKind
  readonly scope?: MemoryScope
  /** 项目记忆的工作区目录；scope=project 且缺省时由 host 用会话 cwd 兜底。 */
  readonly projectPath?: string
  readonly importance?: number
  readonly tags?: readonly string[]
  readonly source?: string
  readonly sessionId?: string
  readonly pinned?: boolean
}

/** 局部修改入参（只改传入字段）。 */
export interface MemoryPatch {
  readonly title?: string
  readonly content?: string
  readonly summary?: string
  readonly aliases?: readonly string[]
  readonly kind?: MemoryKind
  readonly scope?: MemoryScope
  readonly projectPath?: string
  readonly importance?: number
  readonly tags?: readonly string[]
  readonly pinned?: boolean
  readonly archived?: boolean
}

/** 查询入参。 */
export interface MemoryQuery {
  /** 只取该作用域；缺省两者都取。 */
  readonly scope?: MemoryScope
  /** 只取该项目的项目记忆（归一化后比较）。 */
  readonly projectPath?: string
  /** 只取该分类。 */
  readonly kind?: MemoryKind
  /** 关键字（标题/正文/摘要/别名/标签的包含匹配，大小写不敏感）。 */
  readonly keyword?: string
  /** 是否包含已归档（缺省 false）。 */
  readonly includeArchived?: boolean
  /** 上限（缺省全部）。 */
  readonly limit?: number
}

/** 导入入参。 */
export interface MemoryImportInput {
  /** 粘贴的画像文本（导入提示词的输出，或任意纯文本）。 */
  readonly text: string
  /** 导入到哪个作用域。 */
  readonly scope: MemoryScope
  /** 目标项目目录（scope=project 时必填）。 */
  readonly projectPath?: string
  /** merge（默认，按标题去重合并）| replace（先清空目标作用域再导入）。 */
  readonly mode?: 'merge' | 'replace'
}

/** 导入结果。 */
export interface MemoryImportResult {
  readonly added: number
  readonly merged: number
  readonly skipped: number
  /** replace 模式下被清空的条数。 */
  readonly removed: number
}

/**
 * 摄取来源：一份原文留档从哪来。
 * - import  面板粘贴的画像文本
 * - capture turn/end 自动提炼时喂给模型的对话转录
 * - manual  面板手工新建
 */
export const MEMORY_INGEST_ORIGINS = ['import', 'capture', 'manual'] as const
export type MemoryIngestOrigin = (typeof MEMORY_INGEST_ORIGINS)[number]

/** 原文留档 id。 */
export type MemoryRawId = Branded<'MemoryRawId'>

/**
 * 原文留档：摄取管线的第一段 —— 原始文本原样落盘，不因解析失败而丢。
 * 结构化条目由它抽取而来（recordIds / extractedAt 是抽取痕迹）；抽取失败、
 * 或将来换了抽取算法，都可以对这一份原文重跑。
 */
export interface MemoryRawDocument {
  readonly id: MemoryRawId
  /** 来源（MEMORY_INGEST_ORIGINS 之一，允许扩展）。 */
  readonly origin: string
  readonly scope: MemoryScope
  readonly projectPath: string
  /** 列表标题：留档时的显式标题，或原文首行。 */
  readonly title: string
  /** 原文（includeText=false 的列表查询返回空串）。 */
  readonly text: string
  /** 原文字符数（列表不取全文也能看体量）。 */
  readonly textLength: number
  readonly createdAt: number
  /** 最近一次写入时间（会话转录每轮覆盖时随之推进）。 */
  readonly updatedAt: number
  /** 最近一次抽取完成时间；缺省 = 尚未抽取。 */
  readonly extractedAt?: number
  /** 这份原文抽出来的条目 id。 */
  readonly recordIds: readonly string[]
  readonly sessionId?: string
  readonly note?: string
}

/** 落一份原文留档的入参。 */
export interface MemoryRawInput {
  readonly text: string
  readonly origin: string
  readonly scope: MemoryScope
  readonly projectPath?: string
  readonly title?: string
  readonly sessionId?: string
  readonly note?: string
}

/** 原文留档查询。 */
export interface MemoryRawQuery {
  readonly origin?: string
  readonly scope?: MemoryScope
  readonly projectPath?: string
  /** 是否返回全文（缺省 true）；false 时 text 为空串，只看 textLength。 */
  readonly includeText?: boolean
  readonly limit?: number
}

/** 一次后台模型调用的审计记录（路线图 #5）。 */
export interface MemoryAuditEntry {
  readonly id: string
  readonly at: number
  /** 用途：capture（对话提炼）/ extract（原文抽取）/ entity（实体抽取）。 */
  readonly kind: string
  readonly provider: string
  readonly model: string
  readonly ok: boolean
  readonly durationMs: number
  readonly inputChars: number
  readonly outputChars: number
  /** 上游没报用量就缺省（不猜、不估）。 */
  readonly tokensIn?: number
  readonly tokensOut?: number
  readonly recordIds: readonly string[]
  readonly rawId?: string
  readonly sessionId?: string
  readonly error?: string
  /** 被代码硬闸门丢弃的条目（标题 + 原因），用来解释「这次为什么没记」。 */
  readonly dropped?: readonly { title: string; reason: string }[]
}

/** 记一条审计的入参（id / at 由服务生成）。 */
export interface MemoryAuditInput {
  readonly kind: string
  readonly provider: string
  readonly model: string
  readonly ok: boolean
  readonly durationMs: number
  readonly inputChars: number
  readonly outputChars: number
  readonly tokensIn?: number
  readonly tokensOut?: number
  readonly recordIds: readonly string[]
  readonly rawId?: string
  readonly sessionId?: string
  readonly error?: string
  /** 被代码硬闸门丢弃的条目（标题 + 原因）；没有就不用带。 */
  readonly dropped?: readonly { title: string; reason: string }[]
}

/** 审计查询。 */
export interface MemoryAuditQuery {
  readonly kind?: string
  readonly ok?: boolean
  readonly limit?: number
}

/**
 * 摄取入参：一份原文进来，走完「留档 → 解析 → 条目」三段。
 * import 走行式解析器；capture 走模型抽取 —— 两条入口共用同一批表，
 * 因此「从哪来的、抽出了什么、花了多少」永远能对上。
 */
export interface MemoryIngestInput {
  readonly text: string
  /** 缺省 import。 */
  readonly origin?: string
  readonly scope?: MemoryScope
  readonly projectPath?: string
  /** merge（默认，按标题去重合并）| replace（先清空目标作用域再导入）。 */
  readonly mode?: 'merge' | 'replace'
  /** 覆盖留档标题（缺省取原文首行）。 */
  readonly title?: string
  readonly sessionId?: string
  readonly note?: string
}

/** 摄取结果（= 导入结果 + 留档痕迹）。 */
export interface MemoryIngestResult extends MemoryImportResult {
  readonly rawId: MemoryRawId
  readonly origin: string
  /** 本次写入 / 合并到的条目 id。 */
  readonly recordIds: readonly string[]
}

/** 记忆库概览（面板头部与「重置」确认用）。 */
export interface MemoryStats {
  readonly total: number
  readonly archived: number
  readonly global: number
  readonly project: number
  /** 已有项目记忆的工作区目录（原始大小写，去重）。 */
  readonly projects: readonly MemoryProjectSummary[]
  /** 原文留档条数。 */
  readonly raw: number
  /** 后台模型调用审计条数。 */
  readonly audits: number
  /** 实体数（不含已归档）。 */
  readonly entities: number
  /** 边数。 */
  readonly edges: number
}

/** 一个项目维度下的记忆统计。 */
export interface MemoryProjectSummary {
  readonly path: string
  readonly label: string
  readonly count: number
}

/* ---------------- wiki 图层：实体与边 ---------------- */

/**
 * 实体 id。实体 = wiki 里一个可复用的「名词」（项目 / 工具 / 人 / 概念），
 * 记忆条目通过 about / mentions 边挂到它上面，条目之间再由共现推导 related 边。
 */
export type MemoryEntityId = Branded<'MemoryEntityId'>

/** 实体类别。 */
export const MEMORY_ENTITY_KINDS = ['project', 'tool', 'person', 'org', 'concept', 'other'] as const
export type MemoryEntityKind = (typeof MEMORY_ENTITY_KINDS)[number]

/** 实体类别显示名（UI 徽标 / 工具输出共用）。 */
export const MEMORY_ENTITY_KIND_LABELS: Record<MemoryEntityKind, string> = {
  project: '项目',
  tool: '工具',
  person: '人物',
  org: '组织',
  concept: '概念',
  other: '其他',
}

/** 一个实体。 */
export interface MemoryEntity {
  readonly id: MemoryEntityId
  readonly name: string
  readonly kind: MemoryEntityKind
  /** 别名：与 name 等价的其他写法；命中别名同样算「提及」该实体。 */
  readonly aliases: string[]
  /** 一行说明（目录卡用）。 */
  readonly summary: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly archived: boolean
}

/**
 * 落一个实体的入参。
 * - 带 id：就地更新那一条（可改名）；
 * - 不带 id：按 name / 别名归一化后命中已有实体则并入（补别名与摘要），否则新建。
 */
export interface MemoryEntityInput {
  readonly id?: string
  readonly name: string
  readonly kind?: MemoryEntityKind
  readonly aliases?: readonly string[]
  readonly summary?: string
  readonly archived?: boolean
}

/** 实体查询。 */
export interface MemoryEntityQuery {
  /** 关键字（名称 / 别名 / 摘要的包含匹配，大小写不敏感）。 */
  readonly keyword?: string
  readonly kind?: MemoryEntityKind
  readonly includeArchived?: boolean
  readonly limit?: number
}

/** 边的端点类型：记忆条目 / 实体。 */
export const MEMORY_NODE_KINDS = ['memory', 'entity'] as const
export type MemoryNodeKind = (typeof MEMORY_NODE_KINDS)[number]

/** 边的端点引用。 */
export interface MemoryNodeRef {
  readonly kind: MemoryNodeKind
  readonly id: string
}

/**
 * 边的语义。三类：
 * - 记忆 → 实体：about（主题就是它）/ mentions（正文里提到）；
 * - 记忆 → 记忆：related（相关）/ refines（细化）/ supersedes（取代）/ contradicts（冲突）；
 * - 实体 → 实体：part-of（属于）/ uses（使用）/ same-as（同义）。
 */
export const MEMORY_EDGE_RELATIONS = [
  'about', 'mentions', 'related', 'refines', 'supersedes', 'contradicts', 'part-of', 'uses', 'same-as',
] as const
export type MemoryEdgeRelation = (typeof MEMORY_EDGE_RELATIONS)[number]

/** 边的中文标签（UI 与工具输出共用）。 */
export const MEMORY_EDGE_RELATION_LABELS: Record<MemoryEdgeRelation, string> = {
  about: '关于',
  mentions: '提及',
  related: '相关',
  refines: '细化',
  supersedes: '取代',
  contradicts: '冲突',
  'part-of': '属于',
  uses: '使用',
  'same-as': '同义',
}

/**
 * 对称关系：a→b 与 b→a 视为同一条边（id 生成时把两个端点排序），
 * 因此重复连不会长出两条。方向性关系（about / supersedes 等）不排序。
 */
export const MEMORY_SYMMETRIC_RELATIONS: readonly MemoryEdgeRelation[] = ['related', 'contradicts', 'same-as']

/** 边的来源。 */
export const MEMORY_EDGE_ORIGINS = ['auto', 'agent', 'user'] as const
export type MemoryEdgeOrigin = (typeof MEMORY_EDGE_ORIGINS)[number]

/** 来源显示名。 */
export const MEMORY_EDGE_ORIGIN_LABELS: Record<MemoryEdgeOrigin, string> = {
  auto: '自动',
  agent: '模型',
  user: '手工',
}

/** 一条边。id 由「端点 + 关系」确定性生成，因此重复连同一条边 = 更新它。 */
export interface MemoryEdge {
  readonly id: string
  readonly from: MemoryNodeRef
  readonly to: MemoryNodeRef
  readonly relation: MemoryEdgeRelation
  /** 备注：模型 / 用户说明为什么连这条边；自动边为空串。 */
  readonly note: string
  /** 权重：自动共现边 = 共享实体数，其余默认 1。 */
  readonly weight: number
  readonly origin: MemoryEdgeOrigin
  readonly createdAt: number
  readonly updatedAt: number
}

/** 连一条边的入参。 */
export interface MemoryLinkInput {
  readonly from: MemoryNodeRef
  readonly to: MemoryNodeRef
  /** 缺省 related（同侧端点）/ about（记忆→实体）。 */
  readonly relation?: MemoryEdgeRelation
  readonly note?: string
  /** 缺省 user（面板）/ agent（工具）；auto 由服务自己推导，不接受外部指定。 */
  readonly origin?: MemoryEdgeOrigin
}

/** 边查询。 */
export interface MemoryEdgeQuery {
  /** 只看与这个端点相连的边（两个方向都算）。 */
  readonly node?: MemoryNodeRef
  readonly relation?: MemoryEdgeRelation
  readonly origin?: MemoryEdgeOrigin
  readonly limit?: number
}

/** 图节点：一条记忆或一个实体在关联视图里的最小形状。 */
export interface MemoryGraphNode {
  readonly ref: MemoryNodeRef
  readonly label: string
  /** 记忆的 kind 或实体的 kind；给 UI 上色用。 */
  readonly kind: string
  readonly archived: boolean
}

/** 关联视图：一条记忆 + 与它相连的边 + 每条边另一端的节点。 */
export interface MemoryNeighborhood {
  readonly memory: MemoryRecord
  readonly edges: readonly MemoryEdge[]
  /** 与 edges 按 id 对齐的「另一端」节点（端点本身被删除时缺省跳过）。 */
  readonly related: readonly { readonly edgeId: string; readonly node: MemoryGraphNode }[]
}

/**
 * 与另一个记忆插件的冲突。
 *
 * 背景：mneme 之类的记忆插件也注册 memory_save / memory_search / … 同名工具，
 * 而 tools 服务规定「同一层重名注册直接失败」。探测到冲突时本插件会**跳过**这些
 * 名字（而不是让整条注册链路抛错），并把冲突交给面板提示用户二选一。
 */
export interface MemoryConflict {
  /** 已被占用的工具名。 */
  readonly name: string
  /** 占用者自己的工具描述（让用户判断对方是不是记忆插件）。 */
  readonly description: string
}

/** 设置命名空间字段。 */
export interface MemoryConfig {
  /** 生成对话记忆：会话回合结束时自动从对话里提炼值得记住的内容。 */
  autoCapture: boolean
  /** 自动注入：新会话开局把相关记忆注入系统提示。 */
  autoInject: boolean
  /**
   * 写入判定：写入前若附近已有「很像」的条目，让模型判一次「新建 / 并进哪一条 / 不用记」。
   * 关掉就只走字符级阈值（同标题、别名、Dice 重叠）+ 疑似提示。
   */
  autoJudge: boolean
  /** 单次注入条数上限。 */
  maxInjected: number
  /** 注入重要性门槛（1-5）。 */
  importanceThreshold: number
  /** 自动提炼间隔：每 N 个回合提炼一次（1 = 每轮，等于旧行为）。 */
  captureEveryTurns: number
  /** 转录窗口：只取最近几轮对话。 */
  captureMaxTurns: number
  /** 转录字符上限（超出保留尾部）。 */
  captureMaxChars: number
  /** 把助手回复也作为提炼素材（默认关：结论类记忆由 agent 主动写）。 */
  captureIncludeAssistant: boolean
}

export const MEMORY_CONFIG_BASE: MemoryConfig = {
  autoCapture: true,
  autoInject: true,
  autoJudge: true,
  maxInjected: 6,
  importanceThreshold: 4,
  captureEveryTurns: 3,
  captureMaxTurns: 4,
  captureMaxChars: 4000,
  captureIncludeAssistant: false,
}

/**
 * 「导入其他记忆」对话框里的提示词：先在别的 AI 里整理出个人画像，再粘贴回来。
 * 措辞与便签需求一致（保留原始表述、不脑补、包裹代码块）。
 */
export const IMPORT_PROMPT_TEXT = [
  '请帮我整理一份我的个人使用画像，用途是让我在不同 AI 工具之间保持一致的协作体验。请基于你当前能访问到的、与我相关的长期信息和本次会话上下文进行整理。在涉及我的指令和偏好时，请尽量保留我原本的表述方式，不要过度改写。',
  '',
  '分类（按以下顺序输出）',
  '',
  '指令：我明确要求遵循的规则，包括语气、格式、风格、"始终做 X"、"绝不做 Y" 以及对助手行为的纠正。仅整理可从长期记忆中明确识别并客观存在的规则，不临时新增、不强加、不脑补未明确提出的要求。',
  '',
  '身份：姓名、年龄、所在地、教育背景、家庭、人际关系、语言能力和个人兴趣（仅包含我主动分享过的非敏感信息，不输出证件号、联系方式、账号等隐私数据）。',
  '',
  '职业：当前和过往的职位、公司以及主要技能领域。',
  '',
  '项目：我实际参与构建或投入精力的项目。每个项目一条。包含项目功能、当前状态以及关键决策。以项目名称或简短描述作为条目开头。',
  '',
  '偏好：广泛适用的观点、品味和工作风格偏好。',
  '',
  '格式',
  '使用分类标题作为每个类别的节标题。每个类别内，每行一条记录，按日期从早到晚排列。每行格式：',
  '',
  '[YYYY-MM-DD] - 条目内容',
  '',
  '如果日期未知，使用 [unknown] 代替。',
  '',
  '输出',
  '将整个画像包裹在一个代码块中，方便我复制。',
  '代码块之后，简要说明：这是否已覆盖你当前能整理出的全部相关信息；若还有未纳入的维度或你不确定的条目，请列出来，由我判断是否补充。',
].join('\n')

/** 目标作用域是否合法（scope=project 必须有 projectPath）。 */
export function isValidScopeTarget(scope: MemoryScope, projectPath: string | undefined): boolean {
  return scope === 'global' || (projectPath !== undefined && projectPath.trim() !== '')
}
