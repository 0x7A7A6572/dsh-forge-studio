/**
 * 主题令牌常量：全部映射到宿主 dsh web 的 --dsw-* 设计令牌，
 * 明/暗主题自动适配。插件 UI 一律经此取色，禁止硬编码色值。
 */

/** 常用别名令牌的集中常量（取值即 var(...) 引用，随宿主主题变化）。 */
export const t = {
  /** 浮层遮罩（宿主 Modal 同款：mask-1 + blur）。 */
  mask: 'var(--dsw-alias-bg-mask-1)',
  maskBlur: 'var(--dsw-mask-blur, blur(2px))',
  /** 面板表面（宿主 Modal dialog 同款 layer-2）。 */
  surface: 'var(--dsw-alias-bg-layer-2)',
  surfaceRaised: 'var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2))',
  /** 边框层级。 */
  borderL1: 'var(--dsw-alias-border-l1)',
  borderL2: 'var(--dsw-alias-border-l2)',
  borderL3: 'var(--dsw-alias-border-l3)',
  /** 文字层级。 */
  labelPrimary: 'var(--dsw-alias-label-primary)',
  labelSecondary: 'var(--dsw-alias-label-secondary)',
  labelTertiary: 'var(--dsw-alias-label-tertiary)',
  labelCaption: 'var(--dsw-alias-label-caption)',
  /** 交互底色。 */
  hoverBg: 'var(--dsw-alias-interactive-bg-hover)',
  activeBg: 'var(--dsw-alias-interactive-bg-active)',
  hoverDangerBg: 'var(--dsw-alias-interactive-bg-hover-danger)',
  hoverSolidBg: 'var(--dsw-alias-interactive-bg-hover-solid)',
  /** 主按钮（capsule）。 */
  primaryFill: 'var(--dsw-alias-button-primary-fill)',
  primaryHover: 'var(--dsw-alias-button-primary-hover)',
  primaryDimmed: 'var(--dsw-alias-button-primary-dimmed)',
  onPrimary: 'var(--dsw-alias-label-primary-foreground)',
  /** 语义色。 */
  danger: 'var(--dsw-alias-state-error-primary)',
  success: 'var(--dsw-alias-state-success-primary)',
  stateWarn: 'var(--dsw-alias-state-warn-label)',
  /** 阴影。 */
  shadowLv3: 'var(--dsw-shadow-lv3)',
  /** markdown 语义底。 */
  codeBg: 'var(--dsw-alias-markdown-inline-code)',
  codeBlockBg: 'var(--dsw-alias-markdown-code-block)',
  /** 品牌强调色（置顶等）。 */
  pinAccent: 'var(--dsw-static-deepseek-450)',
} as const
