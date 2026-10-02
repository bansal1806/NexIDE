import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_MODEL, SYSTEM_INSTRUCTION, buildContents, validateRequest } from '../src/shared/gemini.js';
import { rateLimiterFromEnv } from './_lib/rateLimit.js';

/**
 * System-key Gemini proxy.
 *
 * Users with their own key call Gemini directly from the browser, so their key never
 * reaches this server. This endpoint only serves signed-in users, using GEMINI_API_KEY,
 * with input limits and per-user rate limits (shared via Upstash/Vercel KV when configured).
 */

const limiter = rateLimiterFromEnv();

let supabaseAdminless = null;
function supabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  supabaseAdminless ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return supabaseAdminless;
}

async function authenticate(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const client = supabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'No system AI key is configured. Add your own Gemini API key in Settings.',
      code: 'MISSING_KEY',
    });
  }

  const user = await authenticate(req);
  if (!user) {
    return res.status(401).json({
      error: 'Sign in to use the built-in AI, or add your own Gemini API key in Settings.',
      code: 'AUTH_REQUIRED',
    });
  }

  const limit = await limiter.check(user.id);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSec));
    return res.status(429).json({
      error: limit.reason === 'day'
        ? 'Daily built-in AI quota reached. Add your own Gemini API key in Settings to keep going.'
        : 'Too many requests — please wait a moment.',
      code: 'RATE_LIMITED',
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const invalid = validateRequest(body);
  if (invalid) return res.status(400).json({ error: invalid, code: 'INVALID_REQUEST' });

  const { messages = [], userText, editorCode = '', language = '' } = body;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
      systemInstruction: SYSTEM_INSTRUCTION,
    });
    const result = await model.generateContent({ contents: buildContents(messages, userText, editorCode, language) });
    return res.status(200).json({ text: result.response.text() });
  } catch (error) {
    console.error('Gemini API Error:', error?.status, error?.message);
    if (error?.status === 429 || /\b429\b/.test(error?.message || '')) {
      return res.status(429).json({ error: 'System AI quota reached. Add your own Gemini API key in Settings.', code: 'LIMIT_EXCEEDED' });
    }
    return res.status(502).json({ error: 'Failed to generate response', code: 'UPSTREAM_ERROR' });
  }
}
