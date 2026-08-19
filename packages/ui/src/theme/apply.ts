import { DARK_VARS, LIGHT_VARS } from './palette'
import { THEME_VAR_KEYS, type ResolvedThemeMode, type ThemeVars } from './tokens'

export function varsForMode(mode: ResolvedThemeMode): ThemeVars {
  return mode === 'dark' ? DARK_VARS : LIGHT_VARS
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
