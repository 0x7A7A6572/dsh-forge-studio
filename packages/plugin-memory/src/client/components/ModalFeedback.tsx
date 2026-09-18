/** 通用零件：弹窗里的反馈条。与记忆业务无关，故放 client/components/。 */

/**
 * 弹窗内的操作结果提示。
 * run() 把错误写进分区正文，而弹窗是 portal 覆盖在上面的 —— 不在这里再显示一份，
 * 弹窗里的失败就完全看不见，用户视角就是「点了没反应」。
 */
export function ModalFeedback(props: { error: string; notice: string }) {
  return (
    <>
      {props.error !== '' && <span className="mem-error" role="alert">{props.error}</span>}
      {props.notice !== '' && <span className="mem-notice">{props.notice}</span>}
    </>
  )
}
