import { describe, it, expect } from 'vitest'
import { isRollback, resolveVersionRef, buildVersionSummary } from '../versionRef'

describe('isRollback 回退意图', () => {
  it('命中回退词', () => {
    expect(isRollback('改回去')).toBe(true)
    expect(isRollback('撤销这个修改')).toBe(true)
    expect(isRollback('回到上一版')).toBe(true)
  })

  it('普通修改不是回退', () => {
    expect(isRollback('把主色改成绿色')).toBe(false)
    expect(isRollback('改成第二版')).toBe(false) // 这是版本指代，不是回退
  })
})

describe('resolveVersionRef 版本指代', () => {
  it('「改成第二版」→ 下标 1', () => {
    expect(resolveVersionRef('改成第二版', 3, 0)).toBe(1)
    expect(resolveVersionRef('改回第2版', 3, 0)).toBe(1)
    expect(resolveVersionRef('回到第 2 版', 3, 0)).toBe(1)
    expect(resolveVersionRef('换成第2版那个', 3, 0)).toBe(1)
  })

  it('中文数字和阿拉伯数字都认', () => {
    expect(resolveVersionRef('改成第三版', 3, 0)).toBe(2)
    expect(resolveVersionRef('改成第3版', 3, 0)).toBe(2)
  })

  it('「改过来吧」= 回到刚才离开的下一版', () => {
    expect(resolveVersionRef('改过来吧', 3, 0)).toBe(1)
    expect(resolveVersionRef('刚才那版', 3, 1)).toBe(2)
  })

  it('上一版/下一版', () => {
    expect(resolveVersionRef('上一版', 3, 1)).toBe(0)
    expect(resolveVersionRef('下一版', 3, 1)).toBe(2)
    expect(resolveVersionRef('上一版', 3, 0)).toBeNull() // 已经在第一版
    expect(resolveVersionRef('下一版', 3, 2)).toBeNull() // 已经在最后
  })

  it('只有一版时任何指代都不触发', () => {
    expect(resolveVersionRef('改成第二版', 1, 0)).toBeNull()
  })

  it('越界指代不触发', () => {
    expect(resolveVersionRef('改成第九版', 3, 0)).toBeNull()
  })

  it('「改成蓝色」不是版本指代', () => {
    expect(resolveVersionRef('把主色改成蓝色', 3, 0)).toBeNull()
  })
})

describe('buildVersionSummary 版本历史摘要', () => {
  const versions = [
    { prompt: '做一个咖啡店页面', plan: '- 顶部店名\n- 菜单卡片' },
    { prompt: '改成绿色主题', plan: '- 主色改绿' },
  ]

  it('只有一版时给空串（不浪费路由 token）', () => {
    expect(buildVersionSummary([versions[0]], 0)).toBe('')
  })

  it('多版时列出每版第一行并标注当前', () => {
    const s = buildVersionSummary(versions, 1)
    expect(s).toContain('共 2 版')
    expect(s).toContain('当前停在第 2 版')
    expect(s).toContain('第 1 版：顶部店名')
    expect(s).toContain('第 2 版：主色改绿')
    expect(s).toContain('← 当前')
  })
})
