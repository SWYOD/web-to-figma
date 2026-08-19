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

/**
 * Реестр тем (портировано из ThemeDef/ThemeVariant Skill-tree, см.
 * docs/design-system.md §7 — реверс решения "нет галереи тем") — без
 * branchColors/font/graph-специфичных полей, которых у этого продукта нет.
 */
export interface ThemeVariant {
  vars: ThemeVars
}

export interface ThemeDef {
  id: string
  name: string
  /** Тёмная или светлая по своей сути (основной vars) — если задан altVariant,
   *  это обратный по яркости вид ЭТОЙ ЖЕ темы, а не отдельная тема в галерее. */
  dark: boolean
  vars: ThemeVars
  /** true у отгруженных с приложением тем — их нельзя удалить, но можно
   *  использовать как основу для кастомной темы в редакторе. */
  builtin?: boolean
  altVariant?: ThemeVariant
}
