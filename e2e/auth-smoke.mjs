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

  // 门禁：进入即强制弹出，不用点按钮
  await page.waitForSelector('.seg', { timeout: 5000 })
  const autoOpen = (await page.locator('.modal').count()) > 0
  // 关不掉：没有「取消」按钮
  const hasCancel = (await page.getByRole('button', { name: '取消', exact: true }).count()) === 1
  // 点遮罩也关不掉
  await page.locator('.mask').click({ position: { x: 5, y: 5 } }).catch(() => {})
  const stillOpenAfterMask = (await page.locator('.modal').count()) > 0

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

  // 退出 → 门禁重新出现（必须再登录才能用）
  let gateRelocked = false
  if (chip.includes(USER)) {
    await page.getByRole('button', { name: '退出', exact: true }).click()
    await page.waitForTimeout(300)
    gateRelocked = (await page.locator('.modal').count()) > 0
  }

  console.log(JSON.stringify({
    user: USER, autoOpen, hasCancel, stillOpenAfterMask,
    chip, modalGone, ls, gateRelocked, errors,
  }, null, 2))
  await browser.close()

  const ok = chip.includes(USER) && modalGone && !!ls && !hasCancel
    && autoOpen && stillOpenAfterMask && gateRelocked && errors.length === 0
  process.exit(ok ? 0 : 1)
}
run().catch((e) => { console.error(e); process.exit(2) })
