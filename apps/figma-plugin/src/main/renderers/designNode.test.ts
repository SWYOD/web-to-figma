/// <reference types="@figma/plugin-typings" />
import { describe, expect, it, vi } from 'vitest'
import type { DesignNode } from '@web-to-figma/design-ast'
import { renderDesignNode } from './designNode'

/**
 * Component recognition (см. componentGroups.ts в conversion-engine) требует
 * `figma.createComponentFromNode`/`ComponentNode.createInstance` — API,
 * которого раньше в этом плагине нигде не касались (designNode.ts до этой
 * фичи вообще не имел тестов, см. план фичи). Полного мока Figma API нет
 * нигде в проекте (см. styleMatching.test.ts — узкий ad hoc стаб под
 * конкретный тест, не общий setup) — здесь то же самое, но заметно шире:
 * минимальный, но РАБОЧИЙ стаб именно того среза API, который трогает
 * buildFrame/appendComponentGroup/applyInstanceOverrides, с реальным
 * clone-подобным поведением createInstance (Figma-инстанс зеркалит детей
 * компонента 1:1 — на этом строится path-резолвинг override'ов).
 */

interface StubNode {
  type: string
  name: string
  width: number
  height: number
  x: number
  y: number
  rotation: number
  opacity: number
  fills: unknown[]
  strokes: unknown[]
  effects: unknown[]
  children: StubNode[]
  layoutMode: string
  layoutPositioning?: string
  layoutSizingHorizontal?: string
  layoutSizingVertical?: string
  clipsContent?: boolean
  characters?: string
  fontName?: { family: string; style: string }
  mainComponent?: StubNode
  textAutoResize?: string
  resizeCalls: Array<{ width: number; height: number }>
  resize(w: number, h: number): void
  appendChild(child: StubNode): void
}

function makeStubNode(type: string): StubNode {
  return {
    type,
    name: '',
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    fills: [],
    strokes: [],
    effects: [],
    children: [],
    layoutMode: 'NONE',
    layoutSizingHorizontal: undefined,
    layoutSizingVertical: undefined,
    resizeCalls: [],
    resize(w, h) {
      this.resizeCalls.push({ width: w, height: h })
      this.width = w
      this.height = h
    },
    appendChild(child) {
      this.children.push(child)
    }
  }
}

/** Клон структуры (не ссылка) — как реальный Figma createInstance(), детям
 *  нужны СВОИ объекты, чтобы override на инстансе не задевал main. */
function cloneStub(node: StubNode): StubNode {
  const clone = makeStubNode(node.type)
  Object.assign(clone, node, { children: node.children.map(cloneStub) })
  return clone
}

function installFigmaStub(): void {
  const stub = {
    mixed: Symbol('figma.mixed'),
    createFrame: () => makeStubNode('FRAME'),
    createText: () => makeStubNode('TEXT'),
    loadFontAsync: vi.fn().mockResolvedValue(undefined),
    createComponentFromNode: (node: StubNode) => {
      node.type = 'COMPONENT'
      return node
    },
    notify: vi.fn()
  }
  // createInstance живёт на самой ноде-компоненте, как в реальном API.
  const originalCreateComponentFromNode = stub.createComponentFromNode
  stub.createComponentFromNode = (node: StubNode) => {
    const component = originalCreateComponentFromNode(node)
    ;(component as StubNode & { createInstance: () => StubNode }).createInstance = () => {
      const instance = cloneStub(component)
      instance.type = 'INSTANCE'
      instance.mainComponent = component
      return instance
    }
    return component
  }
  // @ts-expect-error -- minimal global figma stub for this test file only
  globalThis.figma = stub
}

function baseNode(overrides: Partial<DesignNode> = {}): DesignNode {
  return {
    id: overrides.id ?? 'n1',
    type: 'frame',
    name: overrides.name ?? 'node',
    size: { width: 100, height: 40 },
    ...overrides
  }
}

