/**
 * @zzerx/dsh-plugin-memory/client —— client 入口（browser bundle）。
 *
 * 唯一 UI 面 = dsh 设置面板里的一级「记忆」分区（settings.section）：
 * 1. 先挂载 Typert 远程命名空间 memory（host MemoryService 直连，见 core/remote.ts）
 * 2. 再在设置面板注册分区（视图见 views/settings-section/SettingsSection.tsx，样式见 styles/settings-section.ts）
 *
 * 顺序靠前（order 20）：记忆是基础设置，排在「工作报告」这类导出型工作面之前。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// 类型增广：把设置外壳声明的 settings.section 带进本程序的 SlotMap。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { mountMemoryRemote, memoryOf } from './core/remote.ts'
import { SettingsSection } from './views/settings-section/SettingsSection.tsx'
import { ensureMemoryStyle } from './styles/settings-section.ts'
import { installMemoryNavIcon } from './components/NavIcon.tsx'

export const name = '@zzerx/dsh-plugin-memory/client'
export const inject = ['slots', 'remote']

export function apply(ctx: Context): void {
  // 第一层：先挂载 memory 远程命名空间（self-mount，不走会话）。
  ctx.inject(['slots', 'remote'], async (ctx) => {
    await mountMemoryRemote(ctx)
    ensureMemoryStyle()
    // 侧边栏图标：外壳没有图标入口，只能打补丁（见 components/NavIcon.tsx）。失败即降级。
    ctx.effect(() => installMemoryNavIcon())
    // 第二层：命名空间就绪后再读 remote.memory。
    ctx.inject(['remote.memory', 'remote', 'slots'], (ctx) => {
      const memory = memoryOf(ctx)
      // 声明感知的注入：设置外壳声明 settings.section 之后才注册，与加载顺序无关。
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'memory',
        order: 20,
        label: '记忆',
        inject: () => ({ memory }),
      }, SettingsSection))
    })
  })
}
