import { useEffect } from 'react';

const RELOAD_KEY = 'nexide:reloaded-after-deploy';

/**
 * A lazy chunk from the previous deployment is gone (new version deployed while this tab was
 * open): reload transparently if nothing is unsaved, otherwise ask the user to save first.
 * @param {() => boolean} hasUnsavedWork
 * @param {(type: string, text: string) => void} notify
 */
export function useDeployRecovery(hasUnsavedWork, notify) {
  useEffect(() => {
    // Don't preventDefault(): that makes Vite resolve the import with `undefined`. Letting it
    // reject means ChunkErrorBoundary sees the real error and offers Reload.
    const onPreloadError = () => {
      let recentlyReloaded = false;
      try { recentlyReloaded = Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) || 0) < 60_000; } catch { /* storage blocked */ }
      if (!hasUnsavedWork() && !recentlyReloaded) {
        try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
        window.location.reload();
      } else {
        notify('error', 'NexIDE was updated — save your work, then reload the page.');
      }
    };
    window.addEventListener('vite:preloadError', onPreloadError);
    return () => window.removeEventListener('vite:preloadError', onPreloadError);
  }, [hasUnsavedWork, notify]);
}
