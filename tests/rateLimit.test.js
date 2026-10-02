import { describe, it, expect, vi } from 'vitest';
import { createRateLimiter, createMemoryStore, createUpstashStore, rateLimiterFromEnv } from '../api/_lib/rateLimit.js';

describe('rate limiter (memory)', () => {
  it('enforces the per-minute limit and resets in the next window', async () => {
    let t = 1_000_000_020_000;
    const limiter = createRateLimiter({ perMinute: 2, perDay: 100, now: () => t });
    expect((await limiter.check('u')).allowed).toBe(true);
    expect((await limiter.check('u')).allowed).toBe(true);
    const blocked = await limiter.check('u');
    expect(blocked).toMatchObject({ allowed: false, reason: 'minute' });
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect((await limiter.check('other')).allowed).toBe(true);
    t += 60_000;
    expect((await limiter.check('u')).allowed).toBe(true);
  });

  it('enforces the daily quota', async () => {
    let t = 0;
    const limiter = createRateLimiter({ perMinute: 100, perDay: 3, now: () => t });
    for (let i = 0; i < 3; i++) { expect((await limiter.check('u')).allowed).toBe(true); t += 61_000; }
    expect(await limiter.check('u')).toMatchObject({ allowed: false, reason: 'day' });
  });
});

describe('Upstash store', () => {
  it('sends INCR + PEXPIRE NX in one pipeline call', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => [{ result: 4 }, { result: 0 }] }));
    const store = createUpstashStore('https://x.upstash.io/', 'tok', fetchImpl);
    expect(await store.incr('k', 60_000)).toBe(4);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://x.upstash.io/pipeline');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual([['INCR', 'k'], ['PEXPIRE', 'k', '60000', 'NX']]);
  });

  it('falls back to memory when Redis is down', async () => {
    const broken = { kind: 'upstash', incr: vi.fn(async () => { throw new Error('ECONNRESET'); }) };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const limiter = createRateLimiter({ perMinute: 1, perDay: 10, store: broken, fallback: createMemoryStore() });
    expect((await limiter.check('u')).allowed).toBe(true);
    expect((await limiter.check('u')).allowed).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('is selected from env (Upstash or Vercel KV names)', () => {
    expect(rateLimiterFromEnv({}).kind).toBe('memory');
    expect(rateLimiterFromEnv({ KV_REST_API_URL: 'https://kv', KV_REST_API_TOKEN: 't' }).kind).toBe('upstash');
  });
});