describe('designNode: explicit component creation only', () => {
  it('ignores legacy nested componentRef metadata during an ordinary frame import', async () => {
    installFigmaStub()

    const card = (title: string, groupRole: 'main' | 'instance', overrides?: { text?: Record<string, string> }): DesignNode =>
      baseNode({
        id: `card-${title}`,
        name: 'card',
        size: { width: 100, height: 40 },
        componentRef: { groupId: 'g1', role: groupRole, ...(overrides ? { overrides } : {}) },
        children: [baseNode({ id: `title-${title}`, type: 'text', name: title, text: title, size: { width: 80, height: 20 } })]
      })

    const root = baseNode({
      id: 'root',
      name: 'row',
      size: { width: 220, height: 40 },
      layout: { mode: 'horizontal', positioning: 'auto' },
      children: [
        card('Alpha', 'main'),
        card('Beta', 'instance', { text: { '0': 'Beta' } })
      ]
    })

    const result = ((await renderDesignNode(root, {})).primary as unknown) as StubNode
    expect(result.children).toHaveLength(2)

    const [firstNode, secondNode] = result.children
    expect(firstNode!.type).toBe('FRAME')
    expect(secondNode!.type).toBe('FRAME')
    expect(firstNode!.children[0]!.characters).toBe('Alpha')
    expect(secondNode!.children[0]!.characters).toBe('Beta')
  })

  it('leaves children without componentRef untouched (no grouping, plain frames as before)', async () => {
    installFigmaStub()
    const root = baseNode({
      id: 'root',
      name: 'row',
      size: { width: 220, height: 40 },
      layout: { mode: 'horizontal', positioning: 'auto' },
      children: [baseNode({ id: 'c1', name: 'a', size: { width: 100, height: 40 } }), baseNode({ id: 'c2', name: 'b', size: { width: 100, height: 40 } })]
    })
    const result = ((await renderDesignNode(root, {})).primary as unknown) as StubNode
    expect(result.children.map((c) => c.type)).toEqual(['FRAME', 'FRAME'])
  })
})

describe('designNode: text sizing inside Auto Layout', () => {
  it('does not overwrite nowrap HUG text with the captured glyph-box after appendChild', async () => {
    installFigmaStub()
    const root = baseNode({
      id: 'icon',
      name: 'icon',
      size: { width: 64, height: 64 },
      layout: { mode: 'vertical', align: 'center', justify: 'center', positioning: 'auto' },
      children: [
        baseNode({
          id: 'icon-label',
          type: 'text',
          name: '45',
          text: '45',
          textWrap: 'nowrap',
          size: { width: 29, height: 29 },
          layout: { mode: 'none', widthSizing: 'hug', heightSizing: 'hug', positioning: 'auto' }
        })
      ]
    })

    const result = ((await renderDesignNode(root, {})).primary as unknown) as StubNode
    const label = result.children[0]!
    expect(label.textAutoResize).toBe('WIDTH_AND_HEIGHT')
    expect(label.layoutSizingHorizontal).toBe('HUG')
    expect(label.layoutSizingVertical).toBe('HUG')
    expect(label.resizeCalls).toEqual([])
  })

  it('restores a visual frame browser box even when its Auto Layout sizing is HUG', async () => {
    installFigmaStub()
    const root = baseNode({
      id: 'actions',
      name: 'actions',
      size: { width: 734, height: 87 },
      layout: { mode: 'horizontal', positioning: 'auto' },
      children: [
        baseNode({
          id: 'button',
          name: 'button',
          size: { width: 191, height: 52 },
          layout: { mode: 'horizontal', widthSizing: 'hug', heightSizing: 'hug', positioning: 'auto' }
        })
      ]
    })

    const result = ((await renderDesignNode(root, {})).primary as unknown) as StubNode
    const button = result.children[0]!
    expect(button.resizeCalls.at(-1)).toEqual({ width: 191, height: 52 })
    expect(button.width).toBe(191)
    expect(button.height).toBe(52)
  })
})

describe('designNode: Import as Component (as parameter)', () => {
  it('promotes the root to a Component when as="component"', async () => {
    installFigmaStub()
    const root = baseNode({ id: 'root', name: 'card', size: { width: 100, height: 40 } })
    const { primary, secondary } = await renderDesignNode(root, {}, false, false, 'style', 'component')
    expect((primary as unknown as StubNode).type).toBe('COMPONENT')
    expect(secondary).toBeUndefined()
  })

  it('also creates one Instance next to the Component when alsoCreateInstance is true', async () => {
    installFigmaStub()
    const root = baseNode({ id: 'root', name: 'card', size: { width: 100, height: 40 } })
    const { primary, secondary } = await renderDesignNode(root, {}, false, false, 'style', 'component', true)
    expect((primary as unknown as StubNode).type).toBe('COMPONENT')
    expect((secondary as unknown as StubNode).type).toBe('INSTANCE')
    expect((secondary as unknown as StubNode).mainComponent).toBe(primary)
  })

  it('defaults to a plain Frame when as is "frame"', async () => {
    installFigmaStub()
    const root = baseNode({ id: 'root', name: 'card', size: { width: 100, height: 40 } })
    const { primary, secondary } = await renderDesignNode(root, {})
    expect((primary as unknown as StubNode).type).toBe('FRAME')
    expect(secondary).toBeUndefined()
  })
})
