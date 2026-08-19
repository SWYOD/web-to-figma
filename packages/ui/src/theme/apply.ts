import { BUILTIN_THEMES, DEFAULT_THEME } from './builtins'
import { THEME_VAR_KEYS, type ResolvedThemeMode, type ThemeDef, type ThemeVars } from './tokens'

export function allThemes(customThemes: ThemeDef[]): ThemeDef[] {
  return [...BUILTIN_THEMES, ...customThemes]
}

/** Находит тему по id среди встроенных и пользовательских; если не нашлась
 *  (например, id из settings.json указывает на удалённую кастомную тему) —
 *  откатывается на DEFAULT_THEME, а не падает/рисует пустоту. */
export function resolveTheme(themeId: string, customThemes: ThemeDef[]): ThemeDef {
  return allThemes(customThemes).find((t) => t.id === themeId) ?? DEFAULT_THEME
}

/**
 * Набор токенов темы для конкретного resolvedMode (light/dark) — портировано
 * из effectiveVariant (Skill-tree), но резолвит по глобальному Light/Dark/System
 * приложения, а не по локальному тумблеру темы (см. docs/design-system.md §7):
 * если тема того же "полюса", что и resolvedMode — отдаём её vars как есть;
 * если противоположного — берём altVariant; если altVariant нет вовсе (тема
 * заведомо однополюсная), остаёмся на единственном, что у неё есть, а не падаем.
 */
export function effectiveVariant(theme: ThemeDef, resolvedMode: ResolvedThemeMode): ThemeVars {
  const wantDark = resolvedMode === 'dark'
  if (theme.dark === wantDark) return theme.vars
  return theme.altVariant?.vars ?? theme.vars
}

/** Применяет тему как inline CSS custom properties на :root — портировано из applyThemeVars (Skill-tree). */
export function applyThemeVars(vars: ThemeVars, root: HTMLElement = document.documentElement): void {
  for (const key of THEME_VAR_KEYS) root.style.setProperty(`--${key}`, vars[key])
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Подписка на смену системной темы; возвращает функцию отписки. */
export function watchSystemPreference(onChange: (dark: boolean) => void): () => void {
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const listener = (e: MediaQueryListEvent): void => onChange(e.matches)
  mql.addEventListener('change', listener)
  return () => mql.removeEventListener('change', listener)
}

function isValidVariantShape(v: unknown): v is { vars: ThemeVars } {
  if (!v || typeof v !== 'object') return false
  const t = v as Record<string, unknown>
  if (!t.vars || typeof t.vars !== 'object') return false
  const vars = t.vars as Record<string, unknown>
  return THEME_VAR_KEYS.every((k) => typeof vars[k] === 'string')
}

/** Грубая, но достаточная проверка формы кастомной темы — портировано из
 *  isValidThemeDef (Skill-tree). У нас нет UI импорта темы из файла (см.
 *  docs/design-system.md §7 — отложено), но settings.json теоретически можно
 *  отредактировать руками/потерять поле при миграции — это защита от
 *  применения мусора вместо кастомной темы, а не только от файлового импорта. */
export function isValidThemeDef(v: unknown): v is ThemeDef {
  if (!v || typeof v !== 'object') return false
  const t = v as Record<string, unknown>
  if (typeof t.id !== 'string' || typeof t.name !== 'string' || typeof t.dark !== 'boolean') return false
  if (!isValidVariantShape({ vars: t.vars })) return false
  if (t.altVariant !== undefined && !isValidVariantShape(t.altVariant)) return false
  return true
}
