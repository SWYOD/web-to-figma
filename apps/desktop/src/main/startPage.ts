/**
 * Стартовая страница браузера — своя, а не google.com (см. пользовательский
 * запрос). Обычная статическая HTML-страница, загружаемая как `data:` URL в
 * WebContentsView, поэтому не может напрямую читать тему приложения (это
 * отдельный процесс/рендерер) — светлая/тёмная подстраивается через
 * `prefers-color-scheme`, с теми же токенами, что и остальной UI
 * (см. docs/design-system.md), а не завязана на текущий выбор пользователя
 * Light/Dark/System в самом приложении.
 *
 * Строка поиска с гугловским автодополнением (по запросу пользователя — "та
 * же строка, что в Референсах") — обычный window.api тут недоступен (эта
 * страница не грузится через основной preload), поэтому подключён отдельный
 * УРЕЗАННЫЙ preload (см. preload/browserTab.ts, main/browser.ts
 * BROWSER_TAB_PRELOAD) — сам себя включает только на этой конкретной
 * странице, экспонирует ровно два метода (`suggest`/`navigate`), никакого
 * доступа к остальному IPC. Вся логика автодополнения — обычный
 * vanilla-JS ниже (React/бандлер тут недоступны, страница самодостаточна).
 */
const START_PAGE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root {
    --bg: #0a0a0c;
    --surface: #131316;
    --surface-2: #1c1c20;
    --hover: rgba(255, 255, 255, 0.06);
    --text: #eceef2;
    --text-dim: #90939c;
    --text-faint: #5a5d66;
    --accent: #8b5cf6;
    --accent-soft: rgba(139, 92, 246, 0.18);
    --border: rgba(255, 255, 255, 0.09);
    --shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f5f6f8;
      --surface: #ffffff;
      --surface-2: #eef0f3;
      --hover: rgba(15, 25, 45, 0.06);
      --text: #16181d;
      --text-dim: #5b5f6a;
      --text-faint: #9498a3;
      --accent: #7c4fe0;
      --accent-soft: rgba(124, 79, 224, 0.14);
      --border: rgba(15, 25, 45, 0.09);
      --shadow: 0 6px 20px rgba(15, 25, 45, 0.14);
    }
  }
  * { box-sizing: border-box; }
  ::selection { background: var(--accent-soft); color: var(--text); }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    color: var(--text);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { text-align: center; max-width: 340px; padding: 24px; }
  .wrap-hint { padding-top: 0; }
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

  /* Строка поиска с автодополнением — тот же визуальный язык, что
     ReferencesSearchBar.tsx/SearchSuggestionsList.tsx в основном приложении
     (см. styles.css, классы .references-search- и .search-suggestion),
     вручную продублирован в чистом CSS — этой странице недоступен общий
     styles.css (data: URL, отдельный документ). */
  /* Точное 1:1 совпадение с .references-search-wrap/.search-suggestions*
     в styles.css (по запросу пользователя — "такой же попап автоподстановки
     как в референсах", раньше было "похоже", но не идентично: 480px вместо
     560px, 38px вместо 40px высоты, другие паддинги/радиусы иконки —
     заметная на глаз разница). flex-shrink: 0 — body сам flex-контейнер
     (см. выше), без этого браузер сжимал бы фиксированную ширину до размера
     вьюпорта, если тот уже её (узкий встроенный браузер при открытых левой/
     правой панелях) — живой баг, поймал пользователь ("так и не стала
     шире"), max-width — обратная защита от переполнения на совсем
     маленьком окне. */
  .search-wrap { position: relative; width: 560px; max-width: calc(100% - 40px); flex-shrink: 0; margin: 20px 0 0; }
  .search-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 40px;
    padding: 0 16px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-faint);
    transition: border-color 0.14s, box-shadow 0.14s;
  }
  .search-wrap:focus-within .search-bar {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .search-bar svg { flex: 0 0 auto; }
  .search-input {
    flex: 1 1 auto;
    min-width: 0;
    border: none;
    outline: none;
    background: none;
    font: inherit;
    font-size: 13px;
    color: var(--text);
  }
  .search-input::placeholder { color: var(--text-faint); }
  @keyframes search-suggestions-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .search-suggestions {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    right: 0;
    z-index: 5;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28), var(--shadow);
    overflow: hidden;
    display: none;
    text-align: left;
  }
  .search-suggestions.open { display: block; animation: search-suggestions-in 0.12s ease; }
  .search-suggestions-scroll {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px;
    max-height: 320px;
    overflow-y: auto;
  }
  .search-suggestion {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border-radius: 9px;
    color: var(--text);
    font-size: 12.5px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .search-suggestion-icon {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--hover);
    color: var(--text-faint);
  }
  .search-suggestion.active,
  .search-suggestion:hover { background: var(--hover); }
  .search-suggestion.active .search-suggestion-icon { background: var(--accent-soft); color: var(--accent); }
  .search-suggestion-matched { color: var(--text-faint); }
