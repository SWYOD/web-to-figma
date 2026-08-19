import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@web-to-figma/ui/styles/tokens.css'
import '@web-to-figma/ui/styles/base.css'
import '@web-to-figma/ui/styles/components.css'
import './styles.css'
import App from './App'
import { OverlayRoot } from './OverlayRoot'

// Тот же renderer-бандл грузится дважды: обычным `index.html` для главного
// окна и с `?overlay=1` для второго WebContentsView, который стоит НАД
// встроенным браузером (см. main/overlay.ts) — единственный способ показать
// попап реально поверх него без hide/inset-компромиссов.
const isOverlay = new URLSearchParams(window.location.search).get('overlay') === '1'
// body { background: var(--bg) } из base.css непрозрачен — в overlay-окне
// это закрасило бы сплошным прямоугольником весь запас bounds вокруг
// реального попапа (см. main/overlay.ts — bounds всегда чуть больше
// содержимого), а не только сам попап.
if (isOverlay) document.body.classList.add('overlay-body')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isOverlay ? <OverlayRoot /> : <App />}</StrictMode>
)
