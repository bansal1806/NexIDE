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
};

// Credentials stay in this browser only — never uploaded.
export const SECRET_KEYS = ['geminiApiKey', 'githubToken'];

/** Only known, non-secret keys with the right type are allowed through. */
export function sanitizeForCloud(settings) {
  const clean = {};
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (SECRET_KEYS.includes(k)) continue;
    const v = settings?.[k];
    if (v !== undefined && typeof v === typeof def) clean[k] = v;
  }
  return clean;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
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
