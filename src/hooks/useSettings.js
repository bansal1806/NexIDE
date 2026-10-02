import { useState, useEffect, useRef } from 'react';
import { loadSettings, saveSettings, pickSecrets, syncSettingsWithCloud, persistSettingsToCloud } from '../services/settings';
import { getSecretStore } from '../services/secretStore';

/**
 * App settings: persisted locally (API keys encrypted), and — for signed-in users — synced
 * to the cloud only after that user's cloud copy has been merged in.
 */
export function useSettings(userId, notify) {
  const [settings, setSettings] = useState(loadSettings);
  const settingsRef = useRef(settings);
  const cloudSyncedForRef = useRef(null);
  const [secretsReady, setSecretsReady] = useState(false);

  // Load API keys from the encrypted store. Nothing is persisted until this finishes,
  // so legacy plaintext keys are re-saved encrypted before being dropped from localStorage.
  useEffect(() => {
    let cancelled = false;
    getSecretStore().load()
      .then(({ secrets, remembered }) => {
        if (cancelled) return;
        const found = Object.fromEntries(Object.entries(secrets).filter(([, v]) => typeof v === 'string' && v));
        setSettings(prev => ({ ...prev, ...found, ...(remembered === false ? { rememberSecrets: false } : {}) }));
      })
      .catch(e => console.warn('Secure key storage unavailable; keys will not be saved:', e))
      .finally(() => { if (!cancelled) setSecretsReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    if (!secretsReady) return;
    const t = setTimeout(async () => {
      // Encrypted copy first: plaintext (legacy) keys are only dropped from localStorage
      // by saveSettings() once the encrypted copy is safely written.
      try {
        await getSecretStore().save(pickSecrets(settings), settings.rememberSecrets !== false);
      } catch (e) {
        console.warn('Could not store API keys securely:', e);
        notify('error', 'This browser blocked secure storage — API keys will be forgotten when you close the tab.');
      }
      saveSettings(settings);
    }, 300);
    return () => clearTimeout(t);
  }, [settings, secretsReady, notify]);

  useEffect(() => {
    cloudSyncedForRef.current = null;
    if (!userId) return;
    let cancelled = false;
    syncSettingsWithCloud(userId, settingsRef.current)
      .then(merged => {
        if (cancelled) return;
        cloudSyncedForRef.current = userId;
        setSettings(merged);
      })
      .catch(e => console.error('Settings sync failed:', e));
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!userId || cloudSyncedForRef.current !== userId) return;
    const t = setTimeout(() => {
      persistSettingsToCloud(userId, settings).catch(e => console.error('Settings upload failed:', e));
    }, 1000);
    return () => clearTimeout(t);
  }, [settings, userId]);

  return [settings, setSettings];
}
