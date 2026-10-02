import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const generateContent = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser } }),
}));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent }; }
  },
}));

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  return res;
}

const post = (body, token) => ({
  method: 'POST',
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body,
});

let handler;
beforeEach(async () => {
  vi.resetModules();
  getUser.mockReset();
  generateContent.mockReset();
  process.env.GEMINI_API_KEY = 'server-key';
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  process.env.AI_RATE_LIMIT_PER_MINUTE = '2';
  ({ default: handler } = await import('../api/generate.js'));
});

describe('/api/generate', () => {
  it('rejects non-POST', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('requires a signed-in user', async () => {
    const res = mockRes();
    await handler(post({ userText: 'hi' }), res);
    expect(res.statusCode).toBe(401);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('bad jwt') });
    const res = mockRes();
    await handler(post({ userText: 'hi' }, 'forged'), res);
    expect(res.statusCode).toBe(401);
  });

  it('validates input', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const res = mockRes();
    await handler(post({ userText: '' }, 'tok'), res);
    expect(res.statusCode).toBe(400);
  });

  it('answers and then rate-limits per user', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u2' } }, error: null });
    generateContent.mockResolvedValue({ response: { text: () => 'answer' } });
    const results = [];
    for (let i = 0; i < 3; i++) {
      const res = mockRes();
      await handler(post({ userText: 'hi', messages: [] }, 'tok'), res);
      results.push(res.statusCode);
    }
    expect(results).toEqual([200, 200, 429]);
  });

  it('never accepts a client-supplied key', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = mockRes();
    await handler(post({ userText: 'hi', customKey: 'attacker-key' }, 'tok'), res);
    expect(res.statusCode).toBe(503);
    expect(generateContent).not.toHaveBeenCalled();
  });
});
