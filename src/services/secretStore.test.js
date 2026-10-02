import { describe, it, expect, vi } from 'vitest';
import { createSecretStore, SECRETS_STORAGE_KEY } from './secretStore';

vi.mock('../lib/supabase', () => ({ supabase: null }));

function memoryStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

const nonExtractableKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

function setup(getKey = nonExtractableKey) {
  const persistent = memoryStorage();
  const session = memoryStorage();
  let keyPromise;
  const store = createSecretStore({ getKey: () => (keyPromise ??= getKey()), persistent, session });
  return { store, persistent, session };
}

describe('secretStore', () => {
  it('round-trips secrets without storing plaintext', async () => {
    const { store, persistent } = setup();
    await store.save({ geminiApiKey: 'AIza-PLAINTEXT-123', githubToken: '' }, true);
    const raw = persistent.getItem(SECRETS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('AIza-PLAINTEXT-123');
    expect(await store.load()).toEqual({ secrets: { geminiApiKey: 'AIza-PLAINTEXT-123', githubToken: '' }, remembered: true });
  });

  it('uses session storage when not remembering, and clears the other store', async () => {
    const { store, persistent, session } = setup();
    await store.save({ geminiApiKey: 'k1' }, true);
    await store.save({ geminiApiKey: 'k2' }, false);
    expect(persistent.getItem(SECRETS_STORAGE_KEY)).toBeNull();
    expect(session.getItem(SECRETS_STORAGE_KEY)).toBeTruthy();
    expect((await store.load()).remembered).toBe(false);
  });

  it('removes storage when all secrets are cleared', async () => {
    const { store, persistent } = setup();
    await store.save({ geminiApiKey: 'k' }, true);
    await store.save({ geminiApiKey: '', githubToken: '' }, true);
    expect(persistent.getItem(SECRETS_STORAGE_KEY)).toBeNull();
  });

  it('discards ciphertext it cannot decrypt (key lost or tampered)', async () => {
    const a = setup();
    await a.store.save({ geminiApiKey: 'k' }, true);
    const b = setup(); // different key
    b.persistent.setItem(SECRETS_STORAGE_KEY, a.persistent.getItem(SECRETS_STORAGE_KEY));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await b.store.load()).toEqual({ secrets: {}, remembered: null });
    expect(b.persistent.getItem(SECRETS_STORAGE_KEY)).toBeNull();
    warn.mockRestore();
  });

  it('uses a fresh IV per save', async () => {
    const { store, persistent } = setup();
    await store.save({ geminiApiKey: 'same' }, true);
    const first = JSON.parse(persistent.getItem(SECRETS_STORAGE_KEY)).iv;
    await store.save({ geminiApiKey: 'same' }, true);
    expect(JSON.parse(persistent.getItem(SECRETS_STORAGE_KEY)).iv).not.toBe(first);
  });
});

describe('settings never persist secrets in plaintext', () => {
  it('saveSettings strips secret keys', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const { saveSettings, sanitizeForCloud } = await import('./settings');
    saveSettings({ geminiApiKey: 'AIza-x', githubToken: 'ghp_x', fontSize: 15, rememberSecrets: false });
    const saved = JSON.parse(storage.getItem('nexide:settings'));
    expect(saved).toEqual({ fontSize: 15, rememberSecrets: false });
    expect(sanitizeForCloud({ rememberSecrets: false, fontSize: 15 })).toEqual({ fontSize: 15 });
    vi.unstubAllGlobals();
  });
});
