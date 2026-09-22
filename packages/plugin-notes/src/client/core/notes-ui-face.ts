/**
 * 会话/侧栏入口组件共享的注入面：由 client 入口在注册时经 register 的 inject
 * factory 注入。组件因此不碰 ctx、不 import 任何跨包运行时值（跨包一律 type-only）。
 *
 * 本文件只放类型与常量，无 react、无运行时依赖，但按约定它描述的是 UI 注入面，
 * 放在 core/ 是为了让 components/ 与 client/index.ts 共用同一个定义。
 */

import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client';
import type {
  NoteColor,
  NoteModelSelection,
  NotesConfig,
  TaskStatus,
  TaskTargets,
} from '../../types.ts';
import type { NotesRemote } from './notes-remote.ts';
import type { NoteDraft } from './notes-nav.ts';

/** create 的收窄返回（host 侧 RemoteResult<NoteRecord> 的 ok 面；错误只取 message）。 */
export interface NotesCreateResult {
  readonly ok: boolean;
  readonly error?: { readonly message?: string };
}

/** 新建便签入参（与 views/quick-add-dialog 的 create 面一致）。 */
export interface NotesCreateInput {
  readonly title?: string;
  readonly text: string;
  readonly color?: NoteColor;
  readonly laneStatus?: TaskStatus;
  readonly workspace?: string;
  /** 执行目标（仅与 laneStatus 搭配有意义；缺省 = 宿主默认）。 */
  readonly agentPreset?: string;
  readonly model?: NoteModelSelection;
}

/** 入口组件可用的全部能力。 */
export interface NotesUiFace {
  /** 设置命名空间 scope（读 defaultTitle / entry 开关 / openMode）。 */
  readonly scope: SettingsScope<NotesConfig>;
  /** notes 远程通道（列表/创建等）。 */
  readonly notes: NotesRemote;
  /** 打开便签板：ctx.layout.selectPanel(NOTES_PANEL_ID)。 */
  readonly openBoard: () => void;
  /** 打开任务泳道：开板 + 把视图切到泳道页签（入口弹层里那一行用）。 */
  readonly openTaskLanes: () => void;
  /** 记一笔：打开快捷新建浮层（可带预填草稿 —— 助手消息「存成便签」用）。 */
  readonly capture: (draft?: NoteDraft) => void;
  /** 落库调用（index.ts 注入 notes.create + 错误映射）。 */
  readonly create: (input: NotesCreateInput) => Promise<NotesCreateResult>;
  /** 工作区候选（最近会话用过的 cwd）。 */
  readonly listWorkspaces: () => Promise<readonly string[]>;
  /** 任务执行目标目录（模型 / agent 预设）；宿主缺能力时返回空目录。 */
  readonly listTaskTargets: () => Promise<TaskTargets>;
  /** 新建成功回调（补刷徽标）。 */
  readonly onCreated: () => void;
}
