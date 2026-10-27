/**
 * 「存成便签」动作（slot: conversation.chat.assistant-actions）：把助手这条回答
 * 带进快捷新建浮层。正文从 chat 快照按持久消息 id 取，两条鸭子类型路径都试。
 *
 * 纯文本与图片块按原顺序转 Markdown：图片先上传本地图片仓换成引用，
 * 导入失败在该位置留「（图片导入失败）」，文字照存。
 * 取不到正文时照样开编辑器（空草稿），同一入口只有一种结果。
 */

import { useCallback, useRef, useState } from 'react';
import { StickyNotePlus } from 'lucide-react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import { useNotesEntryEnabled } from '../hooks/useNotesEntryEnabled.ts';
import type { NotesUiFace } from '../core/notes-ui-face.ts';
import {
  assistantMessageBlocks,
  blocksText,
  draftFromBlocks,
  titleFromText,
} from '../core/message-draft.ts';
import { uploadNoteImage } from '../core/note-image-cache.ts';
import styles from '../styles/notes-entry.module.css';

export type NotesSaveMessageActionProps =
  & PropsRuntime<'conversation.chat.assistant-actions'>
  & NotesUiFace
  & {
    /** slot 运行时标准 props；取不到时图片导入降级为纯文本。 */
    readonly sessionId?: string;
  };

export function NotesSaveMessageAction(props: NotesSaveMessageActionProps): JSX.Element | null {
  const enabled = useNotesEntryEnabled(props.scope, 'saveMessageAction');
  const { messageId, useChat, capture, sessionId, resolveConversationImage } = props;
  /** 最新快照：selector 返回文本时顺带记下，点击时用它取图片块。 */
  const snapshotRef = useRef<unknown>(undefined);
  const text = useChat((snapshot) => {
    snapshotRef.current = snapshot;
    return blocksText(assistantMessageBlocks(snapshot, messageId));
  });
  const [busy, setBusy] = useState(false);

  const save = useCallback((): void => {
    const blocks = assistantMessageBlocks(snapshotRef.current, messageId);
    const hasImage = blocks.some((block) => (block as { kind?: unknown } | null)?.kind === 'image');
    if (!hasImage) {
      capture(text === '' ? undefined : { title: titleFromText(text), text });
      return;
    }
    const importImage = async (attachment: unknown): Promise<string> => {
      if (resolveConversationImage === undefined || sessionId === undefined) {
        throw new Error('当前会话不支持图片导入');
      }
      const url = await resolveConversationImage(sessionId, attachment);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`读取会话图片失败（HTTP ${response.status}）`);
      return uploadNoteImage(await response.blob());
    };
    setBusy(true);
    void draftFromBlocks(blocks, importImage)
      .then((draft) => {
        capture({ title: draft.title, text: draft.text });
      })
      .catch((error) => {
        console.warn('[plugin-notes] conversation image import failed:', error);
        capture(text === '' ? undefined : { title: titleFromText(text), text });
      })
      .finally(() => setBusy(false));
  }, [capture, messageId, resolveConversationImage, sessionId, text]);

  if (!enabled) return null;
  return (
    <button
      type="button"
      className={styles.entryBtn}
      title={busy ? '正在导入图片…' : '存成便签'}
      aria-label={busy ? '正在导入图片' : '存成便签'}
      disabled={busy}
      onClick={save}
    >
      <StickyNotePlus size={16} />
    </button>
  );
}
