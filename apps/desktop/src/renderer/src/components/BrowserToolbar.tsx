import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Globe, Loader2, RotateCw, X } from 'lucide-react'
import { IconButton } from '@web-to-figma/ui'
import type { BrowserState } from '../../../shared/types'

interface BrowserToolbarProps {
  state: BrowserState
  onNavigate: (input: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onStop: () => void
}

export function BrowserToolbar({ state, onNavigate, onBack, onForward, onReload, onStop }: BrowserToolbarProps): JSX.Element {
  const [draft, setDraft] = useState(state.url)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!focused) setDraft(state.url)
  }, [state.url, focused])

  const commit = (): void => {
    if (draft.trim()) onNavigate(draft)
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
            placeholder="Введите адрес сайта"
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => {
              setFocused(true)
              e.currentTarget.select()
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(state.url)
                inputRef.current?.blur()
              }
            }}
          />
        </div>
      </div>
      {state.loadError && <div className="address-error">Не удалось загрузить страницу: {state.loadError}</div>}
    </div>
  )
}
