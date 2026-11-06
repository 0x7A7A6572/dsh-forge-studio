/**
 * 像素场景的运行时契约（§6.4）：纯类型 + 常量，不 import react。
 * 图集条目为 flat 形状（x/y/w/h/pivotX/pivotY），与 atlas-map.generated.ts 严格一致。
 */

export type StudioSceneId = 'office' | 'forge' | 'bridge' | 'classroom' | 'lab' | 'theater'

/** 场景视觉状态，由 §5.5 的合成状态映射得到。 */
export type StudioVisualState = 'idle' | 'working' | 'done' | 'error' | 'provisioning'

/** 素材图集名：bg（无人物背景整图）与 chars 分开；env 为遗留坐标表（不再内联像素）。 */
export type StudioSheet = 'bg' | 'env' | 'chars'

export interface PixelPoint {
  readonly x: number
  readonly y: number
}

export interface PixelRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** 图集条目（与生成物 AtlasMapEntry 同形状）。 */
export interface StudioAtlasEntry {
  readonly id: string
  readonly sheet: StudioSheet
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** 图集内锚点：家具 0/0，角色 pivotY = h（脚底中心）。 */
  readonly pivotX: number
  readonly pivotY: number
}

/** 图集尺寸：sheet → 宽高（镜像生成物的 ATLAS_SHEETS）。 */
export type StudioAtlasSheets = Readonly<
  Record<StudioSheet, { readonly width: number; readonly height: number }>
>

/** 图集坐标表（结构化镜像生成物；主题包编译产出同形状对象）。 */
export interface StudioAtlasMap {
  readonly sourceSha256: string
  readonly scriptVersion: string
  readonly sheets: StudioAtlasSheets
  readonly entries: readonly StudioAtlasEntry[]
}

/** 一帧动画的变化：位移 + 特效。 */
export interface StudioAnimationFrame {
  readonly index: number
  readonly offset: PixelPoint
  readonly effects: readonly string[]
}

/** 一个视觉状态对应的一段动画。 */
export interface StudioAnimationClip {
  readonly state: StudioVisualState
  readonly frameCount: number
  readonly fps: number
  readonly loop: boolean
  /**
   * 非循环动画播完后的额外停留毫秒；0 = 不额外停留，按非循环语义停末帧
   * （如 error 停 f3）。done 的 2400ms 由此承载。
   */
  readonly holdMs: number
  readonly frames: readonly StudioAnimationFrame[]
}

/** 成员状态 → 视觉状态的映射表。 */
export interface StudioStateMapping {
  readonly running: StudioVisualState
  readonly inactive: StudioVisualState
  readonly provisioning: StudioVisualState
  readonly failed: StudioVisualState
  readonly done: StudioVisualState
}

/** 内置状态映射（office）；自定义主题包可给不同映射。 */
export const BUILTIN_STATE_MAPPING: StudioStateMapping = {
  running: 'working',
  inactive: 'idle',
  provisioning: 'provisioning',
  failed: 'error',
  done: 'done',
}

/** 静态素材引用：按图集语义 id 引用，不直接引用图片或坐标。 */
export interface StudioAtlasRef {
  readonly sheet: StudioSheet
  readonly entry: string
  /** 相对工位左上角的偏移。 */
  readonly at: PixelPoint
  readonly flipX?: boolean
}

/** 一个人物槽（Lead / 成员工位 / 溢出位）。 */
export interface StudioSlot {
  readonly id: string
  readonly role: 'lead' | 'member'
  /** 坐姿脚底锚点（画布逻辑像素）；工作态区域按 anchor + 场景常量偏移 blit。 */
  readonly anchor: PixelPoint
  /** 工位矩形（pod 区域，调试/命中用）。 */
  readonly station: PixelRect
  /** 块内方位（左/右座），决定工位块区域的子区域与贴图原点。 */
  readonly side?: 'left' | 'right'
  /** 可容纳人数（溢出位 >1；其余为 1）。 */
  readonly capacity: number
  /** 多占用位之间的水平间距（像素）。 */
  readonly anchorStep: number
  /** 槽位排序键：同一场景内严格递增。 */
  readonly order: number
}

/** 图层声明。渲染实现按 kind 决定绘制阶段。 */
export interface StudioLayer {
  readonly id: string
  readonly kind: 'background' | 'furniture' | 'character' | 'effects' | 'overlay'
  /** 静态层只在主题/槽位变化时重绘。 */
  readonly static: boolean
  readonly z: number
}

/** 场景级环境动画（办公室没有；保留声明以便其他场景使用）。 */
export interface StudioAmbient {
  readonly id: string
  readonly kind: 'none' | 'fire' | 'dust' | 'smoke'
  readonly at: PixelPoint
  readonly fps: number
  readonly frames: readonly string[]
}

