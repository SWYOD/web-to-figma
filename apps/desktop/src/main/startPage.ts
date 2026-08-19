/**
 * Стартовая страница браузера — своя, а не google.com (см. пользовательский
 * запрос). Обычная статическая HTML-страница, загружаемая как `data:` URL в
 * WebContentsView, поэтому не может напрямую читать тему приложения (это
 * отдельный процесс/рендерер) — светлая/тёмная подстраивается через
 * `prefers-color-scheme`, с теми же токенами, что и остальной UI
 * (см. docs/design-system.md), а не завязана на текущий выбор пользователя
 * Light/Dark/System в самом приложении.
 */
const START_PAGE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root {
    --bg: #0a0a0c;
    --text: #eceef2;
    --text-dim: #90939c;
    --text-faint: #5a5d66;
    --accent: #8b5cf6;
    --border: rgba(255, 255, 255, 0.09);
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f5f6f8;
      --text: #16181d;
      --text-dim: #5b5f6a;
      --text-faint: #9498a3;
      --accent: #7c4fe0;
      --border: rgba(15, 25, 45, 0.09);
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    color: var(--text);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { text-align: center; max-width: 340px; padding: 24px; }
  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: var(--accent);
    color: #fff;
    font-weight: 700;
    font-size: 17px;
    letter-spacing: -0.5px;
    margin-bottom: 18px;
  }
  h1 { font-size: 15px; font-weight: 650; margin: 0 0 8px; letter-spacing: 0.2px; }
  p { font-size: 13px; color: var(--text-dim); line-height: 1.6; margin: 0; }
  .hint {
    font-size: 12px;
    color: var(--text-faint);
    margin-top: 18px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="mark">W→F</div>
    <h1>Web → Figma</h1>
    <p>Введите адрес сайта в строке выше, чтобы начать.</p>
    <div class="hint">Затем выберите элемент через Inspector, чтобы перенести его в Figma.</div>
  </div>
</body>
</html>`

export const START_PAGE_URL = `data:text/html;charset=utf-8,${encodeURIComponent(START_PAGE_HTML)}`

export function isStartPage(url: string): boolean {
  return url.startsWith('data:text/html')
}
