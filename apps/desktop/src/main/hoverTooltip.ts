export type TooltipMode = 'light' | 'dark'

interface TooltipTheme {
  surface: string
  border: string
  text: string
  textFaint: string
  accent: string
  success: string
  shadow: string
}

/** Дублирует малую часть packages/ui DARK_VARS/LIGHT_VARS намеренно, а не
 *  импортирует их — main-процесс не должен тянуть @web-to-figma/ui
 *  (см. shared/types.ts, тот же принцип). */
const DARK: TooltipTheme = {
  surface: '#131316',
  border: 'rgba(255, 255, 255, 0.14)',
  text: '#eceef2',
  textFaint: '#90939c',
  accent: '#8b5cf6',
  success: '#34c98e',
  shadow: '0 8px 24px rgba(0, 0, 0, 0.5)'
}

const LIGHT: TooltipTheme = {
  surface: '#ffffff',
  border: 'rgba(15, 25, 45, 0.14)',
  text: '#16181d',
  textFaint: '#5b5f6a',
  accent: '#7c4fe0',
  success: '#0d9467',
  shadow: '0 8px 24px rgba(20, 30, 50, 0.18)'
}

/**
 * CDP `Overlay.setInspectMode`'s встроенный info-тултип рисуется самим
 * Chromium внутри рендерера страницы — его вид не настраивается через
 * протокол вообще, только цвета content/padding/border/margin-рамок
 * (HIGHLIGHT_CONFIG в inspector.ts). Поэтому `showInfo` выключен, а вместо
 * тултипа мы инжектим свой, привязанный к верхней грани bounding-box'а
 * наведённого элемента (как и нативный) — не к позиции курсора.
 *
 * Важная находка (проверено вживую через внешний CDP-скрипт): пока
 * `Overlay.setInspectMode({mode:'searchForNode'})` активен, Chromium
 * перехватывает mousemove ДО обычной диспетчеризации в JS страницы —
 * инжектированный `addEventListener('mousemove', ...)` вообще не получает
 * событий (то же поведение, что не даёт странице реагировать на hover своим
 * JS во время реального "Inspect element" в DevTools). Поэтому курсор и
 * наведённый узел отслеживаются не JS страницы, а main-процессом
 * (inspector.ts опрашивает `screen.getCursorScreenPoint()` +
 * `DOM.getNodeForLocation`), который лишь ВЫЗЫВАЕТ уже установленную здесь
 * функцию `show` через короткие `Runtime.evaluate`.
 */
export function buildHoverTooltipInstallScript(mode: TooltipMode): string {
  const t = mode === 'dark' ? DARK : LIGHT
  return `(() => {
    if (window.__w2fTooltipCleanup) window.__w2fTooltipCleanup();
    const tip = document.createElement('div');
    tip.setAttribute('data-w2f-hover-tooltip', '');
    tip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;display:none;' +
      'font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      'background:${t.surface};color:${t.text};border:1px solid ${t.border};' +
      'border-radius:8px;padding:7px 10px;box-shadow:${t.shadow};' +
      'line-height:1.5;min-width:160px;max-width:380px;';
    document.documentElement.appendChild(tip);

    // Привязка к верхней грани box'а элемента (как нативный DevTools-тултип):
    // над элементом, если влезает по высоте окна, иначе под ним; по горизонтали
    // выровнено по левому краю box'а, но всегда внутри viewport.
    function place(boxLeft, boxTop, boxWidth, boxHeight) {
      const gap = 6;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let top = boxTop - th - gap;
      if (top < 2) top = Math.min(window.innerHeight - th - 2, boxTop + boxHeight + gap);
      let left = boxLeft;
      if (left + tw > window.innerWidth - 2) left = window.innerWidth - tw - 2;
      if (left < 2) left = 2;
      tip.style.left = left + 'px';
      tip.style.top = Math.max(2, top) + 'px';
    }

    window.__w2fTooltipShow = (html, boxLeft, boxTop, boxWidth, boxHeight) => {
      tip.innerHTML = html;
      tip.style.display = 'block';
      place(boxLeft, boxTop, boxWidth, boxHeight);
    };
    window.__w2fTooltipHide = () => { tip.style.display = 'none'; };

    window.__w2fTooltipCleanup = () => {
      tip.remove();
      window.__w2fTooltipShow = undefined;
      window.__w2fTooltipHide = undefined;
      window.__w2fTooltipCleanup = undefined;
    };
  })();`
}

function jsStringLiteral(value: string): string {
  return JSON.stringify(value)
}

export function buildTooltipShowScript(labelHtml: string, boxLeft: number, boxTop: number, boxWidth: number, boxHeight: number): string {
  return `window.__w2fTooltipShow && window.__w2fTooltipShow(${jsStringLiteral(labelHtml)}, ${boxLeft}, ${boxTop}, ${boxWidth}, ${boxHeight});`
}

export const HOVER_TOOLTIP_HIDE_SCRIPT = 'window.__w2fTooltipHide && window.__w2fTooltipHide();'
export const HOVER_TOOLTIP_CLEANUP_SCRIPT = 'window.__w2fTooltipCleanup && window.__w2fTooltipCleanup();'

const THEME_BY_MODE: Record<TooltipMode, TooltipTheme> = { dark: DARK, light: LIGHT }

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export interface TooltipAccessibilityInfo {
  name: string | null
  role: string | null
  keyboardFocusable: boolean
}

/**
 * Собирает HTML содержимого тултипа — вычисляется в TS из уже полученных
 * через CDP DOM.describeNode/getBoxModel/Accessibility.getPartialAXTree
 * данных, а не в инжектированном JS (там больше нет доступа к hover-таргету,
 * см. комментарий в buildHoverTooltipInstallScript про polling). Формат
 * повторяет нативный тултип Chrome DevTools: selector + размеры сверху,
 * секция ACCESSIBILITY (Name/Role/Keyboard-focusable) снизу, когда узел
 * реально присутствует в accessibility-дереве (не декоративный/ignored).
 */
export function buildTooltipLabel(
  mode: TooltipMode,
  tag: string,
  id: string | null,
  classes: string[],
  width: number,
  height: number,
  accessibility: TooltipAccessibilityInfo | null
): string {
  const t = THEME_BY_MODE[mode]
  let selector = tag.toLowerCase()
  if (id) selector += `#${id}`
  if (classes.length > 0) selector += `.${classes.slice(0, 3).join('.')}`

  const header =
    `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:14px;white-space:nowrap">` +
    `<span style="color:${t.accent};font-weight:600">${escapeHtml(selector)}</span>` +
    `<span style="color:${t.textFaint}">${Math.round(width)} × ${Math.round(height)}</span>` +
    `</div>`

  if (!accessibility || (!accessibility.name && !accessibility.role)) return header

  const row = (label: string, value: string): string =>
    `<div style="display:flex;justify-content:space-between;gap:14px;white-space:nowrap">` +
    `<span style="color:${t.textFaint}">${label}</span><span>${value}</span></div>`

  return (
    header +
    `<div style="margin:6px 0 5px;padding-top:6px;border-top:1px solid ${t.border};` +
    `font-size:10px;text-transform:uppercase;letter-spacing:0.6px;color:${t.textFaint}">Accessibility</div>` +
    row('Name', escapeHtml(accessibility.name ?? '—')) +
    row('Role', escapeHtml(accessibility.role ?? '—')) +
    row('Keyboard-focusable', accessibility.keyboardFocusable ? `<span style="color:${t.success}">✓</span>` : '—')
  )
}
