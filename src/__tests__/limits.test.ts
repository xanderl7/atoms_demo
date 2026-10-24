import { describe, it, expect } from 'vitest'
import { describeLimits, renderLimits } from '../limits'

describe('describeLimits 边界扫描', () => {
  it('扫出占位图 / 占位文案 / 表单 / 示例邮箱', () => {
    const code = `
      <img src="https://picsum.photos/seed/a/800/600" data-placeholder="img">
      <img src="https://picsum.photos/seed/b/800/600" data-placeholder="img">
      <span data-placeholder="text">作品标题 1</span>
      <form><input name="email"></form>
      <a href="mailto:hi@example.com">联系我</a>
      <script>const ITEMS = [{title:'x'}];</script>
    `
    const n = describeLimits(code)
    expect(n).not.toBeNull()
    expect(n!.faked.length).toBeGreaterThanOrEqual(3)
    expect(n!.faked.join()).toContain('占位图')
    expect(n!.faked.join()).toContain('表单')
    expect(n!.next.join()).toContain('ITEMS')
  })

  it('干净的代码返回 null', () => {
    const code = '<!doctype html><html><body><h1>你好</h1><p>真实内容</p></body></html>'
    expect(describeLimits(code)).toBeNull()
  })
})

describe('renderLimits 渲染', () => {
  it('包含「我做了什么 / 没做什么 / 你怎么改」三段', () => {
    const code = '<img src="https://picsum.photos/seed/a/800/600" data-placeholder="img">'
    const n = describeLimits(code)!
    const t = renderLimits(n)
    expect(t).toContain('我没做到')
    expect(t).toContain('我已经做好的')
    expect(t).toContain('你后续接手改这几处')
  })
})
