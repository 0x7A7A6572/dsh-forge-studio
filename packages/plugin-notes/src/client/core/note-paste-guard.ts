/**
 * 编辑器粘贴守卫：把便签编辑器里的图片/文件粘贴先上传到本地附件仓。
 *
 * 纯浏览器侧胶水（window 捕获层监听 + WeakMap 反查 Editor 实例），不 import react。
 * 编辑器根节点用 data-dsh-part="note-editor" 标识 —— 类名被 CSS Modules 哈希之后
 * 不再是稳定钩子，DOM 查询一律走 data 属性。
 */
import type { Editor } from '@tiptap/core'
import { uploadNoteFile } from './note-file-cache.ts'
import { uploadNoteImage } from './note-image-cache.ts'
import { pickClipboardFiles } from './paste-image.ts'

/**
 * 图片/文件粘贴守卫。
 *
 * 背景：dsh web 的 modlens 插件在 document 捕获层注册了全局 paste 监听
 * （paste-to-path：对视觉模型接管图片粘贴，把图片上传成路径插入聊天框），
 * 事件在到达本编辑器（target 阶段）之前就被它 preventDefault +
 * stopImmediatePropagation 掐掉，tiptap 侧任何 handlePaste 都收不到。
 *
 * 对策：在同一事件的更早阶段 —— window 捕获层 —— 注册本守卫。它只接管
 * 「粘贴目标是便签编辑器」的图片与文件（先上传、再插引用），其余
 * 情况（聊天框等）一律放行，不影响 modlens 在其它输入框的行为。
 */
export const registerPasteGuard = (() => {
  let installed = false;
  return (): void => {
    if (installed) return;
    installed = true;
    window.addEventListener(
      "paste",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        // 只处理本便签编辑器内的粘贴（[data-dsh-part="note-editor"] 子树）。
        const editorEl = target.closest('[data-dsh-part="note-editor"]');
        if (!editorEl) return;
        const pm = editorEl.querySelector(".ProseMirror");
        if (!pm) return;
        const editor = liveEditors.get(pm);
        if (!editor) return;
        const files = pickClipboardFiles(event.clipboardData);
        if (files.length === 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void (async () => {
          for (const file of files) {
            try {
              if (file.type.startsWith("image/")) {
                const src = await uploadNoteImage(file);
                editor.chain().focus().setImage({ src, alt: "" }).run();
              } else {
                const name = (file as Blob & { readonly name?: string }).name ?? "附件";
                const src = await uploadNoteFile(file, name);
                editor.chain().focus().insertContent([
                  { type: "text", text: `📎 ${name}`, marks: [{ type: "link", attrs: { href: src } }] },
                  { type: "text", text: " " },
                ]).run();
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const label = file.type.startsWith("image/") ? "图片上传失败：" : "附件上传失败：";
              pm.dispatchEvent(new CustomEvent("notes-image-error", { bubbles: true, detail: { message: label + message } }));
            }
          }
        })();
      },
      true,
    );
  };
})();

/** 编辑器 DOM（.ProseMirror）→ Editor 实例，供捕获层守卫反查。 */
export const liveEditors = new WeakMap<Element, Editor>();
