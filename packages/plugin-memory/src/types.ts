/**
 * 跨 host/client 共享的领域类型（type-only import）。
 * 项目记忆以工作区目录为键，比较前统一归一化（normalizeProjectKey）。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

export type MemoryId = Branded<'MemoryId'>

/** 设置命名空间 = cordis.patch.yml 里的 profile 条目 id。 */
export const MEMORY_NAMESPACE = 'zzerx-memory'

export const MEMORY_KINDS = ['preference', 'user', 'project', 'decision', 'fact', 'history'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  preference: '指令',
  user: '身份',
  project: '项目',
  decision: '决策',
  fact: '事实',
  history: '经历',
}

export const MEMORY_IMPORTANCE_LABELS = ['很低', '偏低', '普通', '重要', '关键'] as const

export function importanceLabel(importance: number): string {
  const level = Math.min(MEMORY_IMPORTANCE_LABELS.length, Math.max(1, Math.round(importance)))
  return MEMORY_IMPORTANCE_LABELS[level - 1] ?? '普通'
}

export const MEMORY_SCOPES = ['global', 'project'] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]

export interface MemoryRecord {
  readonly id: MemoryId
  readonly kind: MemoryKind
  readonly scope: MemoryScope
  /** 项目记忆的工作区目录；全局记忆为空串。 */
  readonly projectPath: string
  readonly title: string
  readonly content: string
  /** 一行摘要；未写时为空串。 */
  readonly summary: string
  /** 1-5；>= 注入门槛才会被自动注入。 */
  readonly importance: number
  readonly tags: string[]
  /** 别名：与 title 等价；命中即视为同一条。 */
  readonly aliases: string[]
  readonly pinned: boolean
  readonly archived: boolean
  readonly createdAt: number
  readonly updatedAt: number
  /** 来源：'agent'（模型工具写入）/ 'user'（面板手工写入）/ 'capture'（自动提炼）/ 'import'。 */
  readonly source: string
  readonly sessionId?: string
}

/** 标题相同且同作用域时自动合并。 */
export interface MemorySaveInput {
  readonly title: string
  readonly content: string
  readonly summary?: string
  readonly aliases?: readonly string[]
  /**
   * 关联实体：命中已有实体（名称或别名）则复用，否则按名称新建。
   * 两种情况都落一条 about 边；命中时带 kind 会顺带纠正它的分类。
   */
  readonly entities?: readonly (string | MemoryEntityRef)[]
  readonly kind?: MemoryKind
  readonly scope?: MemoryScope
  /** scope=project 且缺省时由 host 用会话 cwd 兜底。 */
  readonly projectPath?: string
  readonly importance?: number
  readonly tags?: readonly string[]
  readonly source?: string
  readonly sessionId?: string
  readonly pinned?: boolean
}

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

export interface MemoryQuery {
  /** 缺省 global / project 都取。 */
  readonly scope?: MemoryScope
  readonly projectPath?: string
  readonly kind?: MemoryKind
  /** 关键字（标题/正文/摘要/别名/标签的包含匹配，大小写不敏感）。 */
  readonly keyword?: string
  /** 是否包含已归档（缺省 false）。 */
  readonly includeArchived?: boolean
  /** 上限（缺省全部）。 */
  readonly limit?: number
}

export const MEMORY_BUNDLE_SCHEMA = 'memory-bundle'
/** 改动形状必须升版；导入侧会拒绝不认识的版本。 */
export const MEMORY_BUNDLE_VERSION = 1

export interface MemoryBundle {
  readonly schema: typeof MEMORY_BUNDLE_SCHEMA
  readonly version: typeof MEMORY_BUNDLE_VERSION
  readonly exportedAt: number
  readonly records: readonly MemoryRecord[]
  readonly entities: readonly MemoryEntity[]
  readonly edges: readonly MemoryEdge[]
}

/** bundle 是 JSON.parse 后的原始值，形状由 host 校验。 */
export interface MemoryBundleImportInput {
  readonly bundle: unknown
  /** merge = 按 id 合并（同 id 保留 updatedAt 较新的）；replace = 先清空全库再写入。 */
  readonly mode: 'merge' | 'replace'
}

export interface MemoryBundleImportResult {
  readonly added: number
  readonly merged: number
  readonly removed: number
}

export interface MemoryImportInput {
  readonly text: string
  readonly scope: MemoryScope
  /** scope=project 时必填。 */
  readonly projectPath?: string
  /** merge 按标题去重合并（默认）；replace 先清空目标作用域。 */
  readonly mode?: 'merge' | 'replace'
}

export interface MemoryImportResult {
  readonly added: number
  readonly merged: number
  readonly skipped: number
  /** replace 模式下被清空的条数。 */
  readonly removed: number
}

/** 原文留档来源：import 面板粘贴 / capture 自动提炼 / manual 手工新建。 */
export const MEMORY_INGEST_ORIGINS = ['import', 'capture', 'manual'] as const
export type MemoryIngestOrigin = (typeof MEMORY_INGEST_ORIGINS)[number]

export type MemoryRawId = Branded<'MemoryRawId'>

