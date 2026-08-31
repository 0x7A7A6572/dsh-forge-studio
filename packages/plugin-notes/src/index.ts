import { Context } from '@deepseek-ai/cordis'

export const name = '@forge-studio/dsh-plugin-notes'
export const inject = []

export function apply(ctx: Context): void {
  ctx.logger('notes').info('[m0] notes plugin loaded')
}
