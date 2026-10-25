import { chromium } from 'playwright'

const BASE = 'http://localhost:4173'
const USER = 'bob_' + Date.now()

const run = async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.waitForTimeout(800)

  // 打开弹窗
  await page.getByRole('button', { name: '登录 / 注册', exact: true }).click()
  await page.waitForSelector('.seg', { timeout: 5000 })

  // 切到「注册」
  await page.locator('.seg button', { hasText: '注册' }).click()
  await page.waitForTimeout(200)

  // 填用户名 + 密码
  await page.locator('.modal input[placeholder="任意字符串"]').first().fill(USER)
  await page.locator('.modal input[type="password"]').fill('pw123')

  // 点注册
  await page.locator('.modal-actions .send').click()

  // 等弹窗关闭（最多 5s）
  await page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 5000 })
    .catch(() => {})

  const chip = (await page.locator('.topbar .user-chip').textContent().catch(() => null)) || ''
  const modalGone = (await page.locator('.modal').count()) === 0
  const ls = await page.evaluate(() => localStorage.getItem('atoms-demo.auth'))

  // 退出 → 回到未登录态
  let backToLogin = false
  if (chip.includes(USER)) {
    await page.getByRole('button', { name: '退出', exact: true }).click()
    await page.waitForTimeout(200)
    backToLogin = await page
      .getByRole('button', { name: '登录 / 注册', exact: true })
      .isVisible()
      .catch(() => false)
  }

  console.log(JSON.stringify({ user: USER, chip, modalGone, ls, backToLogin, errors }, null, 2))
  await browser.close()

  const ok = chip.includes(USER) && modalGone && !!ls && backToLogin && errors.length === 0
  process.exit(ok ? 0 : 1)
}
run().catch((e) => { console.error(e); process.exit(2) })
