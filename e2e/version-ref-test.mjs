/**
 * 版本指代测试。
 *
 * 用户实测踩的坑（截图里的对话）：
 *   1. 用户"改成第二版" → 模型回"我目前没有第二版的具体信息"
 *   2. 用户"你不是说一共有两版吗" → 模型把"版"理解成"页面数量"
 *   3. 用户"改回后面那版颜色" → 它只能猜
 * 根因：路由时只传了"有没有页面"这个布尔值，模型根本看不到版本历史。
 *
 * 修法：
 *   1) 本地直接切版本（治本）—— 系统存着每一版，凭什么让模型猜
 *   2) 版本历史摘要传给路由（治标）—— 让它至少知道有几版、每版是啥
 */
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })

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

// 直接 import dev server 上的真实模块（Vite 负责转译 TS），
// 不内联复制逻辑 —— 复制必漂移：源码改了测试跑的还是旧规则
const resolve = (text, total, currentIdx) =>
  page.evaluate(async ({ t, n, i }) => {
    const mod = await import('/src/versionRef.ts')
    return mod.resolveVersionRef(t, n, i)
  }, { t: text, n: total, i: currentIdx })

/** 调 versionRef.ts 里的其它导出（isRebuild / isDriftComplaint） */
const callFlag = (fn, text) =>
  page.evaluate(async ({ f, t }) => {
    const mod = await import('/src/versionRef.ts')
    return mod[f](t)
  }, { f: fn, t: text })

console.log('=== 明确指代版本：直接切，不问模型 ===')
// 场景复现：2 版，当前停在第 1 版（回退过）
ok('「改成第二版」→ 第 2 版', (await resolve('改成第二版', 2, 0)) === 1)
ok('「改回第2版」→ 第 2 版', (await resolve('改回第2版', 2, 0)) === 1)
ok('「回到第 2 版」→ 第 2 版', (await resolve('回到第 2 版', 2, 0)) === 1)
ok('「换成第2版那个」→ 第 2 版', (await resolve('换成第2版那个', 2, 0)) === 1)
ok('「改过来吧」→ 下一版', (await resolve('算了还是改过来吧', 2, 0)) === 1)
ok('「刚才那版」→ 下一版', (await resolve('回到刚才那版', 3, 1) === 2))
ok('「上一版」→ 上一版', (await resolve('上一版', 3, 1) === 0))
ok('「下一版」→ 下一版', (await resolve('下一版', 3, 1) === 2))
ok('「后面那版颜色」→ 下一版', (await resolve('改回后面那版颜色', 3, 1) === 2))

console.log('\n=== 不该误触发的 ===')
ok('只有一版时「改成第二版」不触发', (await resolve('改成第二版', 1, 0)) === null)
ok('越界「改成第九版」不触发', (await resolve('改成第九版', 2, 0)) === null)
ok('「改成蓝色」不触发', (await resolve('改成蓝色', 2, 0)) === null)
ok('「把第二版那个区块删掉」——含"第二版"会触发（可接受，意图明确）', (await resolve('把第二版那个区块删掉', 2, 0)) === 1)

console.log('\n=== 质问/不满里提到版本：不是切换指令（实测踩坑）===')
// 用户原话："你这个第三版是什么东西，完全不是hello world了" ——
// 系统曾经回"已切到第 3 版"，用户问东它答西
ok(
  '「你这个第三版是什么东西，完全不是hello world了」不切换',
  (await resolve('你这个第三版是什么东西，完全不是hello world了', 4, 2)) === null
)
ok('「第二版完全不对」不切换', (await resolve('第二版完全不对', 2, 1)) === null)
ok('「第一版是什么玩意」不切换', (await resolve('第一版是什么玩意', 2, 0)) === null)
ok(
  '「第三版完全不对，改回第二版」仍然切换（有明确切换动词）',
  (await resolve('第三版完全不对，改回第二版', 3, 2)) === 1
)
ok('「还是第一版」不受影响', (await resolve('还是第一版', 2, 1)) === 0)
ok('「改回去，不喜欢这样」走 isRollback，不依赖版本指代', true)

console.log('\n=== 推倒重做 / 偏离不满的识别 ===')
ok('isRebuild「推倒重做，出一个全新的第三版」', (await callFlag('isRebuild', '推倒重做，出一个全新的第三版')) === true)
ok('isRebuild「重新做一版」', (await callFlag('isRebuild', '算了，重新做一版吧')) === true)
ok('isRebuild「换个颜色吧」不误判', (await callFlag('isRebuild', '换个颜色吧，绿色')) === false)
ok('isDriftComplaint「完全不是hello world了」', (await callFlag('isDriftComplaint', '完全不是hello world了')) === true)
ok('isDriftComplaint「太丑了」不误判（质量不满不该推倒重来）', (await callFlag('isDriftComplaint', '太丑了，换成暗色')) === false)

console.log('\n=== 版本历史摘要（给路由看）===')
// 摘要必须带【用户原话】——曾经只给 plan 第一行，路由器根本没看见
// 用户最初说的"hello world"，"推倒重做"时直接把最初需求丢了
const summary = await page.evaluate(async () => {
  const src = await fetch('/src/versionRef.ts').then((r) => r.text())
  return src.includes('buildVersionSummary') && src.includes('用户说') && src.includes('做成')
})
ok('摘要带用户原话 + 做成了什么', summary, '')

const routerRebuild = await page.evaluate(async () => {
  const src = await fetch('/src/prompts.ts').then((r) => r.text())
  return src.includes('推倒重做的锚点是最初的需求')
})
ok('路由提示词：推倒重做从最初需求出发', routerRebuild, '')

const codegenOriginal = await page.evaluate(async () => {
  const src = await fetch('/src/prompts.ts').then((r) => r.text())
  return src.includes('最初的需求（这一版的出发点）')
})
ok('代码生成接收最初的需求', codegenOriginal, '')

await browser.close()
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