/** 原文留档：原始文本原样落盘，抽取失败可对这一份重跑（recordIds / extractedAt 是抽取痕迹）。 */
export interface MemoryRawDocument {
  readonly id: MemoryRawId
  /** 取值见 MEMORY_INGEST_ORIGINS，允许扩展。 */
  readonly origin: string
  readonly scope: MemoryScope
  readonly projectPath: string
  /** 缺省取原文首行。 */
  readonly title: string
  /** 原文（includeText=false 的列表查询返回空串）。 */
  readonly text: string
  readonly textLength: number
  readonly createdAt: number
  /** 会话转录每轮覆盖时随之推进。 */
  readonly updatedAt: number
  /** 缺省 = 尚未抽取。 */
  readonly extractedAt?: number
  readonly recordIds: readonly string[]
  readonly sessionId?: string
  readonly note?: string
}

export interface MemoryRawInput {
  readonly text: string
  readonly origin: string
  readonly scope: MemoryScope
  readonly projectPath?: string
  readonly title?: string
  readonly sessionId?: string
  readonly note?: string
}

export interface MemoryRawQuery {
  readonly origin?: string
  readonly scope?: MemoryScope
  readonly projectPath?: string
  /** 缺省 true；false 时 text 为空串。 */
  readonly includeText?: boolean
  readonly limit?: number
}

/** 一次后台模型调用的审计记录。 */
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
  /** 上游没报用量时缺省。 */
  readonly tokensIn?: number
  readonly tokensOut?: number
  readonly recordIds: readonly string[]
  readonly rawId?: string
  readonly sessionId?: string
  readonly error?: string
  /** 被硬闸门丢弃的条目（标题 + 原因）。 */
  readonly dropped?: readonly { title: string; reason: string }[]
}

/** 入参不含 id / at，由服务生成。 */
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
  /** 被硬闸门丢弃的条目（标题 + 原因）。 */
  readonly dropped?: readonly { title: string; reason: string }[]
}

export interface MemoryAuditQuery {
  readonly kind?: string
  readonly ok?: boolean
  readonly limit?: number
}

/** 一份原文走完「留档 → 解析 → 条目」三段。 */
export interface MemoryIngestInput {
  readonly text: string
  /** 缺省 import。 */
  readonly origin?: string
  readonly scope?: MemoryScope
  readonly projectPath?: string
  /** merge 按标题去重合并（默认）；replace 先清空目标作用域。 */
  readonly mode?: 'merge' | 'replace'
  /** 覆盖留档标题（缺省取原文首行）。 */
  readonly title?: string
  readonly sessionId?: string
  readonly note?: string
}

export interface MemoryIngestResult extends MemoryImportResult {
  readonly rawId: MemoryRawId
  readonly origin: string
  /** 本次写入 / 合并到的条目 id。 */
  readonly recordIds: readonly string[]
}

export interface MemoryStats {
  readonly total: number
  readonly archived: number
  readonly global: number
  readonly project: number
  /** 原始大小写，去重。 */
  readonly projects: readonly MemoryProjectSummary[]
  readonly raw: number
  readonly audits: number
  /** 实体数（不含已归档）。 */
  readonly entities: number
  readonly edges: number
}

export interface MemoryProjectSummary {
  readonly path: string
  readonly label: string
  readonly count: number
}

/* ---------------- wiki 图层：实体与边 ---------------- */

/** 条目经 about / mentions 挂到实体；条目间的 related 边由共现推导。 */
export type MemoryEntityId = Branded<'MemoryEntityId'>

export const MEMORY_ENTITY_KINDS = ['project', 'tool', 'person', 'org', 'concept', 'other'] as const
export type MemoryEntityKind = (typeof MEMORY_ENTITY_KINDS)[number]

export const MEMORY_ENTITY_KIND_LABELS: Record<MemoryEntityKind, string> = {
  project: '项目',
  tool: '工具',
  person: '人物',
  org: '组织',
  concept: '概念',
  other: '其他',
}

/**
 * 只给名字：分类沿用现状，新建时为 concept。
 * 给 { name, kind }：分类一次到位，命中已有实体时顺带纠正它的 kind。
 */
export interface MemoryEntityRef {
  readonly name: string
  readonly kind?: MemoryEntityKind
}

export interface MemoryEntity {
  readonly id: MemoryEntityId
  readonly name: string
  readonly kind: MemoryEntityKind
  /** 别名：与 name 等价；命中即算提及该实体。 */
  readonly aliases: string[]
  readonly summary: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly archived: boolean
}

/** 带 id 就地更新（可改名）；不带 id 则并入同名实体，否则新建。 */
export interface MemoryEntityInput {
  readonly id?: string
  readonly name: string
  readonly kind?: MemoryEntityKind
  readonly aliases?: readonly string[]
  readonly summary?: string
  readonly archived?: boolean
}

export interface MemoryEntityQuery {
  /** 关键字（名称 / 别名 / 摘要的包含匹配，大小写不敏感）。 */
  readonly keyword?: string
  readonly kind?: MemoryEntityKind
  readonly includeArchived?: boolean
  readonly limit?: number
}

