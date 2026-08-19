import { DARK_VARS, LIGHT_VARS } from './palette'
import type { ThemeDef } from './tokens'

/**
 * Реестр встроенных тем — реверс решения "нет галереи тем" (см.
 * docs/design-system.md §7): изначально была одна жёстко зашитая пара
 * DARK_VARS/LIGHT_VARS (palette.ts), теперь это первая запись реестра
 * ('default'), плюс несколько тем, портированных из Skill-tree
 * (src/renderer/src/themes/builtins.ts), ремаппленных под ThemeVars этого
 * приложения:
 *  - `bg-graph` (нет графа в этом продукте) → `bg-canvas` (фон браузерной области, тот же смысл "холста");
 *  - `branchColors`/`font` отброшены целиком — нерелевантны (нет веток/кастомных шрифтов);
 *  - `warning`/`info`/`success` — этих токенов не было у Skill-tree (не диагностический
 *    инструмент), поэтому у каждой темы они НЕ куплены "по вкусу", а взяты из одной
 *    общей пары DIAG_DARK/DIAG_LIGHT — это цвета северности диагностики
 *    (Import Quality), не брендовые цвета темы, так что не должны прыгать при
 *    смене темы ради консистентности сообщений об ошибках/предупреждениях.
 * Портированы только темы, однозначно уместные для инструмента разработчика
 * (GitHub Dark, Dracula, Linear, Discord) — остальные палитры Skill-tree
 * (Synthwave, Nuxt UI, Claude Desktop) сознательно не портированы (см. §7).
 */

const DIAG_DARK = { warning: DARK_VARS.warning, info: DARK_VARS.info, success: DARK_VARS.success }
const DIAG_LIGHT = { warning: LIGHT_VARS.warning, info: LIGHT_VARS.info, success: LIGHT_VARS.success }

export const DEFAULT_THEME: ThemeDef = {
  id: 'default',
  name: 'Web To Figma',
  dark: true,
  builtin: true,
  vars: DARK_VARS,
  altVariant: { vars: LIGHT_VARS }
}

const GITHUB_DARK: ThemeDef = {
  id: 'github-dark',
  name: 'GitHub Dark',
  dark: true,
  builtin: true,
  vars: {
    bg: '#0d1117',
    'bg-panel': '#010409',
    'bg-canvas': '#0d1117',
    surface: '#161b22',
    'surface-2': '#21262d',
    hover: 'rgba(177, 186, 196, 0.08)',
    border: 'rgba(240, 246, 252, 0.1)',
    'border-strong': 'rgba(240, 246, 252, 0.18)',
    text: '#e6edf3',
    'text-dim': '#7d8590',
    'text-faint': '#6e7681',
    accent: '#2f81f7',
    'accent-soft': 'rgba(47, 129, 247, 0.18)',
    'accent-text': '#0a0410',
    danger: '#f85149',
    shadow: '0 6px 20px rgba(1, 4, 9, 0.6)',
    ...DIAG_DARK
  },
  altVariant: {
    vars: {
      bg: '#ffffff',
      'bg-panel': '#f6f8fa',
      'bg-canvas': '#ffffff',
      surface: '#ffffff',
      'surface-2': '#f6f8fa',
      hover: 'rgba(208, 215, 222, 0.32)',
      border: 'rgba(31, 35, 40, 0.1)',
      'border-strong': 'rgba(31, 35, 40, 0.18)',
      text: '#1f2328',
      'text-dim': '#59636e',
      'text-faint': '#8b949e',
      accent: '#0969da',
      'accent-soft': 'rgba(9, 105, 218, 0.12)',
      'accent-text': '#ffffff',
      danger: '#d1242f',
      shadow: '0 4px 16px rgba(31, 35, 40, 0.08)',
      ...DIAG_LIGHT
    }
  }
}

