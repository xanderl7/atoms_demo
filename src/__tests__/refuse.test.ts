import { describe, it, expect } from 'vitest'
import { detectRefuse, renderRefuse } from '../refuse'

describe('detectRefuse 页面之外的请求', () => {
  it('搭后端 → backend', () => {
    expect(detectRefuse('帮我搭一个后端服务')).toBe('backend')
  })

  it('写接口 → backend', () => {
    expect(detectRefuse('用 Java 写个接口吧')).toBe('backend')
  })

  it('要数据库 → backend', () => {
    expect(detectRefuse('帮我建一个数据库')).toBe('backend')
  })

  it('真实支付 → capability', () => {
    expect(detectRefuse('对接一个真实的微信支付')).toBe('capability')
  })

  it('真实登录 → capability', () => {
    expect(detectRefuse('我要真实的登录功能')).toBe('capability')
  })

  it('小程序 → non-web', () => {
    expect(detectRefuse('帮我做个微信小程序')).toBe('non-web')
  })

  it('CLI 工具 → non-web', () => {
    expect(detectRefuse('写一个命令行爬虫工具')).toBe('non-web')
  })

  it('正常页面请求不误伤', () => {
    expect(detectRefuse('帮我做一个落地页')).toBeNull()
    expect(detectRefuse('把标题改成红色')).toBeNull()
    expect(detectRefuse('加一个登录按钮的样式')).toBeNull()
    expect(detectRefuse('')).toBeNull()
  })
})

describe('renderRefuse 拒绝话术', () => {
  it('三段结构：明确说不做 + 为什么 + 出路', () => {
    const t = renderRefuse('backend')
    expect(t).toContain('这个我不做')
    expect(t).toContain('为什么')
    expect(t).toContain('我能做的')
    expect(t).toContain('要真后端你得自己来')
  })

  it('明确点名"不做假货"', () => {
    expect(renderRefuse('backend')).toContain('糊弄')
  })
})
