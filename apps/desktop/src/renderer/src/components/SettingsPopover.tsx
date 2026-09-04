import { useEffect, useState } from 'react'
import { Check, Layers, Monitor, Moon, Palette, PanelsTopLeft, RefreshCw, Settings, Sun } from 'lucide-react'
import { BUILTIN_THEMES, DEFAULT_THEME, Popover, Segmented, Switch } from '@web-to-figma/ui'
import type { ThemeDef, ThemeMode } from '@web-to-figma/ui'
import type { AppSettings, UpdateStatus } from '../../../shared/types'
import { ThemesGalleryModal } from './ThemesGalleryModal'
import { UpdateBadge } from './UpdateBadge'

const THEME_MODE_OPTIONS: { value: ThemeMode; label: string; icon: JSX.Element }[] = [
  { value: 'light', label: 'Light', icon: <Sun size={13} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={13} /> },
  { value: 'system', label: 'System', icon: <Monitor size={13} /> }
]

const FULLSCREEN_MODE_OPTIONS: { value: AppSettings['fullscreenMode']; label: string; icon: JSX.Element }[] = [
  { value: 'push', label: 'Раздвигать', icon: <PanelsTopLeft size={13} /> },
  { value: 'float', label: 'Поверх', icon: <Layers size={13} /> }
]

/** Брейкпоинты для принудительного viewport-override перед реальным
 *  импортом (см. AppSettings.captureViewport докстринг, main/inspector.ts
 *  withDesktopViewport) — по запросу пользователя, вместо хардкода
 *  1440×900. Desktop совпадает со старым дефолтом. */
const CAPTURE_BREAKPOINT_PRESETS: { label: string; width: number; height: number }[] = [
  { label: 'Desktop', width: 1440, height: 900 },
  { label: 'Tablet', width: 768, height: 1024 },
  { label: 'Mobile', width: 390, height: 844 }
]

function updateStatusText(status: UpdateStatus | null): string {
  if (!status) return ''
  switch (status.state) {
    case 'checking':
      return 'Проверка обновлений…'
    case 'available':
      return `Найдена версия ${status.version ?? ''} — загружается…`
    case 'not-available':
      return 'У вас последняя версия.'
    case 'downloaded':
      return `Версия ${status.version ?? ''} загружена — перезапустите приложение.`
    case 'error':
      return status.message ?? 'Не удалось проверить обновления.'
    default:
      return ''
  }
}

interface Props {
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  themeId: string
  customThemes: ThemeDef[]
  onThemeIdChange: (id: string) => void
  onCustomThemesChange: (list: ThemeDef[]) => void
  themeSyncEnabled: boolean
  onThemeSyncEnabledChange: (enabled: boolean) => void
  fullscreenMode: AppSettings['fullscreenMode']
  onFullscreenModeChange: (mode: AppSettings['fullscreenMode']) => void
  referenceNamePromptOnAdd: boolean
  onReferenceNamePromptOnAddChange: (enabled: boolean) => void
  captureViewport: AppSettings['captureViewport']
  onCaptureViewportChange: (value: AppSettings['captureViewport']) => void
  captureFullBlockThumbnail: boolean
  onCaptureFullBlockThumbnailChange: (enabled: boolean) => void
  sidePanelsHoverReveal: boolean
  onSidePanelsHoverRevealChange: (enabled: boolean) => void
}

/**
 * Кнопка "Настройки", пришпиленная к низу сайдбара, + попап над ней —
 * портировано из .settings-anchor/.settings-toggle + SettingsPanel.tsx
 * Skill-tree, урезано до релевантных секций: "Внешний вид" (выбор темы,
 * открывает галерею, + Light/Dark/System — был в toolbar, теперь здесь, см.
 * docs/design-system.md §7) и "Обновления" (кнопка ручной проверки +
 * статус, тот же паттерн, что в Skill-tree, см. main/autoUpdater.ts —
 * плашка "готово к установке" (`UpdateBadge`) тоже здесь, но появляется
 * только когда обновление уже СКАЧАНО, независимо от ручной проверки).
 * Остальные секции Skill-tree (директории, шрифт, механика разблокировки)
 * нерелевантны этому приложению.
 */
