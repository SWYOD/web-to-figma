import { Search } from 'lucide-react'

interface Props {
  query: string
  suggestions: string[]
  highlight: number
  onHover: (index: number) => void
  onSelect: (value: string) => void
}

/** Часть подсказки, совпадающая с уже введённым текстом, — приглушённая
 *  (уже знакомо), остаток — обычным цветом (то, что допечаталось) — тот же
 *  приём, что в Google/адресной строке браузера, помогает глазу сразу
 *  увидеть, что именно добавится. */
function SuggestionLabel({ query, suggestion }: { query: string; suggestion: string }): JSX.Element {
  const q = query.trim()
  if (q && suggestion.toLowerCase().startsWith(q.toLowerCase())) {
    return (
      <span>
        <span className="search-suggestion-matched">{suggestion.slice(0, q.length)}</span>
        {suggestion.slice(q.length)}
      </span>
    )
  }
  return <span>{suggestion}</span>
}

/** Стилизованная попап-выпадашка автодополнения (по запросу пользователя —
 *  "гугловское автодополнение, но красивый стилизованный попап") — общая
 *  для ReferencesSearchBar.tsx и BrowserToolbar.tsx, оба используют
 *  useSearchSuggestions.ts для данных, эта часть — только представление. */
export function SearchSuggestionsList({ query, suggestions, highlight, onHover, onSelect }: Props): JSX.Element {
  return (
    <div className="search-suggestions">
      {/* Внутренняя скроллящаяся обёртка (по жалобе пользователя — нижние
          углы попапа были не скруглены) — нативный scrollbar рисуется
          ПОВЕРХ border-radius контейнера, с которого он же и скроллит,
          визуально "срезая" скругление у того края, где сидит трек
          скроллбара; внешний .search-suggestions теперь только clip
          (overflow:hidden, без своего скролла), скроллит именно этот div. */}
      <div className="search-suggestions-scroll">
        {suggestions.map((s, i) => (
          <button
            key={s}
            className={`search-suggestion${i === highlight ? ' active' : ''}`}
            onMouseEnter={() => onHover(i)}
            onClick={() => onSelect(s)}
          >
            <span className="search-suggestion-icon">
              <Search size={12} />
            </span>
            <SuggestionLabel query={query} suggestion={s} />
          </button>
        ))}
      </div>
    </div>
  )
}
