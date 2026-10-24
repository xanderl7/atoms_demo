import { describe, it, expect } from 'vitest'
import { detectUnsupported, renderUnsupported } from '../unsupported'

describe('detectUnsupported 收不到文件的请求', () => {
  it('换成真实作品 → upload', () => {
    expect(detectUnsupported('帮我把作品换成真实作品')).toBe('upload')
  })

  it('用我的照片 → upload', () => {
    expect(detectUnsupported('用我的照片')).toBe('upload')
  })

  it('上传简历 → upload', () => {
    expect(detectUnsupported('上传我的简历')).toBe('upload')
  })

  it('把头像换成我自己的 → upload', () => {
    expect(detectUnsupported('把这个头像换成我自己的')).toBe('upload')
  })

  it('「作品集」是页面类型不是素材，不误伤', () => {
    expect(detectUnsupported('我想做个作品集展示页')).toBeNull()
  })

  it('改文字类请求不误伤', () => {
    expect(detectUnsupported('把作品标题换成我的名字')).toBeNull()
    expect(detectUnsupported('换个颜色')).toBeNull()
    expect(detectUnsupported('')).toBeNull()
  })
})

describe('renderUnsupported 引导话术', () => {
  const code = `<img src="https://picsum.photos/seed/a/800/600" data-placeholder="img">
<span data-placeholder="text">作品标题 1</span>`

  it('说清楚做不到 + 不编造', () => {
    const t = renderUnsupported('upload', code)
    expect(t).toContain('没有上传入口')
    expect(t).toContain('不会给你编一批假的')
  })

  it('改哪几处是从代码里扫出来的', () => {
    const t = renderUnsupported('upload', code)
    expect(t).toContain('占位')
    expect(t).toContain('data-placeholder="text"')
  })
})
