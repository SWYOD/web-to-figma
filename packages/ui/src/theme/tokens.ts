/**
 * Токены темы — портировано из ThemeVars Skill-tree (src/renderer/src/theme.ts
 * / themes/apply.ts), без branchColors/кастомных тем — см. docs/design-system.md §2, §7.
 */
export interface ThemeVars {
  bg: string
  'bg-panel': string
  'bg-canvas': string
  surface: string
  'surface-2': string
  hover: string
  border: string
  'border-strong': string
  text: string
  'text-dim': string
  'text-faint': string
  accent: string
  'accent-soft': string
  'accent-text': string
  danger: string
  warning: string
  info: string
  success: string
  shadow: string
}

export const THEME_VAR_KEYS: (keyof ThemeVars)[] = [
  'bg',
  'bg-panel',
  'bg-canvas',
  'surface',
  'surface-2',
  'hover',
  'border',
  'border-strong',
  'text',
  'text-dim',
  'text-faint',
  'accent',
  'accent-soft',
  'accent-text',
  'danger',
  'warning',
  'info',
  'success',
  'shadow'
]

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedThemeMode = 'light' | 'dark'
