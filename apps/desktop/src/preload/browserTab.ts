import { contextBridge, ipcRenderer } from 'electron'

// tsconfig.node.json (общий с main-процессом, без lib:"DOM") не знает про
// window/location — preload реально исполняется в контексте страницы (эти
// глобальные РЕАЛЬНО существуют в рантайме), минимальная ambient-декларация
// вместо того, чтобы тянуть DOM lib целиком в main-процесс ради одного поля.
declare const location: { href: string }

// Тот же признак, что main/startPage.ts isStartPage() — preload не может
// импортировать main-модуль напрямую (отдельный rollup-вход, см.
// electron.vite.config.ts), поэтому продублирован здесь тем же одним
// условием, не через общий импорт.
const isStartPage = (url: string): boolean => url.startsWith('data:text/html')

// Экспонируем API ТОЛЬКО когда реально загружена НАША стартовая страница —
// на любом другом сайте (в т.ч. открытом пользователем в этом же встроенном
// браузере) этот preload молча ничего не добавляет в window. location.href
// на момент выполнения preload уже отражает документ, который сейчас
// коммитится — тот же приём, которым Electron сам рекомендует ограничивать
// contextBridge конкретной страницей.
if (isStartPage(location.href)) {
  contextBridge.exposeInMainWorld('w2fStartPage', {
    /** Гугловское автодополнение (по запросу пользователя — "такая же
     *  строка поиска, как в Референсах") — тот же search:suggest, что уже
     *  использует основной renderer (см. main/index.ts). */
    suggest: (query: string): Promise<string[]> => ipcRenderer.invoke('search:suggest', query),
    /** Навигация ЭТОЙ КОНКРЕТНОЙ вкладки — main слушает 'browser-tab:navigate'
     *  и вызывает event.sender.loadURL() напрямую на приславшем webContents,
     *  без похода через BrowserController (тот не знает, какому из вкладок
     *  какого контроллера принадлежит этот webContents, а event.sender уже
     *  и есть точный ответ). */
    navigate: (input: string): void => ipcRenderer.send('browser-tab:navigate', input)
  })
}