export const MEMORY_NODE_KINDS = ['memory', 'entity'] as const
export type MemoryNodeKind = (typeof MEMORY_NODE_KINDS)[number]

export interface MemoryNodeRef {
  readonly kind: MemoryNodeKind
  readonly id: string
}

/**
 * 记忆→实体：about / mentions；记忆→记忆：related / refines / supersedes / contradicts；
 * 实体→实体：part-of / uses / same-as。
 */
export const MEMORY_EDGE_RELATIONS = [
  'about', 'mentions', 'related', 'refines', 'supersedes', 'contradicts', 'part-of', 'uses', 'same-as',
] as const
export type MemoryEdgeRelation = (typeof MEMORY_EDGE_RELATIONS)[number]

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

/** 对称关系：id 生成时排序端点，a→b 与 b→a 同一条；方向性关系不排序。 */
export const MEMORY_SYMMETRIC_RELATIONS: readonly MemoryEdgeRelation[] = ['related', 'contradicts', 'same-as']

export const MEMORY_EDGE_ORIGINS = ['auto', 'agent', 'user'] as const
export type MemoryEdgeOrigin = (typeof MEMORY_EDGE_ORIGINS)[number]

export const MEMORY_EDGE_ORIGIN_LABELS: Record<MemoryEdgeOrigin, string> = {
  auto: '自动',
  agent: '模型',
  user: '手工',
}

/** id 由端点 + 关系确定性生成；重复连即更新同一条。 */
export interface MemoryEdge {
  readonly id: string
  readonly from: MemoryNodeRef
  readonly to: MemoryNodeRef
  readonly relation: MemoryEdgeRelation
  /** 自动边为空串。 */
  readonly note: string
  /** 权重：自动共现边 = 共享实体数，其余默认 1。 */
  readonly weight: number
  readonly origin: MemoryEdgeOrigin
  readonly createdAt: number
  readonly updatedAt: number
}

export interface MemoryLinkInput {
  readonly from: MemoryNodeRef
  readonly to: MemoryNodeRef
  /** 缺省 related（同侧端点）/ about（记忆→实体）。 */
  readonly relation?: MemoryEdgeRelation
  readonly note?: string
  /** 缺省 user（面板）/ agent（工具）；auto 不接受外部指定。 */
  readonly origin?: MemoryEdgeOrigin
}

export interface MemoryEdgeQuery {
  /** 两个方向都算。 */
  readonly node?: MemoryNodeRef
  readonly relation?: MemoryEdgeRelation
  readonly origin?: MemoryEdgeOrigin
  readonly limit?: number
}

export interface MemoryGraphNode {
  readonly ref: MemoryNodeRef
  readonly label: string
  /** 记忆或实体的 kind，两者不是同一个联合。 */
  readonly kind: string
  readonly archived: boolean
  /** 记忆节点的归属；实体是全量在图里，没有归属。 */
  readonly scope?: MemoryScope
  readonly projectPath?: string
}

export interface MemoryNeighborhood {
  readonly memory: MemoryRecord
  readonly edges: readonly MemoryEdge[]
  /** 与 edges 按 id 对齐；端点已删除的缺省跳过。 */
  readonly related: readonly { readonly edgeId: string; readonly node: MemoryGraphNode }[]
}

/** 工具重名冲突：本插件跳过这些名字，不让整条注册链路抛错。 */
export interface MemoryConflict {
  /** 被别的插件占用的工具名。 */
  readonly name: string
  /** 占用者自己的工具描述。 */
  readonly description: string
}

export interface MemoryModelOption {
  readonly id: string
  readonly name: string
}

export interface MemoryModelGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly MemoryModelOption[]
}

export interface MemoryConfig {
  /** 回合结束时自动从对话里提炼记忆。 */
  autoCapture: boolean
  /** 新会话开局把相关记忆注入系统提示。 */
  autoInject: boolean
  maxInjected: number
  /** 注入重要性门槛（1-5）。 */
  importanceThreshold: number
  /** 每 N 个回合提炼一次（1 = 每轮）。 */
  captureEveryTurns: number
  /** 只取最近几轮对话。 */
  captureMaxTurns: number
  /** 超出保留尾部。 */
  captureMaxChars: number
  /** 把助手回复也作为提炼素材（默认关）。 */
  captureIncludeAssistant: boolean
  /**
   * 后台流程用的 provider / model，取自 dsh 已配置且可路由的模型目录。
   * 两个字段都非空才算指定；任一为空沿用回退链。
   */
  llmProvider: string
  llmModel: string
}

export const MEMORY_CONFIG_BASE: MemoryConfig = {
  autoCapture: true,
  autoInject: true,
  maxInjected: 6,
  importanceThreshold: 4,
  captureEveryTurns: 3,
  captureMaxTurns: 4,
  captureMaxChars: 4000,
  captureIncludeAssistant: false,
  llmProvider: '',
  llmModel: '',
}

/** 「导入其他记忆」对话框里展示的提示词。 */
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

export function isValidScopeTarget(scope: MemoryScope, projectPath: string | undefined): boolean {
  return scope === 'global' || (projectPath !== undefined && projectPath.trim() !== '')
}