const DRACULA: ThemeDef = {
  id: 'dracula',
  name: 'Dracula',
  dark: true,
  builtin: true,
  vars: {
    bg: '#282a36',
    'bg-panel': '#282a36',
    'bg-canvas': '#21222c',
    surface: '#343746',
    'surface-2': '#44475a',
    hover: 'rgba(255, 255, 255, 0.06)',
    border: 'rgba(255, 255, 255, 0.08)',
    'border-strong': 'rgba(255, 255, 255, 0.16)',
    text: '#f8f8f2',
    'text-dim': '#a9abb8',
    'text-faint': '#6272a4',
    accent: '#bd93f9',
    'accent-soft': 'rgba(189, 147, 249, 0.18)',
    'accent-text': '#0a0410',
    danger: '#ff5555',
    shadow: '0 6px 20px rgba(0, 0, 0, 0.55)',
    ...DIAG_DARK
  },
  altVariant: {
    vars: {
      bg: '#f8f8f2',
      'bg-panel': '#ffffff',
      'bg-canvas': '#f1f1ec',
      surface: '#ffffff',
      'surface-2': '#eeeef5',
      hover: 'rgba(98, 114, 164, 0.08)',
      border: 'rgba(40, 42, 54, 0.1)',
      'border-strong': 'rgba(40, 42, 54, 0.18)',
      text: '#282a36',
      'text-dim': '#4d4f6b',
      'text-faint': '#8890b5',
      accent: '#8c4fe0',
      'accent-soft': 'rgba(140, 79, 224, 0.14)',
      'accent-text': '#ffffff',
      danger: '#e5484d',
      shadow: '0 4px 16px rgba(40, 42, 54, 0.08)',
      ...DIAG_LIGHT
    }
  }
}

const LINEAR: ThemeDef = {
  id: 'linear',
  name: 'Linear',
  dark: true,
  builtin: true,
  vars: {
    bg: '#08090a',
    'bg-panel': '#08090a',
    'bg-canvas': '#0a0b0c',
    surface: '#141516',
    'surface-2': '#1c1d1f',
    hover: 'rgba(255, 255, 255, 0.05)',
    border: 'rgba(255, 255, 255, 0.06)',
    'border-strong': 'rgba(255, 255, 255, 0.13)',
    text: '#f7f8f8',
    'text-dim': '#8a8f98',
    'text-faint': '#62666d',
    accent: '#5e6ad2',
    'accent-soft': 'rgba(94, 106, 210, 0.18)',
    'accent-text': '#0a0410',
    danger: '#eb5757',
    shadow: '0 6px 24px rgba(0, 0, 0, 0.55)',
    ...DIAG_DARK
  },
  altVariant: {
    vars: {
      bg: '#fbfbfb',
      'bg-panel': '#ffffff',
      'bg-canvas': '#f6f6f7',
      surface: '#ffffff',
      'surface-2': '#f2f2f3',
      hover: 'rgba(0, 0, 0, 0.04)',
      border: 'rgba(0, 0, 0, 0.08)',
      'border-strong': 'rgba(0, 0, 0, 0.14)',
      text: '#1a1a1c',
      'text-dim': '#63666d',
      'text-faint': '#9a9ca3',
      accent: '#5e6ad2',
      'accent-soft': 'rgba(94, 106, 210, 0.12)',
      'accent-text': '#ffffff',
      danger: '#eb5757',
      shadow: '0 4px 16px rgba(20, 20, 25, 0.08)',
      ...DIAG_LIGHT
    }
  }
}

const DISCORD: ThemeDef = {
  id: 'discord',
  name: 'Discord',
  dark: true,
  builtin: true,
  vars: {
    bg: '#313338',
    'bg-panel': '#2b2d31',
    'bg-canvas': '#1e1f22',
    surface: '#2b2d31',
    'surface-2': '#1e1f22',
    hover: 'rgba(78, 80, 88, 0.35)',
    border: 'rgba(255, 255, 255, 0.06)',
    'border-strong': 'rgba(255, 255, 255, 0.13)',
    text: '#f2f3f5',
    'text-dim': '#b5bac1',
    'text-faint': '#6d6f78',
    accent: '#5865f2',
    'accent-soft': 'rgba(88, 101, 242, 0.2)',
    'accent-text': '#0a0410',
    danger: '#ed4245',
    shadow: '0 6px 20px rgba(0, 0, 0, 0.5)',
    ...DIAG_DARK
  },
  altVariant: {
    vars: {
      bg: '#ffffff',
      'bg-panel': '#f2f3f5',
      'bg-canvas': '#ffffff',
      surface: '#f2f3f5',
      'surface-2': '#e3e5e8',
      hover: 'rgba(6, 6, 7, 0.04)',
      border: 'rgba(6, 6, 7, 0.08)',
      'border-strong': 'rgba(6, 6, 7, 0.16)',
      text: '#060607',
      'text-dim': '#5c5e66',
      'text-faint': '#949ba4',
      accent: '#5865f2',
      'accent-soft': 'rgba(88, 101, 242, 0.12)',
      'accent-text': '#ffffff',
      danger: '#da373c',
      shadow: '0 4px 16px rgba(6, 6, 7, 0.08)',
      ...DIAG_LIGHT
    }
  }
}

export const BUILTIN_THEMES: ThemeDef[] = [DEFAULT_THEME, GITHUB_DARK, DRACULA, LINEAR, DISCORD]

export const DEFAULT_THEME_ID = 'default'
