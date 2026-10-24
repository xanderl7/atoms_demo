import { defineConfig } from 'vitest/config'

/**
 * 单元测试配置。
 *
 * 环境用 node（不用 happy-dom）：实测 happy-dom 环境在这个沙箱里会让
 * vitest 整体挂住（RUN 之后 100s+ 零输出）。需要 DOM 的测试
 * （verify.test.ts 的 DOMParser）在测试文件里直接 import happy-dom
 * 的 Window 自己注入全局，不走 vitest 的 environment 机制。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
