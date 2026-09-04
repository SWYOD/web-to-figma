import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Globe, Loader2, RotateCw, X } from 'lucide-react'
import { IconButton } from '@web-to-figma/ui'
import type { BrowserState } from '../../../shared/types'
import { useSearchSuggestions } from '../hooks/useSearchSuggestions'
import { AddToProjectButton } from './AddToProjectButton'
import { SearchSuggestionsList } from './SearchSuggestionsList'

interface BrowserToolbarProps {
  state: BrowserState
  onNavigate: (input: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onStop: () => void
}

// Стартовая страница — свой data: URL (см. main/startPage.ts), не хотим
// показывать пользователю его сырой вид в адресной строке.
const isStartPage = (url: string): boolean => url.startsWith('data:text/html')

export function BrowserToolbar({ state, onNavigate, onBack, onForward, onReload, onStop }: BrowserToolbarProps): JSX.Element {
  const [draft, setDraft] = useState(isStartPage(state.url) ? '' : state.url)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // Гугловское автодополнение в адресной строке (по запросу пользователя —
  // "такой же поп ап на стартовой странице", т.е. тут же, где реально
  // печатают адрес) — тот же хук/попап, что и ReferencesSearchBar.tsx.
  const { suggestions, open, setOpen, highlight, setHighlight } = useSearchSuggestions(focused ? draft : '')

  useEffect(() => {
    if (!focused) setDraft(isStartPage(state.url) ? '' : state.url)
  }, [state.url, focused])

  // Клик снаружи (а не input onBlur) закрывает выпадашку — onBlur сработал
  // бы РАНЬШЕ click по подсказке (mousedown уводит фокус до того, как click
  // на кнопке подсказки успеет отработать), обычная ловушка выпадающих
  // списков под текстовым полем.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open, setOpen])

  const commit = (value: string): void => {
    setOpen(false)
    if (value.trim()) onNavigate(value)
    inputRef.current?.blur()
  }

  return (
    <div className="browser-toolbar">
      <div className="browser-toolbar-main">
        <div className="browser-toolbar-nav">
          <IconButton disabled={!state.canGoBack} onClick={onBack} title="Назад">
            <ArrowLeft size={15} />
          </IconButton>
          <IconButton disabled={!state.canGoForward} onClick={onForward} title="Вперёд">
            <ArrowRight size={15} />
          </IconButton>
          {state.isLoading ? (
            <IconButton onClick={onStop} title="Остановить">
              <X size={15} />
            </IconButton>
          ) : (
            <IconButton onClick={onReload} title="Обновить">
              <RotateCw size={14} />
            </IconButton>
          )}
        </div>
        <div className="address-bar-wrap" ref={wrapRef}>
          <div className={`address-bar${focused ? ' focused' : ''}`}>
            {state.isLoading ? (
              <Loader2 size={13} className="spin" />
            ) : state.faviconUrl ? (
              <img className="address-favicon" src={state.faviconUrl} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
            ) : (
              <Globe size={13} />
            )}
            <input
              ref={inputRef}
              className="address-input"
              value={draft}
              placeholder="Введите название или адрес сайта"
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => {
                setFocused(true)
                e.currentTarget.select()
              }}
              onBlur={() => setFocused(false)}
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
                  if (open) setOpen(false)
                  else {
                    setDraft(isStartPage(state.url) ? '' : state.url)
                    inputRef.current?.blur()
                  }
                }
              }}
            />
          </div>
          {open && suggestions.length > 0 && (
            <SearchSuggestionsList query={draft} suggestions={suggestions} highlight={highlight} onHover={setHighlight} onSelect={commit} />
          )}
        </div>
        <AddToProjectButton
          disabled={isStartPage(state.url)}
          site={{ url: state.url, title: state.title, faviconUrl: state.faviconUrl }}
        />
      </div>
      {state.loadError && <div className="address-error">Не удалось загрузить страницу: {state.loadError}</div>}
    </div>
  )
}
