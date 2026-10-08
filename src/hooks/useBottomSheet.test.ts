import { describe, it, expect } from 'vitest'
import { pickSnap, type SnapGeometry } from './useBottomSheet'

const g: SnapGeometry = { full: 0, expanded: 200, collapsed: 500 }

describe('pickSnap', () => {
  it('picks the nearest snap on a slow drag', () => {
    expect(pickSnap(40, 0, g)).toBe('full')
    expect(pickSnap(260, 0, g)).toBe('expanded')
    expect(pickSnap(420, 0, g)).toBe('collapsed')
  })

  it('steps one level in the direction of a fast swipe', () => {
    expect(pickSnap(480, -1, g)).toBe('expanded') // up from near collapsed
    expect(pickSnap(190, -1, g)).toBe('full')
    expect(pickSnap(210, 1, g)).toBe('collapsed') // down from near expanded
  })

  it('stays at the end when swiping past it', () => {
    expect(pickSnap(0, -1, g)).toBe('full')
    expect(pickSnap(500, 1, g)).toBe('collapsed')
  })

  it('merges expanded into full when the content fills the panel', () => {
    const filled: SnapGeometry = { full: 0, expanded: 4, collapsed: 500 }
    expect(pickSnap(300, -1, filled)).toBe('full')
    expect(pickSnap(2, 0, filled)).toBe('full')
  })
})
