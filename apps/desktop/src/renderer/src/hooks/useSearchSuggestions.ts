import { useEffect, useRef, useState } from 'react'

const DEBOUNCE_MS = 180

/**
 * Гугловское автодополнение (по запросу пользователя) — общий хук для строки
 * поиска на "Референсах" (ReferencesSearchBar.tsx) и адресной строки
 * обычного браузера (BrowserToolbar.tsx), оба зовут один и тот же
 * `searchSuggest` (см. main/index.ts, неофициальный Google suggest-эндпоинт).
 * `requestSeq` отбрасывает устаревшие ответы — быстрый ввод иначе мог бы
 * показать подсказки для уже стёртого текста, если более ранний запрос
 * ответит ПОСЛЕ более позднего (обычная гонка параллельных fetch без
 * гарантии порядка ответов).
 */
export function useSearchSuggestions(query: string): {
  suggestions: string[]
  open: boolean
  setOpen: (open: boolean) => void
  highlight: number
  setHighlight: React.Dispatch<React.SetStateAction<number>>
} {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestSeq = useRef(0)

  useEffect(() => {
    const trimmed = query.trim()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!trimmed) {
      setSuggestions([])
      setOpen(false)
      return
    }
    const seq = ++requestSeq.current
    debounceRef.current = setTimeout(() => {
      window.api.searchSuggest(trimmed).then((result) => {
        if (seq !== requestSeq.current) return
        setSuggestions(result)
        setOpen(result.length > 0)
        setHighlight(-1)
      })
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  return { suggestions, open, setOpen, highlight, setHighlight }
}
