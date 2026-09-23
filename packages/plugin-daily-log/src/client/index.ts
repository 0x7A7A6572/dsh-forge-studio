/**
 * @zzerx/dsh-plugin-daily-log/client —— client 入口（browser bundle）。
 *
 * 唯一 UI 面 = dsh 设置面板里的一级「工作报告」分区（settings.section）：
 * 1. 先挂载 Typert 远程命名空间 dailyLog（host DailyLogService 直连，见 core/remote.ts）
 * 2. 再在设置面板注册分区（视图见 views/settings-section/SettingsSection.tsx，
 *    样式见 styles/settings-section.module.css —— CSS Modules 由构建预设自动注入）
 *
 * 分区的「注册 /report 指令」开关经 ctx.configForms 取本插件的配置表单
 * （命名空间 = profile 条目 id `zzerx-daily-log`，值来自 host 插件 Config 的 volatile
 * 字段，见 src/settings.ts），开关只决定 /report 是否注册；工具与引导段的按需注入由
 * host 侧的 gate 负责，与这个开关无关。
 *
 * 早期版本的侧栏入口行 + 中间列接管面板已移除：入口统一收进设置的
 * 一级菜单，报告相关的查看/配置不再占用会话区。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// 类型增广：把设置外壳声明的 settings.section 带进本程序的 SlotMap；
// ConfigForm 是同一包给出的配置表单类型（type-only，无运行时依赖）。
import type {  } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DailyLogConfig } from '../types.ts'
import { DAILY_LOG_NAMESPACE } from '../types.ts'
import { mountDailyLogRemote, dailyLogOf } from './core/remote.ts'
import { SettingsSection } from './views/settings-section/SettingsSection.tsx'
import { installDailyLogNavIcon } from './components/NavIcon.tsx'

export const name = '@zzerx/dsh-plugin-daily-log/client'
export const inject = ['slots', 'configForms', 'remote']

export function apply(ctx: Context): void {
  // 第一层：先挂载 dailyLog 远程命名空间（self-mount，不走会话）。
  ctx.inject(['slots', 'configForms', 'remote'], async (ctx) => {
    await mountDailyLogRemote(ctx)
    // 侧边栏图标：外壳没有图标入口，只能打补丁（见 components/NavIcon.tsx）。失败即降级。
    ctx.effect(() => installDailyLogNavIcon())
    // 第二层：命名空间就绪后再读 remote.dailyLog。
    ctx.inject(['remote.dailyLog', 'remote', 'slots', 'configForms'], (ctx) => {
      const dailyLog = dailyLogOf(ctx)
      // 配置表单：分区里的 enableReportCommand 开关读写它（与 host 插件 Config 同源）。
      const scope = ctx.configForms.get<DailyLogConfig>(DAILY_LOG_NAMESPACE)
      // 声明感知的注入：设置外壳声明 settings.section 之后才注册，与加载顺序无关。
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'daily-log',
        // 排在 Agent 预设之后：先选模型/预设，再管报告这类导出型工作面。
        order: 30,
        label: '工作报告',
        inject: () => ({ dailyLog, scope }),
      }, SettingsSection))
    })
  })
}
