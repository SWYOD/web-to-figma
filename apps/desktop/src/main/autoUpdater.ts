import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

/** Раз в сколько проверяем обновления в фоне (плюс сразу при старте). */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

function sendStatus(status: UpdateStatus): void {
  broadcast('updater:status', status)
}

/**
 * Регистрирует события electron-updater + IPC-обработчики (тот же паттерн,
 * что в Skill-tree — обновление через GitHub Releases того же репозитория,
 * см. `build.publish` в package.json). Скачивание — автоматическое
 * (autoDownload), но установка — только по явному действию пользователя
 * (autoInstallOnAppQuit: false + отдельная кнопка «Перезапустить для
 * обновления», см. UpdateBadge.tsx), чтобы не подменить файлы приложения
 * посреди работы без спроса.
 */
export function registerAutoUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => sendStatus({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => sendStatus({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => sendStatus({ state: 'not-available' }))
  autoUpdater.on('error', (err) => sendStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) }))
  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({ state: 'downloaded', version: info.version })
    broadcast('updater:ready', { version: info.version })
  })

  ipcMain.handle('updater:check', async (): Promise<void> => {
    // В деве нет собранных релизов на GitHub — честная проверка только шумела
    // бы ошибками сети/404. Сразу отвечаем понятным статусом вместо реального
    // запроса (в отличие от фонового автопроверяльщика — тот в деве вообще не
    // запускается, см. scheduleUpdateChecks).
    if (!app.isPackaged) {
      sendStatus({ state: 'error', message: 'Проверка обновлений недоступна в режиме разработки.' })
      return
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      sendStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  })

  ipcMain.handle('updater:install', (): void => {
    // На macOS без валидной подписи (Developer ID Application) Squirrel.Mac
    // молча отказывается подменять .app — quitAndInstall() тогда либо ничего
    // не делает, либо бросает синхронно. Пробрасываем ошибку в рендерер (см.
    // UpdateBadge.tsx), а не глотаем её, иначе клик выглядит так, будто кнопка
    // вообще не работает.
    try {
      autoUpdater.quitAndInstall()
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
}

/** Фоновые проверки — сразу при старте и затем по таймеру. Молча глотаем
 *  ошибки (сеть недоступна и т.п.) — фон не должен дёргать пользователя,
 *  для этого есть кнопка ручной проверки в настройках. */
export function scheduleUpdateChecks(): void {
  if (!app.isPackaged) return
  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => {})
  }
  check()
  setInterval(check, CHECK_INTERVAL_MS)
}
