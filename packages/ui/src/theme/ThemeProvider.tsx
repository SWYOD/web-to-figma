import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyThemeVars, systemPrefersDark, varsForMode, watchSystemPreference } from './apply'
import type { ResolvedThemeMode, ThemeMode } from './tokens'

interface ThemeContextValue {
  mode: ThemeMode
  resolvedMode: ResolvedThemeMode
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export interface ThemeProviderProps {
  children: ReactNode
  /** Текущий режим (Light/Dark/System). */
  mode: ThemeMode
  /** Вызывается при смене режима пользователем (desktop — сохраняет в settings.json). */
  onModeChange: (mode: ThemeMode) => void
}

/** Портировано из App.tsx Skill-tree (applyThemeVars в useEffect), расширено System через matchMedia. */
export function ThemeProvider({ children, mode, onModeChange }: ThemeProviderProps): JSX.Element {
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark())

  useEffect(() => watchSystemPreference(setSystemDark), [])

  const resolvedMode: ResolvedThemeMode = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  useEffect(() => {
    applyThemeVars(varsForMode(resolvedMode))
  }, [resolvedMode])

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolvedMode, setMode: onModeChange }),
    [mode, resolvedMode, onModeChange]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme() must be used within <ThemeProvider>')
  return ctx
}
