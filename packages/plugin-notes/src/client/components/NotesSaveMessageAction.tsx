/**
 * 「存成便签」动作（slot: conversation.chat.assistant-actions）—— 挂在助手消息的
 * 操作按钮行里（官方的反馈按钮就在同一行）。
 *
 * 行为：把这条回答**带进快捷新建浮层**（预填标题 + 正文），用户确认后保存。
 * 以前是「直接落库 / 提取失败才开浮层」，提取又因为读错字段永远失败，
 * 于是用户看到的就是「点了只开一个空弹窗」—— 现在只有一条路，且一定带内容。
 *
 * 数据来源：owner 只给**持久消息 id**（ui-chat 的 TurnTailNodeView 传的是
 * `closing.finalNode.messageId`），正文从 chat 快照里按它找，两条路都试：
 * 1. 兼容投影 `snapshot.legacy.nodes`：条目本身就是 AssistantMessageNode，
 *    `kind === 'assistant'` + 顶层 `messageId` + 顶层 `blocks`；
 * 2. chat 视图节点 `snapshot.nodes.values()`：身份在 `data.finalNode.messageId`，
 *    正文在 `data.blocks`（兜底 `data.finalNode.blocks`）。
 *
 * 全程**按鸭子类型**读写，不 import 跨包的节点/块类型 —— 它们在 dsh 次要版本间会改，
 * 绑上去会让本插件跟着一起碎。注意块的判别字段是 **`kind`**（`{kind:'text', text}`），
 * 不是 `type`：早先按 `type` 取，永远取不到，才退化成了空浮层。
 *
 * 取不到正文时**照样开编辑器**（空草稿），不再换一种交互：同一个入口只有一种结果。
 */

import { useCallback } from 'react';
import { StickyNotePlus } from 'lucide-react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import { useNotesEntryEnabled } from '../hooks/useNotesEntryEnabled.ts';
import type { NotesUiFace } from '../core/notes-ui-face.ts';
import styles from '../styles/notes-entry.module.css';

/** 提不出首行时的标题兜底（用户可在编辑器里改）。 */
export const SAVE_MESSAGE_TITLE = '对话摘录';

/** 标题最长多少字（超出截断加省略号）。 */
const TITLE_MAX = 40;

export type NotesSaveMessageActionProps =
  & PropsRuntime<'conversation.chat.assistant-actions'>
  & NotesUiFace;

/** AssistantBlock[] → 纯文本（只取 text 块，reasoning 等不进便签）。 */
function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((block) => {
      const b = block as { kind?: unknown; text?: unknown } | null;
      return b !== null && b.kind === 'text' && typeof b.text === 'string' ? b.text : '';
    })
    .filter((part) => part !== '')
    .join('\n')
    .trim();
}

/**
 * 从 chat 快照里取出某条助手消息的正文。
 * @param snapshot - useChat 的快照。
 * @param messageId - owner 给的持久消息 id（AssistantMessageNode.messageId）。
 * @returns 拼接后的正文；找不到或没有文本块时返回空串。
 */
export function messageText(snapshot: unknown, messageId: string): string {
  const snap = snapshot as
    | {
        nodes?: { values?: () => readonly unknown[] };
        legacy?: { nodes?: readonly unknown[] };
      }
    | null
    | undefined;

  // 路 1：兼容投影（顶层就是 AssistantMessageNode）。
  const legacy = snap?.legacy?.nodes;
  if (Array.isArray(legacy)) {
    for (const node of legacy) {
      const n = node as { kind?: unknown; messageId?: unknown; blocks?: unknown } | null;
      if (n === null || n.kind !== 'assistant' || n.messageId !== messageId) continue;
      const text = blocksToText(n.blocks);
      if (text !== '') return text;
    }
  }

  // 路 2：chat 视图节点（正文在 data.blocks，身份在 data.finalNode.messageId）。
  const values = snap?.nodes?.values?.();
  if (Array.isArray(values)) {
    for (const node of values) {
      const data = (node as { data?: unknown } | null)?.data as
        | { blocks?: unknown; finalNode?: { messageId?: unknown; blocks?: unknown } }
        | null
        | undefined;
      if (data === null || data === undefined) continue;
      if (data.finalNode?.messageId !== messageId) continue;
      const text = blocksToText(data.blocks) || blocksToText(data.finalNode.blocks);
      if (text !== '') return text;
    }
  }

  return '';
}

/**
 * 用正文首行当标题：去掉 markdown 记号（#/>/-/* 与强调符）后截断。
 * @param text - 助手回答正文。
 * @returns 标题；首行没有可用文字时用 {@link SAVE_MESSAGE_TITLE}。
 */
export function titleFromText(text: string): string {
  const first = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? '';
  const plain = first.replace(/^[#>\-*\s]+/, '').replace(/[*`_]/g, '').trim();
  if (plain === '') return SAVE_MESSAGE_TITLE;
  return plain.length > TITLE_MAX ? `${plain.slice(0, TITLE_MAX)}…` : plain;
}

/** @returns 存成便签按钮；开关关闭时渲染 null。 */
export function NotesSaveMessageAction(props: NotesSaveMessageActionProps): JSX.Element | null {
  const enabled = useNotesEntryEnabled(props.scope, 'saveMessageAction');
  const { messageId, useChat, capture } = props;

  // 正文必须在**渲染期**取出：hook 只能在组件/hook 顶层调用，放进事件回调就是
  // 违反 Hooks 规则（lint 会直接报 error）。回调里只读这个已经算好的字符串。
  const text = useChat((snapshot) => messageText(snapshot, messageId));

  const save = useCallback((): void => {
    // 打开快捷新建浮层并预填这条回答（落库仍走浮层里那次显式保存）。
    // 走浮层而不是板内编辑器：板内编辑器只在便签板挂载时存在，而这里的按钮长在
    // 会话里 —— 板没开的时候开板内编辑器，用户什么也看不到。
    capture(text === '' ? undefined : { title: titleFromText(text), text });
  }, [text, capture]);

  if (!enabled) return null;
  return (
    <button
      type="button"
      className={styles.entryBtn}
      title="存成便签"
      aria-label="存成便签"
      onClick={save}
    >
      <StickyNotePlus size={16} />
    </button>
  );
}
