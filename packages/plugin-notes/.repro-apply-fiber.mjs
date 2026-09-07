// Minimal reproduction: does `apply` returning `ctx.inject(...)` (a fiber/PromiseLike)
// cause cordis to throw "Invalid effect"?
import { Context } from '@deepseek-ai/cordis'

const ctx = new Context()

// Provide a fake 'foo' service.
await ctx.plugin({ name: 'foo-provider', apply: (c) => c.provide('foo', { ok: true }) })

// A plugin whose apply returns ctx.inject(...) — mirrors plugin-notes' host apply.
const plugin = {
  name: 'returns-inject',
  apply(c) {
    return c.inject(['foo'], async (cc) => {
      void cc.foo.ok
    })
  },
}

try {
  const fiber = ctx.plugin(plugin)
  await fiber
  console.log('RESULT: loaded OK (no error)')
} catch (e) {
  console.log('RESULT: ERROR ->', e && e.message ? e.message : e)
}

await ctx.fiber.dispose()
