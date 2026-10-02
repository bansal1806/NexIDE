// Fixed-window rate limiting for the AI proxy.
//
// With UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or Vercel KV's KV_REST_API_URL /
// KV_REST_API_TOKEN) the counters live in Redis and are shared by every serverless instance.
// Without them — or if Redis is unreachable — an in-memory limiter is used, which only
// limits per instance. Files under api/_lib are not exposed as Vercel routes.

const MINUTE = 60_000;
const DAY = 86_400_000;

export function createMemoryStore() {
  const counters = new Map(); // key -> { count, expiresAt }
  return {
    kind: 'memory',
    async incr(key, ttlMs) {
      const now = Date.now();
      let entry = counters.get(key);
      if (!entry || entry.expiresAt <= now) {
        entry = { count: 0, expiresAt: now + ttlMs };
        counters.set(key, entry);
      }
      entry.count += 1;
      if (counters.size > 50_000) {
        for (const [k, v] of counters) if (v.expiresAt <= now) counters.delete(k);
      }
      return entry.count;
    },
  };
}

export function createUpstashStore(url, token, fetchImpl = fetch) {
  const endpoint = `${url.replace(/\/+$/, '')}/pipeline`;
  return {
    kind: 'upstash',
    async incr(key, ttlMs) {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          ['INCR', key],
          ['PEXPIRE', key, String(ttlMs), 'NX'],
        ]),
      });
      if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
      const [incr] = await res.json();
      if (incr?.error) throw new Error(`Upstash: ${incr.error}`);
      return Number(incr.result);
    },
  };
}

/**
 * @param {object} opts
 * @param {number} opts.perMinute
 * @param {number} opts.perDay
 * @param {object} [opts.store]     primary store (Upstash); falls back to memory on error
 * @param {object} [opts.fallback]
 */
export function createRateLimiter({ perMinute, perDay, store, fallback = createMemoryStore(), now = () => Date.now() }) {
  const primary = store || fallback;

  async function incr(key, ttl) {
    if (primary === fallback) return fallback.incr(key, ttl);
    try {
      return await primary.incr(key, ttl);
    } catch (err) {
      console.error('[rate-limit] shared store unavailable, using per-instance memory:', err.message);
      return fallback.incr(key, ttl);
    }
  }

  return {
    kind: primary.kind,
    /** @returns {Promise<{ allowed: boolean, reason?: 'minute'|'day', retryAfterSec?: number }>} */
    async check(userId) {
      const t = now();
      const minuteWindow = Math.floor(t / MINUTE);
      const dayWindow = Math.floor(t / DAY);
      const [minuteCount, dayCount] = await Promise.all([
        incr(`nexide:ai:m:${userId}:${minuteWindow}`, MINUTE),
        incr(`nexide:ai:d:${userId}:${dayWindow}`, DAY),
      ]);
      if (minuteCount > perMinute) {
        return { allowed: false, reason: 'minute', retryAfterSec: Math.ceil(((minuteWindow + 1) * MINUTE - t) / 1000) };
      }
      if (dayCount > perDay) {
        return { allowed: false, reason: 'day', retryAfterSec: Math.ceil(((dayWindow + 1) * DAY - t) / 1000) };
      }
      return { allowed: true };
    },
  };
}

export function rateLimiterFromEnv(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return createRateLimiter({
    perMinute: Number(env.AI_RATE_LIMIT_PER_MINUTE) || 10,
    perDay: Number(env.AI_RATE_LIMIT_PER_DAY) || 200,
    store: url && token ? createUpstashStore(url, token) : undefined,
  });
}