export function SettingsPopover({
  themeMode,
  onThemeModeChange,
  themeId,
  customThemes,
  onThemeIdChange,
  onCustomThemesChange,
  themeSyncEnabled,
  onThemeSyncEnabledChange,
  fullscreenMode,
  onFullscreenModeChange,
  referenceNamePromptOnAdd,
  onReferenceNamePromptOnAddChange,
  captureViewport,
  onCaptureViewportChange,
  captureFullBlockThumbnail,
  onCaptureFullBlockThumbnailChange,
  sidePanelsHoverReveal,
  onSidePanelsHoverRevealChange
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  // Без usePopoverVisibility — этот попап 'up-stretch' (раскрывается ВВЕРХ
  // от кнопки, пришпиленной к низу сайдбара) и никогда геометрически не
  // пересекает browser-viewport, в отличие от BridgePopover (в тулбаре,
  // раскрывается ВНИЗ прямо над workspace) — прятать браузер тут было
  // избыточно, добавлено ранее "на всякий случай" вместе со всеми
  // остальными попапами. Живой баг, поймал пользователь: страница гасла
  // просто от открытия Настроек, хотя попап её не перекрывает.

  useEffect(() => window.api.onUpdateStatus(setUpdateStatus), [])

  const activeTheme = [...BUILTIN_THEMES, ...customThemes].find((t) => t.id === themeId) ?? DEFAULT_THEME

  return (
    <div className="settings-anchor">
      <UpdateBadge />
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        placement="up-stretch"
        anchor={
          <button className="settings-toggle" onClick={() => setOpen((v) => !v)}>
            <Settings size={15} /> Настройки
          </button>
        }
      >
        <div className="settings-section">
          <span className="settings-label">Внешний вид</span>
          <button className="settings-row settings-row-btn" onClick={() => setGalleryOpen(true)}>
            <span>Темы</span>
            <span className="settings-row-value">
              <Palette size={13} /> {activeTheme.name}
            </span>
          </button>
          <Segmented value={themeMode} options={THEME_MODE_OPTIONS} onChange={onThemeModeChange} />
          <div className="settings-row">
            <span>Синхронизировать тему с Bridge Tools</span>
            <Switch checked={themeSyncEnabled} onChange={onThemeSyncEnabledChange} />
          </div>
        </div>

        <div className="settings-sep" />

        <div className="settings-section">
          <span className="settings-label">Полноэкранный режим</span>
          {/* Как раскрываются панели наведением на край в distraction-free
              (см. App.tsx useEdgeReveal) — 'push' раздвигает browser-pane,
              'float' рисует панель НАД ним отдельным overlay-слоем (см.
              PanelOverlayRoot.tsx), по запросу пользователя как второй
              режим, не замена push. */}
          <Segmented value={fullscreenMode} options={FULLSCREEN_MODE_OPTIONS} onChange={onFullscreenModeChange} />
          {/* НЕЗАВИСИМО от distractionFree (см. AppSettings.sidePanelsHoverReveal
              докстринг) — тот отдельно управляет "контуром полноэкранки
              браузеров" (верхний тулбар приложения + адресная строка/вкладки
              встроенного браузера), по запросу пользователя. Эта настройка —
              про закрытые кнопкой боковые панели: наводить/раскрывать их (в
              стиле выше — push/float) даже ВНЕ полноэкранного режима. */}
          <div className="settings-row">
            <span>Поддержка свободного экрана</span>
            <Switch checked={sidePanelsHoverReveal} onChange={onSidePanelsHoverRevealChange} />
          </div>
        </div>

        <div className="settings-sep" />

        <div className="settings-section">
          <span className="settings-label">Референсы</span>
          {/* Во время сбора референс-элементов (по запросу пользователя) —
              выключено (дефолт) коммитит элемент сразу по "Добавить" с
              автоименем, переименование потом инлайн в карточке галереи;
              включено открывает попап имя/описание сразу при добавлении
              (см. ReferenceNamePopoverContent.tsx). */}
          <div className="settings-row">
            <span>Спрашивать имя при добавлении</span>
            <Switch checked={referenceNamePromptOnAdd} onChange={onReferenceNamePromptOnAddChange} />
          </div>
        </div>

        <div className="settings-sep" />

        <div className="settings-section">
          <span className="settings-label">Захват пикером</span>
          {/* Перед реальным импортом (Import as Frame/Component, полная
              страница) пикер по умолчанию временно раскладывает страницу
              под десктопный брейкпоинт, чтобы адаптивная вёрстка резолвилась
              в десктопный вид независимо от реального размера окна
              встроенного браузера (см. main/inspector.ts withDesktopViewport
              докстринг). Выключено — снимает документ КАК ОН ВЫГЛЯДИТ
              СЕЙЧАС, в текущем соотношении встроенного браузера, без
              override'а — по запросу пользователя. */}
          <div className="settings-row">
            <span>Захватывать в desktop-разрешении</span>
            <Switch
              checked={captureViewport.forced}
              onChange={(forced) => onCaptureViewportChange({ ...captureViewport, forced })}
            />
          </div>
          {captureViewport.forced &&
            // Список брейкпоинтов — не Segmented (тот горизонтальный,
            // подписи "Desktop 1440×900" в узком попапе настроек не
            // помещались и обрезались, живой баг, поймал пользователь) —
            // обычный вертикальный список строк, тот же паттерн, что и
            // остальные settings-row-btn выше.
            CAPTURE_BREAKPOINT_PRESETS.map((p) => {
              const active = p.width === captureViewport.width && p.height === captureViewport.height
              return (
                <button
                  key={p.label}
                  className="settings-row settings-row-btn"
                  onClick={() => onCaptureViewportChange({ ...captureViewport, width: p.width, height: p.height })}
                >
                  <span>{p.label}</span>
                  <span className="settings-row-value">
                    {p.width}×{p.height}
                    {active && <Check size={13} />}
                  </span>
                </button>
              )
            })}
          {/* Миниатюры референс/queue-элементов (см. componentScanner.ts
              captureElementPreviewOffscreen) по умолчанию обрезались по
              границе офскрин-окна — длинный блок захватывался не целиком
              (по запросу пользователя). Окно тут невидимо пользователю,
              поэтому его можно спокойно растянуть под реальную высоту
              блока перед снимком — никакого "дёрга" на экране нет. */}
          <div className="settings-row">
            <span>Захватывать блок целиком (со скроллом)</span>
            <Switch checked={captureFullBlockThumbnail} onChange={onCaptureFullBlockThumbnailChange} />
          </div>
        </div>

        <div className="settings-sep" />

        <div className="settings-section">
          <div className="settings-row">
            <span>Обновления</span>
            <button
              className="icon-btn xs"
              title="Проверить обновления"
              disabled={updateStatus?.state === 'checking'}
              onClick={() => window.api.checkForUpdate()}
            >
              <RefreshCw size={13} className={updateStatus?.state === 'checking' ? 'spin' : undefined} />
            </button>
          </div>
          {updateStatus && <p className="settings-update-status">{updateStatusText(updateStatus)}</p>}
        </div>
      </Popover>

      {galleryOpen && (
        <ThemesGalleryModal
          themeId={themeId}
          customThemes={customThemes}
          onSelect={onThemeIdChange}
          onCustomThemesChange={onCustomThemesChange}
          onClose={() => setGalleryOpen(false)}
        />
      )}
    </div>
  )
}
