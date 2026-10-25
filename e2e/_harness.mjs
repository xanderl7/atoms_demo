import { chromium as pwChromium } from 'playwright'

/**
 * e2e 浏览器包装：门禁上线后，未登录页面会被「登录 / 注册」弹窗挡住、
 * 无法交互。这里统一给每个新 page 注入一个已登录态（localStorage 里的
 * atoms-demo.auth），让行为类 e2e 跳过门禁、直接测页面功能。
 *
 * 真实用户仍然必须先登录 / 注册 —— 这个种子只作用于 e2e 自动化。
 * 专门测门禁本身的脚本（auth-smoke / auth-screenshot）不要走这个包装，
 * 它们直接 `import { chromium } from 'playwright'`。
 */

const SEED_USER = 'e2e_bot'

function seed(page) {
  // addInitScript 在页面任何脚本执行前运行，覆盖初次导航与后续 reload
  return page.addInitScript((username) => {
    try {
      localStorage.setItem('atoms-demo.auth', JSON.stringify({ username }))
    } catch {
      /* about:blank 阶段 localStorage 不可用，忽略；真正导航时会再跑一遍 */
    }
  }, SEED_USER)
}

export const chromium = {
  async launch(...args) {
    const browser = await pwChromium.launch(...args)

    const origNewContext = browser.newContext.bind(browser)
    browser.newContext = async (...ctxArgs) => {
      const ctx = await origNewContext(...ctxArgs)
      const origNewPage = ctx.newPage.bind(ctx)
      ctx.newPage = async (...pageArgs) => {
        const page = await origNewPage(...pageArgs)
        await seed(page)
        return page
      }
      return ctx
    }

    const origNewPage = browser.newPage.bind(browser)
    browser.newPage = async (...pageArgs) => {
      const page = await origNewPage(...pageArgs)
      await seed(page)
      return page
    }

    return browser
  },
}
