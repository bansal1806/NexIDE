import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'

// @monaco-editor/react cancels its loader when StrictMode double-mounts in dev;
// that rejection is expected and harmless, so keep it out of the error logs.
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.type === 'cancelation') e.preventDefault();
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
