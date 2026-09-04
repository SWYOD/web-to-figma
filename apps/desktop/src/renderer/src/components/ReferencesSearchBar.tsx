import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useSearchSuggestions } from '../hooks/useSearchSuggestions'
import { SearchSuggestionsList } from './SearchSuggestionsList'

interface Props {
  onSubmit: (value: string) => void
}

/**
 * Строка поиска на стартовом экране "Референсы" (см. ReferencesView.tsx) —
 * автодополнение как в Google/адресной строке браузера (по запросу
 * пользователя), см. useSearchSuggestions.ts/SearchSuggestionsList.tsx —
 * общие с BrowserToolbar.tsx, тут только сама строка и её commit-логика
 * (сабмит сразу открывает embedded-браузер, см. вызывающую сторону).
 */
export function ReferencesSearchBar({ onSubmit }: Props): JSX.Element {
  const [draft, setDraft] = useState('')
  const { suggestions, open, setOpen, highlight, setHighlight } = useSearchSuggestions(draft)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open, setOpen])

  const commit = (value: string): void => {
    const trimmed = value.trim()
    if (!trimmed) return
    setOpen(false)
    setDraft('')
    onSubmit(trimmed)
  }

  return (
    <div className="references-search-wrap" ref={wrapRef}>
      <div className="references-search-bar">
        <Search size={16} />
        <input
          className="references-search-input"
          value={draft}
          placeholder="Введите адрес сайта, чтобы начать собирать референсы"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              if (open) setHighlight((i) => Math.min(i + 1, suggestions.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              if (open) setHighlight((i) => Math.max(i - 1, -1))
            } else if (e.key === 'Enter') {
              commit(highlight >= 0 ? suggestions[highlight]! : draft)
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
        />
      </div>
      {open && suggestions.length > 0 && (
        <SearchSuggestionsList query={draft} suggestions={suggestions} highlight={highlight} onHover={setHighlight} onSelect={commit} />
      )}
    </div>
  )
}
