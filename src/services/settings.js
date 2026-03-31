// Settings persisted to localStorage
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

export { DEFAULTS };