/** 一个完整场景包。纯数据，无函数（便于序列化、对比、主题包编译）。 */
export interface StudioScenePack {
  readonly id: StudioSceneId
  readonly name: string
  readonly description: string
  readonly canvas: {
    readonly width: number
    readonly height: number
    readonly cell: 8
  }
  /** 人物绘制框上限（素材按实测 bbox 原尺寸绘制，不缩放到这个框）。 */
  readonly spriteDrawBox: { readonly width: number; readonly height: number }
  readonly scalePolicy: 'native-1x'
  /** 该场景使用的图集/背景（文件基名，扩展名由 atlas.ts 按 sheet 映射）。 */
  readonly atlas: { readonly bg: string; readonly chars: string }
  readonly states: StudioStateMapping
  readonly clips: Readonly<Record<StudioVisualState, StudioAnimationClip>>
  readonly layers: readonly StudioLayer[]
  /** 按 order 升序；索引即分配顺序。 */
  readonly slots: readonly StudioSlot[]
  readonly overflow: 'queue' | 'hide'
  readonly ambient: readonly StudioAmbient[]
  /** working 坐/站轮换周期（tick）；缺省 48。 */
  readonly wanderTicks?: number
}

/** 场景注册表：只放内置场景；选择逻辑在 studio-model。 */
export interface StudioSceneRegistry {
  readonly defaultSceneId: StudioSceneId
  readonly scenes: Readonly<Partial<Record<StudioSceneId, StudioScenePack>>>
}

/** 角色 sprite 的语义引用：图集条目 + 强调色变体下标（0..variants-1）。 */
export interface CharacterSprite {
  readonly sheet: 'chars'
  readonly entry: string
  readonly accent: number
  /** §10.8：组合耗尽后的确定性复用标记（侧栏显示「复用角色」）。 */
  readonly reused?: boolean
  /** 素材不可用时的自绘 fallback（16×24，索引调色板）。 */
  readonly fallback?: PixelSprite
}

/** 运行时成员模型（由纯函数生成，交给渲染层）。 */
export interface StudioOccupant {
  readonly memberId: string
  readonly name: string
  readonly role: 'lead' | 'member'
  readonly visual: StudioVisualState
  readonly character: CharacterSprite
  readonly slot: StudioSlot
  /** 溢出位内的序号（0 起；非溢出恒 0）。 */
  readonly seat: number
  /** 实时脚底坐标（游走/归位/在位；像素，可为小数）。 */
  readonly foot: PixelPoint
  /** 是否处于坐姿（chair 座位在位时；渲染据此裁腿/标签高度）。 */
  readonly seated: boolean
  /** 本帧位移 dx（游走朝向用；0 = 静止）。 */
  readonly moveDx?: number
  /** 失败原因（failed 时来自投影的 error）。 */
  readonly error?: string
  readonly model?: string
}

/** 单成员游走状态（wander.ts 纯函数推进；经 memo 跨帧回传）。 */
export interface StudioWanderState {
  /** 已选目标序号（确定性游走的关键）。 */
  readonly visitIndex: number
  /** 当前目标（像素；null = 无目标/原地）。 */
  readonly target: PixelPoint | null
  /** 剩余路径点（格中心像素）。 */
  readonly path: readonly PixelPoint[]
  /** 当前脚底坐标。 */
  readonly foot: PixelPoint
  /** 停留截止时间（毫秒；now < waitUntil 时原地等待）。 */
  readonly waitUntil: number
  /** true = 正在返回座位（非 idle 成员归位中）。 */
  readonly returning: boolean
}

/** 跨帧记忆：渲染层把 model.memo 原样传回下一帧即可保持 done 边沿与槽位稳定。 */
export interface StudioMemo {
  /** memberId → done 窗口到期时间（毫秒）；不在窗口的成员不出现。 */
  readonly doneUntil?: Readonly<Record<string, number>>
  /** 上一帧各成员的视觉状态（done 边沿检测用）。 */
  readonly previousVisuals?: Readonly<Record<string, StudioVisualState>>
  /** 最近一次使用的真实工位（空闲持有判定、坐席脚底回退与测试注入用）。 */
  readonly previousSlots?: Readonly<Record<string, string>>
  /** 本次干活会话占用的工位（memberId → slotId）；转 idle 即释放，新会话就近重选。 */
  readonly sessionSlots?: Readonly<Record<string, string>>
  /** 各成员游走状态（idle 游走/非 idle 归位；wander.ts 推进）。 */
  readonly wander?: Readonly<Record<string, StudioWanderState | null>>
  /** 上一帧的 now（ms），供计算 dt；缺省按 0 位移处理。 */
  readonly wanderLastNow?: number
}

/** 一帧要画的全部事实。studio-model 产出，渲染层只读。 */
export interface StudioStageModel {
  readonly scene: StudioScenePack
  readonly occupants: readonly StudioOccupant[]
  readonly emptySlots: readonly StudioSlot[]
  /** 溢出的成员（渲染层画前 2 个到沙发区，其余只进 DOM 计数）。 */
  readonly overflowMembers: readonly StudioOccupant[]
  /** 空闲游走的成员：不占工位（伪槽位渲染），工位数 = 并发干活上限。 */
  readonly roamers: readonly StudioOccupant[]
  readonly atlasAvailable: boolean
  readonly now: number
  /** 本帧记忆（visuals/槽位/done 窗口），下一帧原样传回 composeStageModel。 */
  readonly memo: StudioMemo
}

/** 自绘 fallback 精灵：索引 0 = 透明，1..N = fallback 调色板下标。 */
export interface PixelSprite {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

/** 全局 tick 频率（§5.1）：慢速 clip 按 fps 折算成每帧 tick 数。 */
export const STUDIO_TICK_FPS = 12

/** done 窗口时长（§5.5）：running→inactive 边沿后的停留毫秒。 */
export const STUDIO_DONE_HOLD_MS = 2400
