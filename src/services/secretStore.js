// Encrypted-at-rest storage for user API keys (Gemini key, GitHub token).
//
// - Encryption key: AES-GCM 256, generated with extractable=false and kept in IndexedDB.
//   Page script can *use* it but can never read its bytes, so a copied localStorage
//   dump, backup or synced profile doesn't expose the keys.
// - Ciphertext: localStorage ("remember on this device") or sessionStorage ("this session").
// - The code runners can't reach either: workers have no localStorage, and their
//   IndexedDB access is removed (see runtime/lockdown.js).

const STORAGE_KEY = 'nexide:secrets';
const DB_NAME = 'nexide-secure';
const DB_STORE = 'keys';
const CRYPTO_KEY_ID = 'secrets-aes-gcm-v1';

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Non-extractable AES key persisted in IndexedDB (created on first use). */
export async function indexedDbKeyProvider() {
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE);
  const db = await idbRequest(open);
  try {
    let key = await idbRequest(db.transaction(DB_STORE).objectStore(DB_STORE).get(CRYPTO_KEY_ID));
    if (!key) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await idbRequest(db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(key, CRYPTO_KEY_ID));
    }
    return key;
  } finally {
    db.close();
  }
}

/**
 * @param {object} deps
 * @param {() => Promise<CryptoKey>} deps.getKey
 * @param {Storage} deps.persistent   e.g. localStorage
 * @param {Storage} deps.session      e.g. sessionStorage
 */
export function createSecretStore({ getKey, persistent, session }) {
  let keyPromise = null;
  const key = () => (keyPromise ??= getKey().catch((e) => { keyPromise = null; throw e; }));

  async function encrypt(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), data));
    return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) });
  }

  async function decrypt(payload) {
    const { v, iv, ct } = JSON.parse(payload);
    if (v !== 1) throw new Error('unknown secret format');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(), unb64(ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  return {
    /** @returns {Promise<{ secrets: object, remembered: boolean|null }>} */
    async load() {
      for (const [storage, remembered] of [[persistent, true], [session, false]]) {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) continue;
        try {
          return { secrets: await decrypt(raw), remembered };
        } catch (e) {
          // Key lost (site data partially cleared) or tampered ciphertext: start fresh
          console.warn('Stored API keys could not be decrypted and were discarded:', e.message);
          storage.removeItem(STORAGE_KEY);
        }
      }
      return { secrets: {}, remembered: null };
    },

    async save(secrets, remember = true) {
      const target = remember ? persistent : session;
      const other = remember ? session : persistent;
      other.removeItem(STORAGE_KEY);
      const hasAny = Object.values(secrets).some(v => typeof v === 'string' && v);
      if (!hasAny) {
        target.removeItem(STORAGE_KEY);
        return;
      }
      target.setItem(STORAGE_KEY, await encrypt(secrets));
    },
  };
}

let defaultStore = null;
export function getSecretStore() {
  defaultStore ??= createSecretStore({
    getKey: indexedDbKeyProvider,
    persistent: localStorage,
    session: sessionStorage,
  });
  return defaultStore;
}

export { STORAGE_KEY as SECRETS_STORAGE_KEY };
