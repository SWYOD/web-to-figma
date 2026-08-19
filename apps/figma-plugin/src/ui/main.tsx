import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@web-to-figma/ui/styles/tokens.css'
import '@web-to-figma/ui/styles/base.css'
import '@web-to-figma/ui/styles/components.css'
import './styles.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
