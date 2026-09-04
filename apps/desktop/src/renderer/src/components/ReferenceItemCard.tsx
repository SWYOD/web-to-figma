import { useEffect, useRef, useState } from 'react'
import { Check, MessageSquare, RefreshCw, Send, Trash2 } from 'lucide-react'
import type { ColorMatchSource, ReferenceItem } from '../../../shared/types'
import { AssetLightbox } from './AssetLightbox'

type SendState = 'idle' | 'sending' | 'sent' | 'error'

interface Props {
  item: ReferenceItem
  sendOptions: {
    useMatchedTextStyles: boolean
    useMatchedColorStyles: boolean
    colorMatchSource: ColorMatchSource
  }
}

/**
 * Карточка референс-элемента (по запросу пользователя — референс теперь не
 * просто закладка на сайт, а собранные пикером элементы с него, см.
 * shared/types.ts ReferenceItem) — используется и в BottomPanel-вкладке во
 * время активной сессии сбора, и на детальной странице референс-сайта
 * (ReferencesView.tsx) для уже сохранённой галереи, один компонент на оба
 * места. Верстка — тот же паттерн, что .site-card (обложка сверху + body),
 * а не .asset-tile (там текст не нужен, только hover-иконки) — имя/описание
 * тут смысловые данные, должны быть видны всегда, не по наведению.
 *
 * Имя редактируется инлайн кликом по тексту — готового паттерна
 * инлайн-переименования в проекте не было, сделан минимальный
 * click-to-edit: blur/Enter коммитит через referenceItemsUpdateMeta.
 * Комментарий (поле description) — по клику на кнопку-иконку раскрывается
 * ИНЛАЙН, в обычном document flow карточки (НЕ поп-ап/попап-слой — тот
 * ловил живой баг: карточка внутри скроллящейся сетки, overflow-y:auto на
 * предке фактически схлопывает overflow-x тоже, обрезая любой абсолютно
 * спозиционированный поп-ап независимо от z-index; по прямому запросу
 * пользователя переделано на простое раскрытие поля внутри самой карточки,
 * без position:absolute/portal вообще — так эта категория багов в принципе
 * невозможна). Раскрытая textarea НЕ автофокусится (была причина другого
 * живого бага: автофокус уводил фокус с только что заавтофокушенного
 * name-input, onBlur немедленно коммитил и закрывал editing тем же тиком) —
 * простой явный клик в поле, если нужно печатать сразу.
 *
 * Автосохранение (по запросу пользователя, без кнопки "Сохранить") —
 * debounce 500мс на каждый ввод, плюс немедленный flush на onBlur/сворачивании
 * поля кнопкой (Escape — исключение, откатывает черновик без сохранения).
 */
export function ReferenceItemCard({ item, sendOptions }: Props): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const [sendState, setSendState] = useState<SendState>('idle')
  const [commentOpen, setCommentOpen] = useState(false)
  const [commentDraft, setCommentDraft] = useState(item.description ?? '')
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const commentSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const commitName = (): void => {
    setEditing(false)
    const trimmedName = name.trim() || item.name
    setName(trimmedName)
    if (trimmedName === item.name) return
    void window.api.referenceItemsUpdateMeta(item.id, { name: trimmedName })
  }

  const saveComment = (value: string): void => {
    if (commentSaveTimer.current) {
      clearTimeout(commentSaveTimer.current)
      commentSaveTimer.current = null
    }
    const trimmed = value.trim()
    if (trimmed === (item.description ?? '')) return
    void window.api.referenceItemsUpdateMeta(item.id, { description: trimmed || undefined })
  }
  const scheduleCommentSave = (value: string): void => {
    if (commentSaveTimer.current) clearTimeout(commentSaveTimer.current)
    commentSaveTimer.current = setTimeout(() => saveComment(value), 500)
  }
  // Незавершённый debounce не должен пережить размонтирование (например,
  // элемент удалили сразу после ввода) — иначе setTimeout стрельнёт в API
  // уже несуществующего id уже после unmount.
  useEffect(() => () => {
    if (commentSaveTimer.current) clearTimeout(commentSaveTimer.current)
  }, [])

  const send = async (): Promise<void> => {
    setSendState('sending')
    const result = await window.api.referenceItemsSend(
      item.id,
      sendOptions.useMatchedTextStyles,
      sendOptions.useMatchedColorStyles,
      sendOptions.colorMatchSource
    )
    setSendState(result.ok ? 'sent' : 'error')
    setTimeout(() => setSendState('idle'), result.ok ? 1200 : 2500)
  }

  return (
    <div className="reference-item-card">
      <div
        className={`reference-item-cover${item.thumbnail ? ' clickable' : ''}`}
        title={item.thumbnail ? 'Открыть просмотрщик' : undefined}
        onClick={() => item.thumbnail && setLightboxOpen(true)}
      >
        {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <div className="reference-item-cover-fallback">{item.element.tag}</div>}
        <button
          className="reference-item-cover-remove"
          title="Удалить"
          onClick={(e) => {
            e.stopPropagation()
            window.api.referenceItemsRemove(item.id)
          }}
        >
          <Trash2 size={12} />
        </button>
        {item.sentToFigmaAt && (
          <span className="reference-item-sent-badge" title="Уже отправлен в Figma">
            <Check size={11} />
          </span>
        )}
      </div>
      <div className="reference-item-body">
        {editing ? (
          <input
            className="reference-item-name-input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') {
                setName(item.name)
                setEditing(false)
              }
            }}
          />
        ) : (
          <div className="reference-item-meta" onClick={() => setEditing(true)} title="Кликните, чтобы переименовать">
            <span className="reference-item-name">{item.name}</span>
            {item.description && <span className="reference-item-description">{item.description}</span>}
          </div>
        )}
        {commentOpen && (
          <div className="reference-item-comment-inline">
            <textarea
              value={commentDraft}
              placeholder="Комментарий..."
              rows={2}
              onChange={(e) => {
                setCommentDraft(e.target.value)
                scheduleCommentSave(e.target.value)
              }}
              onBlur={(e) => saveComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (commentSaveTimer.current) clearTimeout(commentSaveTimer.current)
                  setCommentDraft(item.description ?? '')
                  setCommentOpen(false)
                }
              }}
            />
          </div>
        )}
        <div className="reference-item-actions">
          <button
            className={`reference-item-comment${item.description ? ' has-comment' : ''}${commentOpen ? ' active' : ''}`}
            title={item.description ? 'Изменить комментарий' : 'Добавить комментарий'}
            onClick={() => {
              if (commentOpen) saveComment(commentDraft)
              else setCommentDraft(item.description ?? '')
              setCommentOpen((v) => !v)
            }}
          >
            <MessageSquare size={12} />
          </button>
          <button
            className={`reference-item-send${sendState === 'error' ? ' error' : ''}`}
            title={sendState === 'error' ? 'Не удалось отправить — плагин подключён?' : 'Отправить в Figma'}
            onClick={send}
            disabled={sendState === 'sending'}
          >
            {sendState === 'sending' ? (
              <RefreshCw size={12} className="spin" />
            ) : sendState === 'sent' ? (
              <Check size={12} />
            ) : (
              <Send size={12} />
            )}
            {item.sentToFigmaAt ? 'Отправить снова' : 'Отправить'}
          </button>
        </div>
      </div>
      {lightboxOpen && item.thumbnail && (
        <AssetLightbox asset={{ data: item.thumbnail, sourceUrl: item.name, mimeType: 'image/jpeg' }} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  )
}
