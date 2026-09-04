import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@web-to-figma/ui/styles/tokens.css'
import '@web-to-figma/ui/styles/base.css'
import '@web-to-figma/ui/styles/components.css'
import './styles.css'
import App from './App'
import { OverlayRoot } from './OverlayRoot'
import { PanelOverlayRoot } from './PanelOverlayRoot'
import { PopoverOverlayRoot } from './PopoverOverlayRoot'

// Тот же renderer-бандл грузится несколько раз: обычным `index.html` для
// главного окна и с `?overlay=<id>` для каждого дополнительного
// WebContentsView, стоящего НАД встроенным браузером (см. main/overlay.ts —
// единственный способ показать попап реально поверх него без
// hide/inset-компромиссов). 'picker' — постоянный плавающий тулбар пикера,
// 'popover' — generic попап по требованию (см. PopoverOverlayRoot.tsx), по
// запросу пользователя обобщено так, чтобы любой новый попап был ещё одним
// `id`, а не переписыванием этой развилки.
const overlayId = new URLSearchParams(window.location.search).get('overlay')
// body { background: var(--bg) } из base.css непрозрачен — в overlay-окне
// это закрасило бы сплошным прямоугольником весь запас bounds вокруг
// реального попапа (см. main/overlay.ts — bounds всегда чуть больше
// содержимого), а не только сам попап.
if (overlayId) document.body.classList.add('overlay-body')

function Root(): JSX.Element {
  if (overlayId === 'picker') return <OverlayRoot />
  if (overlayId === 'popover') return <PopoverOverlayRoot />
  if (overlayId === 'panel-left') return <PanelOverlayRoot side="left" />
  if (overlayId === 'panel-right') return <PanelOverlayRoot side="right" />
  if (overlayId === 'panel-top') return <PanelOverlayRoot side="top" />
  if (overlayId === 'panel-references-left') return <PanelOverlayRoot side="references-left" />
  if (overlayId === 'panel-references-right') return <PanelOverlayRoot side="references-right" />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
