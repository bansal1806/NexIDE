// Settings persisted to localStorage
const KEY = 'nexide:settings';

import { fetchCloudSettings, saveCloudSettings } from './db';

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

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

export async function syncSettingsWithCloud(userId, localSettings, onSynced) {
  const cloudSettings = await fetchCloudSettings(userId);
  if (cloudSettings) {
    // Cloud overrides local
    const merged = { ...localSettings, ...cloudSettings };
    saveSettings(merged);
    onSynced(merged);
  } else {
    // Save local to cloud
    await saveCloudSettings(userId, localSettings);
  }
}

export async function persistSettingsToCloud(userId, settings) {
  await saveCloudSettings(userId, settings);
}

export { DEFAULTS };
