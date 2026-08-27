/// <reference types="@figma/plugin-typings" />
import { describe, expect, it } from 'vitest'
import { commonContainerFrame, frameOffset, nearestFrame } from './connectorEngine'

/**
 * Pure-logic tests for the Prototype-visibility reparenting fix (connectors
 * are page-level by default so they never affect auto-layout, but that also
 * means they never show up in Figma's Prototype presentation, which only
 * renders a frame's own subtree — see CHANGE_REQUESTS.md). Only the two
 * functions that don't touch the live `figma` global are testable this way;
 * the actual reparenting (createOne/render/renderLabel) still needs a real
 * Figma session to verify, like the rest of connectorEngine.ts.
 */

function mockPage(): unknown {
  return { type: 'PAGE' }
}

function mockFrame(
  id: string,
  parent: unknown,
  transform: [[number, number, number], [number, number, number]] = [
    [1, 0, 0],
    [0, 1, 0]
  ]
): FrameNode {
  return { id, type: 'FRAME', parent, absoluteTransform: transform } as unknown as FrameNode
}

function mockNode(id: string, type: string, parent: unknown): SceneNode {
  return { id, type, parent } as unknown as SceneNode
}

describe('commonContainerFrame', () => {
  it('finds the nearest common frame ancestor when both endpoints are its direct children', () => {
    const frame = mockFrame('frame1', mockPage())
    const a = mockNode('a', 'RECTANGLE', frame)
    const b = mockNode('b', 'RECTANGLE', frame)
    expect(commonContainerFrame(a, b)).toBe(frame)
  })

  it('walks up nested groups to find the enclosing frame', () => {
    const frame = mockFrame('frame1', mockPage())
    const groupA = mockNode('groupA', 'GROUP', frame)
    const groupB = mockNode('groupB', 'GROUP', frame)
    const a = mockNode('a', 'RECTANGLE', groupA)
    const b = mockNode('b', 'RECTANGLE', groupB)
    expect(commonContainerFrame(a, b)).toBe(frame)
  })

  it('returns null when endpoints live in different top-level frames', () => {
    const page = mockPage()
    const a = mockNode('a', 'RECTANGLE', mockFrame('frameA', page))
    const b = mockNode('b', 'RECTANGLE', mockFrame('frameB', page))
    expect(commonContainerFrame(a, b)).toBeNull()
  })

  it('returns null when endpoints sit directly on the page', () => {
    const page = mockPage()
    const a = mockNode('a', 'RECTANGLE', page)
    const b = mockNode('b', 'RECTANGLE', page)
    expect(commonContainerFrame(a, b)).toBeNull()
  })

  it('rejects a rotated common frame and falls back to page-level (null)', () => {
    const rotated = mockFrame('rotated', mockPage(), [
      [0.707, -0.707, 0],
      [0.707, 0.707, 0]
    ])
    const a = mockNode('a', 'RECTANGLE', rotated)
    const b = mockNode('b', 'RECTANGLE', rotated)
    expect(commonContainerFrame(a, b)).toBeNull()
  })
})

describe('nearestFrame', () => {
  it('returns the direct parent frame', () => {
    const frame = mockFrame('frame1', mockPage())
    const a = mockNode('a', 'RECTANGLE', frame)
    expect(nearestFrame(a)).toBe(frame)
  })

  it('walks up through a group to the enclosing frame', () => {
    const frame = mockFrame('frame1', mockPage())
    const group = mockNode('group', 'GROUP', frame)
    const a = mockNode('a', 'RECTANGLE', group)
    expect(nearestFrame(a)).toBe(frame)
  })

  it('stops at the FIRST frame going up — does not walk past it to an outer section', () => {
    const section = mockNode('section', 'SECTION', mockPage())
    const outerFrame = mockFrame('outer', section)
    const innerFrame = mockFrame('inner', outerFrame)
    const a = mockNode('a', 'RECTANGLE', innerFrame)
    expect(nearestFrame(a)).toBe(innerFrame)
  })

  it('returns null when there is no enclosing frame at all', () => {
    const section = mockNode('section', 'SECTION', mockPage())
    const a = mockNode('a', 'RECTANGLE', section)
    expect(nearestFrame(a)).toBeNull()
  })
})

describe('frameOffset', () => {
  it('returns the translation for an unrotated, unscaled frame', () => {
    expect(
      frameOffset(
        mockFrame('f', null, [
          [1, 0, 120],
          [0, 1, 340]
        ])
      )
    ).toEqual({ x: 120, y: 340 })
  })

  it('returns null for a rotated frame', () => {
    expect(
      frameOffset(
        mockFrame('f', null, [
          [0, -1, 0],
          [1, 0, 0]
        ])
      )
    ).toBeNull()
  })

  it('returns null for a scaled frame', () => {
    expect(
      frameOffset(
        mockFrame('f', null, [
          [1.5, 0, 0],
          [0, 1.5, 0]
        ])
      )
    ).toBeNull()
  })
})
