/**
 * 「我们做不到的事」的识别测试。
 * 目标：用户要真实素材时必须走引导，绝不能去编造。
 */
import { chromium } from './_harness.mjs'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })

const detect = async (t) =>
  page.evaluate(async (s) => {
    const mod = await import('/src/unsupported.ts')
    return mod.detectUnsupported(s)
  }, t)

const render = async (code) =>
  page.evaluate(async (c) => {
    const mod = await import('/src/unsupported.ts')
    return mod.renderUnsupported('upload', c)
  }, code)

let pass = 0,
  fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

console.log('=== 应该被拦截（我们要引导用户自己改）===')
const blocked = [
  '帮我把作品换成真实作品',
  '用我的照片',
  '上传我的简历',
  '把图片换成我自己的',
  '我要传几张作品图给你',
  '改成真实作品',
  '用我的素材填充这个页面',
]
for (const t of blocked) {
  const r = await detect(t)
  ok(`「${t}」被拦截`, r === 'upload', `得到 ${r}`)
}

console.log('\n=== 不该被拦截（正常请求）===')
const allowed = [
  '把标题改成我的名字',
  '把文案改成作品简介',
  '帮我做个作品集展示页',
  '把主色改成蓝色',
  '删掉页脚',
  '加一个联系表单',
  '换成深蓝色',
  '用 Tailwind 风格的卡片布局',
]
for (const t of allowed) {
  const r = await detect(t)
  ok(`「${t}」不拦截`, r === null, `得到 ${r}`)
}

console.log('\n=== 引导文案要说清楚三件事 ===')
const code = `<!DOCTYPE html><html><head><style>body{color:#111}</style></head><body>
<img src="https://picsum.photos/seed/a/800/600" data-placeholder="img">
<span data-placeholder="text">作品标题 1</span>
<form><input name="x"><button>发送</button></form>
<script>const ITEMS = [{title:'作品标题 1'}];</script>
</body></html>`
const guide = await render(code)
ok('说了"没有上传入口"', guide.includes('没有上传入口'), '')
ok('说了不会编造', guide.includes('不会给你编'), '')
ok('指出了图片是占位图', guide.includes('占位图'), '')
ok('给出了具体改法', guide.includes('picsum.photos') && guide.includes('data-placeholder'), '')
ok('指出了表单不发出去', guide.includes('表单'), '')
ok('给了文字这条路', guide.includes('文字'), '')

console.log('\n=== 没有代码时的引导也不能崩 ===')
const g2 = await render('')
ok('空代码也有引导', g2.length > 50 && g2.includes('没有上传入口'), `长度 ${g2.length}`)

await browser.close()
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
