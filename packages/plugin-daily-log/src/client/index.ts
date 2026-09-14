/**
 * @zzerx/dsh-plugin-daily-log/client —— client 入口（browser bundle）。
 *
 * 唯一 UI 面 = dsh 设置面板里的一级「工作报告」分区（settings.section）：
 * 1. 先挂载 Typert 远程命名空间 dailyLog（host DailyLogService 直连，见 core/remote.ts）
 * 2. 再在设置面板注册分区（视图见 views/section.tsx，样式见 views/ui-css.ts）
 *
 * 早期版本的侧栏入口行 + 中间列接管面板已移除：入口统一收进设置的
 * 一级菜单，报告相关的查看/配置不再占用会话区。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// 类型增广：把设置外壳声明的 settings.section 带进本程序的 SlotMap。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { mountDailyLogRemote, dailyLogOf } from './core/remote.ts'
import { DailyLogSection } from './views/section.tsx'
import { ensureDailyLogStyle } from './views/ui-css.ts'

export const name = '@zzerx/dsh-plugin-daily-log/client'
export const inject = ['slots', 'remote']

export function apply(ctx: Context): void {
  // 第一层：先挂载 dailyLog 远程命名空间（self-mount，不走会话）。
  ctx.inject(['slots', 'remote'], async (ctx) => {
    await mountDailyLogRemote(ctx)
    ensureDailyLogStyle()
    // 第二层：命名空间就绪后再读 remote.dailyLog。
    ctx.inject(['remote.dailyLog', 'remote', 'slots'], (ctx) => {
      const dailyLog = dailyLogOf(ctx)
      // 声明感知的注入：设置外壳声明 settings.section 之后才注册，与加载顺序无关。
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'daily-log',
        // 排在 Agent 预设之后：先选模型/预设，再管报告这类导出型工作面。
        order: 30,
        label: '工作报告',
        inject: () => ({ dailyLog }),
      }, DailyLogSection))
    })
  })
}
