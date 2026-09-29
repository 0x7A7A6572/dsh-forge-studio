/**
 * 弹窗遮罩「点外面就关」的判定（纯逻辑，不 import react / DOM，便于 node 侧门禁直接跑）。
 *
 * 为什么不能只看 click：浏览器把 click 派发到 mousedown 与 mouseup 的**最近公共祖先**。
 * 在编辑卡片里按下拖着选文字、把鼠标拖到卡片外的遮罩上再松手时，mousedown 落在卡片、
 * mouseup 落在遮罩，公共祖先恰好就是遮罩 —— 于是平白多出一次「点了遮罩」的 click，
 * 编辑页据此关闭、未保存的内容跟着丢（issue #3：标签编辑页选中文字在编辑区外释放 →
 * 页面退出且不保存）。
 *
 * 所以判定必须带上**按下位置**这一维：只有「从遮罩本身按下、又在遮罩上抬起」的那次
 * click 才算点外面。卡片（或卡片里任意子节点）里起手的一律不算。
 */

/** 遮罩关闭判定器：一次 pointerdown + 一次 click 为一轮。 */
export interface BackdropDismissGuard {
  /**
   * 指针按下（`pointerdown`）：记下这次按下是否落在遮罩**本身**上。
   * 传 DOM 事件里的 `event.target` / `event.currentTarget`；两者相同即「按在遮罩上」。
   */
  press(target: object | null, backdrop: object | null): void
  /**
   * 点击（`click`）：返回 true 表示这次该按「点了遮罩」处理（关闭）。
   * 点击目标不是遮罩本身时永远返回 false；判定后清空上膛状态，避免一次按下关两次。
   */
  release(target: object | null, backdrop: object | null): boolean
}

/** 造一个判定器：状态只有「上一次按下是否落在遮罩上」这一位。 */
export function createBackdropDismissGuard(): BackdropDismissGuard {
  let pressedOnBackdrop = false
  return {
    press(target, backdrop) {
      pressedOnBackdrop = target !== null && target === backdrop
    },
    release(target, backdrop) {
      if (target === null || target !== backdrop) return false
      const startedOnBackdrop = pressedOnBackdrop
      pressedOnBackdrop = false
      return startedOnBackdrop
    },
  }
}
