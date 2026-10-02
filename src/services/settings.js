// Settings persisted to localStorage; non-secret settings also sync to Supabase.
import { fetchCloudSettings, saveCloudSettings } from './db';

const KEY = 'nexide:settings';

const DEFAULTS = {
  geminiApiKey: '',
  githubToken:  '',
  fontSize:     13,
  theme:        'nexide-dark',
  tabSize:      2,
  wordWrap:     'off',
  autoSave:     false,
  minimap:      true,
  fontLigatures:true,
  rememberSecrets: true,
};

// Credentials stay in this browser only — never uploaded, and stored encrypted (secretStore.js).
export const SECRET_KEYS = ['geminiApiKey', 'githubToken'];
// Per-device preferences that shouldn't follow the account to other devices.
export const LOCAL_ONLY_KEYS = ['rememberSecrets'];

export function pickSecrets(settings) {
  return Object.fromEntries(SECRET_KEYS.map(k => [k, settings?.[k] || '']));
}

function withoutSecrets(settings) {
  const copy = { ...settings };
  SECRET_KEYS.forEach(k => delete copy[k]);
  return copy;
}

/** Only known, non-secret keys with the right type are allowed through. */
export function sanitizeForCloud(settings) {
  const clean = {};
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (SECRET_KEYS.includes(k) || LOCAL_ONLY_KEYS.includes(k)) continue;
    const v = settings?.[k];
    if (v !== undefined && typeof v === typeof def) clean[k] = v;
  }
  return clean;
}

// May still contain plaintext secrets written by older versions; they are moved into
// the encrypted store (and dropped from here) by the first saveSettings() after load.
export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Persist non-secret settings in plaintext. Secrets go through secretStore. */
export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(withoutSecrets(settings)));
  } catch (e) {
    console.warn('Could not persist settings locally:', e);
  }
}

/**
 * Merge cloud settings into local ones (cloud wins for non-secret keys).
 * If the cloud has nothing yet, seed it from local. Returns the merged settings.
 */
export async function syncSettingsWithCloud(userId, localSettings) {
  const cloudSettings = await fetchCloudSettings(userId);
  if (cloudSettings) {
    return { ...localSettings, ...sanitizeForCloud(cloudSettings) };
  }
  await saveCloudSettings(userId, sanitizeForCloud(localSettings));
  return localSettings;
}

export async function persistSettingsToCloud(userId, settings) {
  await saveCloudSettings(userId, sanitizeForCloud(settings));
}

export { DEFAULTS };
