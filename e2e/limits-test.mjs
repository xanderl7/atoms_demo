/**
 * 验证「边界说明」：模型用了占位内容时，必须原原本本告诉用户
 *   我做了什么 / 我没做什么 / 你后续怎么改
 */
import { chromium } from 'playwright'

const URL = process.env.APP_URL || 'http://localhost:5173'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(URL, { waitUntil: 'networkidle' })

// 直接 import 源码里的 limits.ts 测纯函数
const run = async (code) =>
  page.evaluate(async (c) => {
    const mod = await import('/src/limits.ts')
    const n = mod.describeLimits(c)
    return { note: n, text: n ? mod.renderLimits(n) : null }
  }, code)

console.log('=== 场景 1：作品集（占位图 + 占位文案 + 表单）===')
const portfolio = `<!doctype html><html><head><style>.c{}</style></head><body>
<section><h2>作品</h2>
  <img src="https://picsum.photos/seed/a/800/600" data-placeholder="img">
  <span data-placeholder="text">作品标题 1</span>
  <img src="https://picsum.photos/seed/b/800/600" data-placeholder="img">
  <span data-placeholder="text">作品标题 2</span>
</section>
<section><h2>关于</h2><p>hi@example.com</p></section>
<form><input name="msg"><button>发送</button></form>
<script>
// ↓↓↓ 替换成你自己的内容
const ITEMS = [ { title: '作品标题 1', desc: '这里填一句话说明' } ];
document.addEventListener('DOMContentLoaded', () => {});
</script>
</body></html>`

const r1 = await run(portfolio)
check('识别出占位图片', /2 张图片是 picsum 占位图/.test(r1.text || ''), '')
check('识别出占位文案', /2 处文案是占位文字/.test(r1.text || ''), '')
check('识别出表单不真发', /表单不会真的发出去/.test(r1.text || ''), '')
check('识别出示例邮箱', /示例邮箱/.test(r1.text || ''), '')
check('给出换图指引', /把 <img src/.test(r1.text || ''), '')
check('给出批量改指引（ITEMS 数组）', /const ITEMS/.test(r1.text || ''), '')
check('给出接后端指引', /fetch\(/.test(r1.text || ''), '')
check('说明已做好的部分', /配色、排版、响应式/.test(r1.text || ''), '')
check('三段结构齐全', /我没做到/.test(r1.text) && /我已经做好的/.test(r1.text) && /你后续接手/.test(r1.text))

console.log('\n=== 场景 2：用户提供了真实内容（不该报占位）===')
const real = `<!doctype html><html><head><style>.c{}</style></head><body>
<section><h2>我的项目</h2><p>电商中台重构</p></section>
</body></html>`
const r2 = await run(real)
check('无占位时不啰嗦', r2.note === null, String(r2.note))

console.log('\n=== 场景 3：只有表单，没占位内容 ===')
const formOnly = `<!doctype html><html><body><form><input></form></body></html>`
const r3 = await run(formOnly)
check('只声明表单边界', !!r3.note && r3.note.faked.length === 1, JSON.stringify(r3.note?.faked))
check('不谎报占位图', !/picsum/.test(r3.text || ''))

console.log('\n--- 实际输出样例 ---')
console.log(r1.text)

const pass = results.filter((r) => r.ok).length
console.log(`\n===== ${pass}/${results.length} 通过 =====`)
await browser.close()
process.exit(pass === results.length ? 0 : 1)
