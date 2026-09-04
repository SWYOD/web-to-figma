import { useState } from 'react'
import {
  Bookmark,
  Briefcase,
  Camera,
  Check,
  Code2,
  Compass,
  Folder,
  Globe,
  Heart,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  Palette,
  Plus,
  Rocket,
  ShoppingBag,
  Sparkles,
  Star,
  Target,
  X
} from 'lucide-react'
import { usePopoverVisibility } from '../hooks/usePopoverVisibility'

/** Курируемый набор иконок для проекта — имя хранится как строка (Project.icon)
 *  и резолвится через этот же маппинг везде, где иконка проекта рисуется
 *  (см. ProjectSection.tsx PROJECT_ICON_MAP). */
export const PROJECT_ICON_MAP: Record<string, typeof Folder> = {
  folder: Folder,
  briefcase: Briefcase,
  globe: Globe,
  code: Code2,
  palette: Palette,
  layers: Layers,
  rocket: Rocket,
  target: Target,
  compass: Compass,
  lightbulb: Lightbulb,
  sparkles: Sparkles,
  star: Star,
  heart: Heart,
  bookmark: Bookmark,
  camera: Camera,
  shopping: ShoppingBag
}
const PROJECT_ICON_NAMES = Object.keys(PROJECT_ICON_MAP)

export interface ProjectModalInput {
  name: string
  description?: string
  icon?: string
  thumbnail?: string
}

interface Props {
  onClose: () => void
  onSubmit: (input: ProjectModalInput) => void
  /** Существующий проект — переключает попап в режим редактирования (по
   *  запросу пользователя, попап "..." на карточке проекта, см.
   *  ProjectCard.tsx) — то же самое окно, просто с предзаполненными полями и
   *  кнопкой "Сохранить" вместо "Создать". */
  initial?: ProjectModalInput
}

/**
 * Модалка создания/редактирования проекта по центру экрана — заменяет
 * прежний инлайновый `<input>` прямо в сайдбаре (живой баг, поймал
 * пользователь: инлайновый input наследовал `flex:1 1 auto` от
 * `.project-section-rename-input` внутри `.recent-scroll` — вертикального
 * flex-контейнера — и растягивался на всю высоту колонки). Иконка
 * (курируемый набор lucide) ИЛИ своя картинка с диска (по запросу
 * пользователя — `projectsPickThumbnail`, см. main/index.ts
 * projects:pick-thumbnail) — взаимоисключающие, выбор одного сбрасывает
 * другое.
 */
export function CreateProjectModal({ onClose, onSubmit, initial }: Props): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [icon, setIcon] = useState<string | undefined>(initial?.icon)
  const [thumbnail, setThumbnail] = useState<string | undefined>(initial?.thumbnail)
  const isEdit = initial !== undefined
  usePopoverVisibility(true)

  const canSubmit = name.trim().length > 0

  const submit = (): void => {
    if (!canSubmit) return
    onSubmit({
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(icon ? { icon } : {}),
      ...(thumbnail ? { thumbnail } : {})
    })
  }

  const pickThumbnail = async (): Promise<void> => {
    const result = await window.api.projectsPickThumbnail()
    if (!result) return
    setThumbnail(result)
    setIcon(undefined)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal create-project-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{isEdit ? 'Настройки проекта' : 'Новый проект'}</span>
          <div className="modal-head-actions">
            <button className="tb-btn primary" disabled={!canSubmit} onClick={submit}>
              {isEdit ? (
                <>
                  <Check size={14} /> Сохранить
                </>
              ) : (
                <>
                  <Plus size={14} /> Создать
                </>
              )}
            </button>
            <button className="icon-btn" onClick={onClose} title="Закрыть">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="create-project-body">
          <label className="settings-label">Иконка</label>
          <div className="create-project-icon-grid">
            <button
              className={`create-project-icon-btn create-project-thumbnail-btn${thumbnail ? ' active' : ''}`}
              title="Своя картинка"
              onClick={pickThumbnail}
            >
              {thumbnail ? <img src={thumbnail} alt="" /> : <ImageIcon size={16} />}
            </button>
            {PROJECT_ICON_NAMES.map((name_) => {
              const IconComp = PROJECT_ICON_MAP[name_]!
              return (
                <button
                  key={name_}
                  className={`create-project-icon-btn${icon === name_ ? ' active' : ''}`}
                  title={name_}
                  onClick={() => {
                    setIcon(icon === name_ ? undefined : name_)
                    setThumbnail(undefined)
                  }}
                >
                  <IconComp size={16} />
                </button>
              )
            })}
          </div>

          <label className="settings-label" style={{ marginTop: 12 }}>
            Название
          </label>
          <input
            className="text-input"
            value={name}
            autoFocus
            placeholder="Название проекта"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') onClose()
            }}
          />

          <label className="settings-label" style={{ marginTop: 12 }}>
            Описание (опционально)
          </label>
          <textarea
            className="text-input create-project-description"
            value={description}
            placeholder="Коротко, для чего этот проект"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
