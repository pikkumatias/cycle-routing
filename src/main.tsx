import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import './theme/colorScheme'
import App from './App.tsx'

// The old Leaflet map cached HSL raster tiles here without limit; the vector
// map doesn't use it, so free the space once.
if ('caches' in window) void caches.delete('hsl-tiles-v1').catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
