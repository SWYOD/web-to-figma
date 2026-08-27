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

/**
 * Портировано из Design Toolkit (`resources/themes/*.json`) — см. PROJECT_MEMORY.md
 * "2026-08-27 icon follow-up" / общая унификация каталога тем между продуктами
 * (пользователь: "возьми самое лучшее из обоих и обнови обе"). Design Toolkit
 * хранит эти темы как отдельные JSON-файлы с собственной формой (radius/font
 * общие для всех тем этого продукта, а не за темой), здесь они ремаплены на
 * ThemeVars этого пакета так же, как GITHUB_DARK/DRACULA/LINEAR/DISCORD выше.
 */
const AMOLED: ThemeDef = {
  id: 'amoled',
  name: 'AMOLED',
  dark: true,
  builtin: true,
  vars: {
    bg: '#000000',
    'bg-panel': '#000000',
    'bg-canvas': '#000000',
    surface: '#0b0b0d',
    'surface-2': '#141416',
    hover: 'rgba(255, 255, 255, 0.055)',
    border: 'rgba(255, 255, 255, 0.09)',
    'border-strong': 'rgba(255, 255, 255, 0.16)',
    text: '#eceef2',
    'text-dim': '#8b8f98',
    'text-faint': '#5c5f68',
    accent: '#8b5cf6',
    'accent-soft': 'rgba(139, 92, 246, 0.18)',
    'accent-text': '#0a0410',
    danger: '#f4676b',
    shadow: '0 6px 20px rgba(0, 0, 0, 0.6)',
    ...DIAG_DARK
  },
  altVariant: {
    vars: {
      bg: '#f4f6fa',
      'bg-panel': '#fbfcfe',
      'bg-canvas': '#f4f6fa',
      surface: '#ffffff',
      'surface-2': '#f5f7fb',
      hover: 'rgba(0, 0, 0, 0.035)',
      border: 'rgba(15, 25, 45, 0.08)',
      'border-strong': 'rgba(15, 25, 45, 0.16)',
      text: '#16202e',
      'text-dim': '#5b6675',
      'text-faint': '#8b96a5',
      accent: '#7c4fe0',
      'accent-soft': 'rgba(124, 79, 224, 0.12)',
      'accent-text': '#ffffff',
      danger: '#d8453f',
      shadow: '0 4px 16px rgba(20, 30, 50, 0.08)',
      ...DIAG_LIGHT
    }
  }
}

const CLAUDE_DESKTOP: ThemeDef = {
  id: 'claude-desktop',
  name: 'Claude Desktop',
  dark: true,
  builtin: true,
  vars: {
    bg: '#262624',
    'bg-panel': '#262624',
    'bg-canvas': '#262624',
    surface: '#30302e',
    'surface-2': '#3a3936',
    hover: 'rgba(255, 255, 255, 0.06)',
    border: 'rgba(255, 255, 255, 0.08)',
    'border-strong': 'rgba(255, 255, 255, 0.15)',
    text: '#f2f0ed',
    'text-dim': '#a8a29a',
    'text-faint': '#7d786f',
    accent: '#c96442',
    'accent-soft': 'rgba(201, 100, 66, 0.18)',
    'accent-text': '#0a0410',
    danger: '#f4676b',
    shadow: '0 6px 20px rgba(0, 0, 0, 0.5)',
    ...DIAG_DARK
  },
  altVariant: {
    vars: {
      bg: '#faf9f5',
      'bg-panel': '#ffffff',
      'bg-canvas': '#faf9f5',
      surface: '#ffffff',
      'surface-2': '#f0eee6',
      hover: 'rgba(30, 30, 28, 0.045)',
      border: 'rgba(30, 30, 28, 0.1)',
      'border-strong': 'rgba(30, 30, 28, 0.18)',
      text: '#3d3d3a',
      'text-dim': '#6b6862',
      'text-faint': '#9c988e',
      accent: '#c96442',
      'accent-soft': 'rgba(201, 100, 66, 0.12)',
      'accent-text': '#0a0410',
      danger: '#d8453f',
      shadow: '0 4px 16px rgba(30, 30, 28, 0.08)',
      ...DIAG_LIGHT
    }
  }
}

