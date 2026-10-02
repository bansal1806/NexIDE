import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'

// @monaco-editor/react cancels its loader when StrictMode double-mounts in dev;
// that rejection is expected and harmless, so keep it out of the error logs.
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.type === 'cancelation') e.preventDefault();
});

// Offline support (production builds only; dev uses Vite's own module server)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('Offline support unavailable:', err));
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Springs and fades are skipped for users who ask the OS to reduce motion */}
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <App />
      </AuthProvider>
    </MotionConfig>
  </StrictMode>,
)