</style>
</head>
<body>
  <div class="wrap">
    <div class="mark">W→F</div>
    <h1>Web → Figma</h1>
  </div>
  <div class="search-wrap" id="searchWrap">
    <div class="search-bar">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input class="search-input" id="searchInput" placeholder="Введите название или адрес сайта" autofocus />
    </div>
    <div class="search-suggestions" id="searchSuggestions"><div class="search-suggestions-scroll" id="searchSuggestionsList"></div></div>
  </div>
  <div class="wrap wrap-hint">
    <div class="hint">Затем выберите элемент через Inspector, чтобы перенести его в Figma.</div>
  </div>
  <script>
    (function () {
      var api = window.w2fStartPage;
      var input = document.getElementById('searchInput');
      var wrap = document.getElementById('searchWrap');
      var box = document.getElementById('searchSuggestions');
      var list = document.getElementById('searchSuggestionsList');
      if (!api) return; // preload не подключился (не должно случаться) — просто без автодополнения

      var suggestIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      var suggestions = [];
      var highlight = -1;
      var debounceTimer = null;
      var requestSeq = 0;

      function escapeHtml(s) {
        return s.replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
      }

      function render() {
        var q = input.value.trim().toLowerCase();
        list.innerHTML = suggestions
          .map(function (s, i) {
            var label = s;
            if (q && s.toLowerCase().indexOf(q) === 0) {
              label = '<span class="search-suggestion-matched">' + escapeHtml(s.slice(0, q.length)) + '</span>' + escapeHtml(s.slice(q.length));
            } else {
              label = escapeHtml(s);
            }
            return (
              '<div class="search-suggestion' + (i === highlight ? ' active' : '') + '" data-index="' + i + '">' +
              '<span class="search-suggestion-icon">' + suggestIcon + '</span><span>' + label + '</span></div>'
            );
          })
          .join('');
        box.classList.toggle('open', suggestions.length > 0);
      }

      function commit(value) {
        var v = (value || '').trim();
        if (!v) return;
        box.classList.remove('open');
        api.navigate(v);
      }

      input.addEventListener('input', function () {
        var q = input.value.trim();
        clearTimeout(debounceTimer);
        if (!q) {
          suggestions = [];
          render();
          return;
        }
        var seq = ++requestSeq;
        debounceTimer = setTimeout(function () {
          api.suggest(q).then(function (result) {
            if (seq !== requestSeq) return;
            suggestions = result || [];
            highlight = -1;
            render();
          });
        }, 180);
      });

      input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (suggestions.length) {
            highlight = Math.min(highlight + 1, suggestions.length - 1);
            render();
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (suggestions.length) {
            highlight = Math.max(highlight - 1, -1);
            render();
          }
        } else if (e.key === 'Enter') {
          commit(highlight >= 0 ? suggestions[highlight] : input.value);
        } else if (e.key === 'Escape') {
          box.classList.remove('open');
        }
      });

      list.addEventListener('mouseover', function (e) {
        var row = e.target.closest('.search-suggestion');
        if (!row) return;
        highlight = Number(row.dataset.index);
        render();
      });
      list.addEventListener('click', function (e) {
        var row = e.target.closest('.search-suggestion');
        if (!row) return;
        commit(suggestions[Number(row.dataset.index)]);
      });
      document.addEventListener('mousedown', function (e) {
        if (!wrap.contains(e.target)) box.classList.remove('open');
      });
    })();
  </script>
</body>
</html>`

export const START_PAGE_URL = `data:text/html;charset=utf-8,${encodeURIComponent(START_PAGE_HTML)}`

export function isStartPage(url: string): boolean {
  return url.startsWith('data:text/html')
}
