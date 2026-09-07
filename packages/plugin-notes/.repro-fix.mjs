// Confirm the FIX pattern: static inject + async apply (returns a plain Promise, NOT a fiber).
import { Context } from '@deepseek-ai/cordis'

const ctx = new Context()
await ctx.plugin({ name: 'foo-provider', apply: (c) => c.provide('foo', { ok: true }) })

const plugin = {
  name: 'async-apply',
  inject: ['foo'],           // static inject, mirrors plugin-notes' inject = ['storageDomain']
  async apply(c) {
    void c.foo.ok
    // fire-and-forget conditional inject (NOT returned from apply)
    c.inject(['bar'], (cc) => { void cc })
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
