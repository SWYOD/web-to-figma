import { Menu, type WebContents } from 'electron'

/**
 * Electron НЕ даёт стандартное системное контекстное меню (copy/paste/...)
 * ни на одном webContents "из коробки" — его нужно собрать самому через
 * `context-menu` + `Menu.buildFromTemplate`, иначе правый клик по любому
 * текстовому полю (включая адресную строку) ничего не показывает (живой
 * баг, поймал пользователь — "у нас нет меню по правому клику, как минимум
 * оно должно быть в строке поиска"). Общий хелпер — используется и для
 * главного окна (адресная строка, правая панель), и для каждой вкладки
 * встроенного браузера (см. main/browser.ts), чтобы не дублировать шаблон.
 */
export function attachEditContextMenu(wc: WebContents): void {
  wc.on('context-menu', (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = []

    if (params.isEditable) {
      items.push(
        { role: 'undo', enabled: params.editFlags.canUndo },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll }
      )
    } else if (params.selectionText) {
      // Не редактируемый текст, но что-то выделено (напр. текст в правой
      // панели или на встроенной странице) — хотя бы Copy.
      items.push({ role: 'copy' })
    }

    if (items.length === 0) return
    Menu.buildFromTemplate(items).popup()
  })
}
