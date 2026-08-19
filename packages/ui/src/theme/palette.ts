import type { ThemeVars } from './tokens'

/**
 * Одна семантическая палитра, два инвертированных набора значений — та же
 * техника, что altVariant в Skill-tree (docs/design-system.md §2), но без
 * галереи тем: web-to-figma — рабочий инструмент с фиксированной темой.
 * Акцент (#8b5cf6/#7c4fe0) намеренно совпадает по духу с дефолтной темой
 * Skill-tree (AMOLED/Watch Dogs) — визуальная преемственность "той же экосистемы".
 */
export const DARK_VARS: ThemeVars = {
  bg: '#0a0a0c',
  'bg-panel': '#0a0a0c',
  'bg-canvas': '#08080a',
  surface: '#131316',
  'surface-2': '#1c1c20',
  hover: 'rgba(255, 255, 255, 0.06)',
  border: 'rgba(255, 255, 255, 0.09)',
  'border-strong': 'rgba(255, 255, 255, 0.16)',
  text: '#eceef2',
  'text-dim': '#90939c',
  'text-faint': '#5a5d66',
  accent: '#8b5cf6',
  'accent-soft': 'rgba(139, 92, 246, 0.18)',
  'accent-text': '#0a0410',
  danger: '#f4676b',
  warning: '#f5a623',
  info: '#4ea1f2',
  success: '#34c98e',
  shadow: '0 6px 20px rgba(0, 0, 0, 0.55)'
}

export const LIGHT_VARS: ThemeVars = {
  bg: '#f5f6f8',
  'bg-panel': '#fbfbfd',
  'bg-canvas': '#eef0f4',
  surface: '#ffffff',
  'surface-2': '#f2f3f6',
  hover: 'rgba(0, 0, 0, 0.04)',
  border: 'rgba(15, 25, 45, 0.09)',
  'border-strong': 'rgba(15, 25, 45, 0.17)',
  text: '#16181d',
  'text-dim': '#5b5f6a',
  'text-faint': '#9498a3',
  accent: '#7c4fe0',
  'accent-soft': 'rgba(124, 79, 224, 0.12)',
  'accent-text': '#ffffff',
  danger: '#d8453f',
  warning: '#b5740a',
  info: '#1f7fd4',
  success: '#0d9467',
  shadow: '0 4px 16px rgba(20, 30, 50, 0.08)'
}
