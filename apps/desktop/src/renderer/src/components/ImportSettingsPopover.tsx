import { useEffect, useState } from 'react'
import { Palette } from 'lucide-react'
import { IconButton, Popover, Switch } from '@web-to-figma/ui'
import type { AppSettings } from '../../../shared/types'

/**
 * Настройки импорта — пока единственная опция ("стили проекта"), поэтому не
 * растим отдельный экран/вкладку, а вешаем попап рядом с Import as Frame в
 * floating bar (тот же паттерн, что ApplyToSelectionPopover). Читает/пишет
 * `AppSettings.useMatchedStyles` напрямую через window.api, независимо от
 * settings-состояния в App.tsx — тот же "самодостаточный popover", что и
 * остальные попапы тулбара.
 */
export function ImportSettingsPopover(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [useMatchedStyles, setUseMatchedStyles] = useState(false)

  useEffect(() => {
    window.api.getSettings().then((s: AppSettings) => setUseMatchedStyles(s.useMatchedStyles))
  }, [])

  const update = (value: boolean): void => {
    setUseMatchedStyles(value)
    window.api.getSettings().then((s: AppSettings) => window.api.saveSettings({ ...s, useMatchedStyles: value }))
  }

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="up"
      anchor={
        <IconButton active={open || useMatchedStyles} onClick={() => setOpen((v) => !v)} title="Настройки импорта">
          <Palette size={16} />
        </IconButton>
      }
    >
      <div className="popover-section">
        <div className="popover-label">Настройки импорта</div>
        <div className="popover-row">
          <span>Стили проекта</span>
          <Switch checked={useMatchedStyles} onChange={update} />
        </div>
        <div className="placeholder-hint">
          {useMatchedStyles
            ? 'Шрифт/цвет каждого узла ищет ближайший локальный text/paint style в файле (по кеглю для текста, по цвету для заливок/обводок) и привязывается к нему. Если подходящего стиля нет — используется исходное значение.'
            : 'Импорт вставляет исходные значения шрифтов и цветов напрямую, без привязки к стилям файла.'}
        </div>
      </div>
    </Popover>
  )
}
