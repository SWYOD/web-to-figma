import { useEffect, useState } from 'react'
import { ArrowRight, RotateCw } from 'lucide-react'

/** Плашка «обновление готово» — появляется, только когда electron-updater
 *  уже СКАЧАЛ новую версию (см. main/autoUpdater.ts), и пропадает после
 *  установки/выхода. Клик — quitAndInstall (перезапуск с заменой файлов).
 *  Тот же паттерн, что в Skill-tree (см. docs/architecture.md). */
export function UpdateBadge(): JSX.Element | null {
  const [version, setVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    return window.api.onUpdateReady((info) => setVersion(info.version))
  }, [])

  if (!version) return null

  async function handleClick(): Promise<void> {
    setError(null)
    setInstalling(true)
    try {
      await window.api.installUpdate()
      // Если приложение реально перезапускается, этот код никогда не
      // выполнится — таймаут ниже страхует случай, когда quitAndInstall()
      // не бросил исключение, но и не перезапустил (типичный симптом
      // неподписанной сборки на macOS: Squirrel.Mac тихо отказывается
      // подменять .app без Developer ID).
      setTimeout(() => {
        setInstalling(false)
        setError('Не удалось запустить установку — см. ниже.')
      }, 4000)
    } catch (err) {
      setInstalling(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div>
      <button className="update-badge" onClick={handleClick} disabled={installing}>
        <span className="update-badge-icon">
          <RotateCw size={14} className={installing ? 'spin' : undefined} />
        </span>
        <span className="update-badge-text">
          <span className="update-badge-title">Перезапустить для обновления</span>
          <span className="update-badge-version">версия {version}</span>
        </span>
        <ArrowRight size={14} className="update-badge-arrow" />
      </button>
      {error && (
        <p className="update-badge-error">
          {error} Вероятная причина — сборка без подписи Apple Developer ID: macOS отказывается
          подменять неподписанное приложение при автообновлении. Поставьте новую версию вручную
          из установщика.
        </p>
      )}
    </div>
  )
}
