import { useEffect, useState, type ReactNode } from 'react'
import { Send } from 'lucide-react'
import type { AppSettings, ReferenceItem, ReferenceSessionState } from '../../../shared/types'
import { referenceSiteKey } from '../referenceSiteKey'
import { ReferenceItemCard } from './ReferenceItemCard'

interface Props {
  session: ReferenceSessionState
  /** ReferencesView.tsx использует этот же компонент и в правой колонке во
   *  время сбора, и в теле центра, пока браузер ещё не открыт — тексту нужно
   *  отличаться ("справа"/тут карточек ещё нет вообще). По умолчанию —
   *  прежняя формулировка правой колонки. */
  emptyHint?: string
  /** 'head' (по умолчанию) — компактная правая колонка во время сбора,
   *  кнопка рядом с заголовком. 'bottom' — центральная часть страницы
   *  референс-сайта (по запросу пользователя — там кнопка должна быть
   *  закреплённой панелью внизу, под галереей, а не мелкой ссылкой сверху). */
  sendAllPlacement?: 'head' | 'bottom'
  /** Кнопка закрепления в distraction-free (см. ReferencesView.tsx правую
   *  колонку, тот же паттерн, что уже у ReferencesSidebar.tsx). */
  pinAction?: ReactNode
}

type SendOptions = Pick<AppSettings, 'useMatchedTextStyles' | 'useMatchedColorStyles' | 'colorMatchSource'>

/**
 * Вкладка "Референсы" нижней панели (по запросу пользователя) — видна
 * только пока активна сессия сбора (см. BottomPanel.tsx), показывает
 * галерею элементов ТЕКУЩЕГО референс-сайта сессии по мере добавления
 * пикером. Та же карточка (ReferenceItemCard), что и на детальной странице
 * референс-сайта в ReferencesView.tsx — постоянная версия галереи вне
 * сессии, здесь просто другой источник фильтрации (siteKey сессии, а не
 * произвольно открытый сайт).
 *
 * Настройки импорта (useMatchedTextStyles и т.п.) читает сама при монтировании
 * — тот же паттерн, что OverlayRoot.tsx/PanelOverlayRoot.tsx, не пробрасывать
 * через BrowserPane→BottomPanel ради одного глубоко вложенного потребителя.
 */
export function ReferenceItemsPanel({ session, emptyHint, sendAllPlacement = 'head', pinAction }: Props): JSX.Element {
  const [items, setItems] = useState<ReferenceItem[]>([])
  const [sendOptions, setSendOptions] = useState<SendOptions | null>(null)
  const [sendingAll, setSendingAll] = useState(false)
  const siteKey = referenceSiteKey(session.projectId, session.siteUrl)

  useEffect(() => {
    window.api.getSettings().then((s) => setSendOptions(s))
  }, [])

  useEffect(() => {
    window.api.referenceItemsGet(siteKey).then(setItems)
    return window.api.onReferenceItemsUpdated(setItems)
  }, [siteKey])

  const sendAll = async (): Promise<void> => {
    if (!sendOptions) return
    setSendingAll(true)
    await window.api.referenceItemsSendAll(siteKey, sendOptions.useMatchedTextStyles, sendOptions.useMatchedColorStyles, sendOptions.colorMatchSource)
    setSendingAll(false)
  }

  const pending = items.filter((i) => !i.sentToFigmaAt)

  const sendAllButton = pending.length > 0 && (
    <button className="reference-items-send-all" onClick={sendAll} disabled={sendingAll || !sendOptions}>
      <Send size={12} /> Отправить все ({pending.length})
    </button>
  )

  return (
    <div className="reference-items-panel">
      <div className="reference-items-panel-head">
        <span className="reference-items-panel-title">{session.siteTitle}</span>
        {sendAllPlacement === 'head' && sendAllButton}
        {pinAction}
      </div>
      {/* Отдельный скролл-контейнер, а не сама .reference-items-panel (та
          теперь просто flex-колонка на всю высоту) — иначе закреплённая
          снизу кнопка (sendAllPlacement:'bottom') оказывалась сразу под
          сеткой карточек, а не у фактического низа колонки, когда карточек
          мало и они не заполняют всю высоту (живой баг, поймал пользователь:
          "кнопку надо перенести вниз"). flex:1 на скролл-контейнере отдаёт
          ему весь остаток высоты, вытесняя бар к низу независимо от того,
          сколько там карточек. */}
      <div className="reference-items-panel-scroll">
        {items.length === 0 ? (
          <div className="placeholder-hint reference-items-empty">
            {emptyHint ?? 'Кликните пикером по элементам на странице — они появятся здесь карточками.'}
          </div>
        ) : sendOptions ? (
          <div className="reference-item-grid">
            {items.map((item) => (
              <ReferenceItemCard key={item.id} item={item} sendOptions={sendOptions} />
            ))}
          </div>
        ) : null}
      </div>
      {sendAllPlacement === 'bottom' && sendAllButton && (
        <div className="reference-items-send-all-bar">{sendAllButton}</div>
      )}
    </div>
  )
}
