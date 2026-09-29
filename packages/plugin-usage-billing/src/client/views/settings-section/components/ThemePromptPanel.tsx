/**
 * 「复制到 AI 助手生成」：把主题契约 + 你要的样子拼成一段能直接丢给别的 AI 的提示词。
 *
 * 「你想要的样子」**没有默认值**：主题是审美，替用户猜一个方向，AI 就会朝猜的方向做出
 * 一整个不合用的包。所以空着的时候复制按钮是灰的，提示词区也只是一句引导。
 *
 * 两道守卫是有意的：这里的灰按钮是给眼睛看的，`themePrompt` 抛错是给代码看的。
 * UI 会被绕过（回车、程序化调用、以后换个调用点），函数不会被绕过。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, IconCopyOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { themePrompt } from '../../../themes/theme-prompt.ts'
import styles from '../../../styles/settings-section.module.css'

/** 输入框里的例子：只是 placeholder，不是默认值，空着不会被复制走。 */
const IDEA_PLACEHOLDER = '例如：金额是主体，峰/谷只用一个 8px 圆点 + 一条 24h 细条'

/** 「已复制」回到常态的时长：够看清，又不至于让人以为按钮坏了。 */
const COPIED_MS = 1600

export function ThemePromptPanel(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [idea, setIdea] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const want = idea.trim()
  // 提示词**实时**跟着输入走（不是点一下才生成）：复制之前你能把整段看一遍再决定。
  const prompt = useMemo(() => (want === '' ? '' : themePrompt(want)), [want])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => { setCopied(false) }, COPIED_MS)
    return () => { window.clearTimeout(timer) }
  }, [copied])

  const openModal = useCallback(() => {
    setCopied(false)
    setError(null)
    setOpen(true)
  }, [])
  const closeModal = useCallback(() => { setOpen(false) }, [])

  const copy = useCallback(() => {
    if (prompt === '') return
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (clipboard === undefined) {
      // 没有剪贴板 API（非安全上下文 / 旧浏览器）：提示词就在上面，让用户自己选中。
      setError('这个环境没有剪贴板权限，请手动选中上面的提示词复制。')
      return
    }
    clipboard.writeText(prompt).then(
      () => { setError(null); setCopied(true) },
      () => { setError('复制失败，请手动选中上面的提示词复制。') },
    )
  }, [prompt])

  return (
    <div className={styles.themeActions}>
      <Button variant="outline" size="sm" icon={<IconCopyOutlineRegular size={14} />} onClick={openModal}>
        复制到 AI 助手生成
      </Button>

      <Modal
        className={styles.modalWide}
        contentClassName={styles.modalScroll}
        open={open}
        onClose={closeModal}
        title="复制到 AI 助手生成"
        closeLabel="关闭"
        description="把这段提示词交给任意 AI 助手，让它按契约写一个新的侧栏入口主题。"
        footer={<Button variant="ghost" onClick={closeModal}>关闭</Button>}
      >
        <div className={styles.modalBody}>
          <span className={styles.rowTitle}>1. 你想要的样子</span>
          <textarea
            className={styles.themeIdea}
            value={idea}
            placeholder={IDEA_PLACEHOLDER}
            aria-label="你想要的样子"
            onChange={(event) => { setIdea(event.currentTarget.value) }}
          />

          <span className={styles.rowTitle}>2. 复制这段提示词</span>
          {prompt === '' ? (
            <p className={styles.rowDesc}>先在上面写一句你想要的样子，这里就会生成完整提示词。</p>
          ) : (
            <div className={styles.prompt}>{prompt}</div>
          )}

          <div className={styles.itemActions}>
            <Button
              variant="outline"
              size="sm"
              icon={<IconCopyOutlineRegular size={14} />}
              disabled={prompt === ''}
              onClick={copy}
            >
              {copied ? '已复制' : '复制提示词'}
            </Button>
            {error === null ? null : <span className={styles.themeError}>{error}</span>}
          </div>
        </div>
      </Modal>
    </div>
  )
}
