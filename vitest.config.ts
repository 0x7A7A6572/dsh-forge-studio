import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // .research/ 里是历史复现工程（自带 spec），别收进本仓库的测试。
    include: ['scripts/**/*.spec.ts'],
  },
})