const NUXT: ThemeDef = {
  id: 'nuxt',
  name: 'Nuxt UI',
  dark: true,
  builtin: true,
  vars: {
    bg: '#020617',
    'bg-panel': '#020617',
    'bg-canvas': '#020617',
    surface: '#0f172a',
    'surface-2': '#1e293b',
    hover: 'rgba(255, 255, 255, 0.05)',
    border: 'rgba(255, 255, 255, 0.08)',
    'border-strong': 'rgba(255, 255, 255, 0.15)',
    text: '#f1f5f9',
    'text-dim': '#94a3b8',
    'text-faint': '#64748b',
    accent: '#00dc82',
    'accent-soft': 'rgba(0, 220, 130, 0.18)',
    'accent-text': '#0a0410',
    danger: '#f4676b',
    shadow: '0 6px 20px rgba(0, 0, 0, 0.55)',
    ...DIAG_DARK
  },
  altVariant: {
    vars: {
      bg: '#f0fdf6',
      'bg-panel': '#f7fefb',
      'bg-canvas': '#f0fdf6',
      surface: '#ffffff',
      'surface-2': '#e6f9ee',
      hover: 'rgba(0, 168, 107, 0.06)',
      border: 'rgba(4, 120, 87, 0.12)',
      'border-strong': 'rgba(4, 120, 87, 0.2)',
      text: '#052e1c',
      'text-dim': '#3f7259',
      'text-faint': '#6b9c85',
      accent: '#059669',
      'accent-soft': 'rgba(5, 150, 105, 0.12)',
      'accent-text': '#0a0410',
      danger: '#d8453f',
      shadow: '0 4px 16px rgba(4, 120, 87, 0.08)',
      ...DIAG_LIGHT
    }
  }
}

const SYNTHWAVE: ThemeDef = {
  id: 'synthwave',
  name: 'Synthwave',
  dark: true,
  builtin: true,
  vars: {
    bg: '#0a0212',
    'bg-panel': '#0a0212',
    'bg-canvas': '#0a0212',
    surface: '#140a1f',
    'surface-2': '#1d1030',
    hover: 'rgba(255, 255, 255, 0.05)',
    border: 'rgba(255, 255, 255, 0.09)',
    'border-strong': 'rgba(255, 255, 255, 0.16)',
    text: '#f3e8ff',
    'text-dim': '#b39ddb',
    'text-faint': '#7e6ba0',
    accent: '#ec4899',
    'accent-soft': 'rgba(236, 72, 153, 0.18)',
    'accent-text': '#0a0410',
    danger: '#f4676b',
    shadow: '0 6px 20px rgba(0, 0, 0, 0.6)',
    ...DIAG_DARK
  },
  altVariant: {
    vars: {
      bg: '#fdf4fb',
      'bg-panel': '#fdf7fc',
      'bg-canvas': '#fdf4fb',
      surface: '#ffffff',
      'surface-2': '#f7e8f5',
      hover: 'rgba(219, 39, 119, 0.06)',
      border: 'rgba(157, 23, 77, 0.12)',
      'border-strong': 'rgba(157, 23, 77, 0.2)',
      text: '#3b0764',
      'text-dim': '#86198f',
      'text-faint': '#a855b0',
      accent: '#c026d3',
      'accent-soft': 'rgba(192, 38, 211, 0.12)',
      'accent-text': '#ffffff',
      danger: '#d8453f',
      shadow: '0 4px 16px rgba(157, 23, 77, 0.1)',
      ...DIAG_LIGHT
    }
  }
}

export const BUILTIN_THEMES: ThemeDef[] = [
  DEFAULT_THEME,
  GITHUB_DARK,
  DRACULA,
  LINEAR,
  DISCORD,
  AMOLED,
  CLAUDE_DESKTOP,
  NUXT,
  SYNTHWAVE
]

export const DEFAULT_THEME_ID = 'default'
