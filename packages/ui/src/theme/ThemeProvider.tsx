import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyThemeVars, effectiveVariant, resolveTheme, systemPrefersDark, watchSystemPreference } from './apply'
import { DEFAULT_THEME_ID } from './builtins'
import type { ResolvedThemeMode, ThemeDef, ThemeMode } from './tokens'

interface ThemeContextValue {
  mode: ThemeMode
  resolvedMode: ResolvedThemeMode
  setMode: (mode: ThemeMode) => void
  /** Активная тема (встроенная или кастомная), уже разрешённая из themeId. */
  theme: ThemeDef
  themeId: string
  customThemes: ThemeDef[]
  setThemeId: (themeId: string) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export interface ThemeProviderProps {
  children: ReactNode
  /** Текущий режим (Light/Dark/System). */
  mode: ThemeMode
  /** Вызывается при смене режима пользователем (desktop — сохраняет в settings.json). */
  onModeChange: (mode: ThemeMode) => void
  /** id активной темы — встроенной или из customThemes. Необязателен: потребители
   *  пакета без галереи тем (figma-plugin UI) просто получают тему 'default'. */
  themeId?: string
  customThemes?: ThemeDef[]
  onThemeIdChange?: (themeId: string) => void
}

/** Портировано из App.tsx Skill-tree (applyThemeVars в useEffect), расширено
 *  System через matchMedia и реестром тем (themeId/customThemes) — см.
 *  docs/design-system.md §7. */
export function ThemeProvider({
  children,
  mode,
  onModeChange,
  themeId = DEFAULT_THEME_ID,
  customThemes = [],
  onThemeIdChange
}: ThemeProviderProps): JSX.Element {
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark())

  useEffect(() => watchSystemPreference(setSystemDark), [])

  const resolvedMode: ResolvedThemeMode = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
  const theme = resolveTheme(themeId, customThemes)

  useEffect(() => {
    applyThemeVars(effectiveVariant(theme, resolvedMode))
  }, [theme, resolvedMode])

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolvedMode,
      setMode: onModeChange,
      theme,
      themeId: theme.id,
      customThemes,
      setThemeId: onThemeIdChange ?? (() => {})
    }),
    [mode, resolvedMode, onModeChange, theme, customThemes, onThemeIdChange]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme() must be used within <ThemeProvider>')
  return ctx
}
