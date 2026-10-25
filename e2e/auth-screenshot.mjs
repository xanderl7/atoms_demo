import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const OUT = '/Users/choihuang/WorkBuddy AI/2026-10-24-01-36-59/atoms-demo/e2e/auth-screenshots'

const run = async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } })

  // 1) 未登录态：进入即被门禁挡住（弹窗已自动打开，无需点按钮）
  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.waitForTimeout(500)
  await page.waitForSelector('.seg', { timeout: 3000 })
  await page.screenshot({ path: `${OUT}/01-gate-autopen.png` })

  // 2) 登录 tab（默认）
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/02-modal-login.png` })

  // 3) 切到「注册」
  await page.locator('.seg button', { hasText: '注册' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/03-modal-register.png` })

  // 4) 模拟已登录：直接注入 localStorage，刷新看顶栏
  await page.evaluate(() => {
    localStorage.setItem('atoms-demo.auth', JSON.stringify({ username: 'test_user' }))
  })
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/04-topbar-logged-in.png` })

  await browser.close()
  console.log('done')
}
run().catch((e) => { console.error(e); process.exit(2) })
