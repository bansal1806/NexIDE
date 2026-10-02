import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { DEFAULT_MODEL, SYSTEM_INSTRUCTION, LIMITS, buildContents } from '../shared/gemini';

const HISTORY_FOR_CONTEXT = 10;

// User's own key: call Gemini straight from the browser — the key never touches our server.
async function generateDirect(apiKey, contents) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: DEFAULT_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION,
  });
  try {
    const result = await model.generateContent({ contents });
    return result.response.text();
  } catch (err) {
    if (err?.status === 400 && /API key/i.test(err.message)) throw new Error('Your Gemini API key was rejected. Check it in Settings.');
    if (err?.status === 429) throw new Error('Your Gemini key hit its rate limit. Wait a moment and retry.');
    throw new Error(err?.message || 'Gemini request failed');
  }
}

// No key: use the signed-in system proxy.
async function generateViaServer(payload) {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  let data = {};
  try { data = await response.json(); } catch { /* non-JSON error page */ }
  if (!response.ok) {
    const err = new Error(data.error || `AI request failed (${response.status})`);
    err.code = data.code;
    throw err;
  }
  return data.text;
}

/**
 * @param {{ apiKey?: string }} config  user's own Gemini key (optional)
 */
export function useGemini({ apiKey = '' } = {}) {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isExhausted, setIsExhausted] = useState(false);

  const messagesRef = useRef(messages);
  const apiKeyRef = useRef(apiKey);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { apiKeyRef.current = apiKey; }, [apiKey]);
  const busyRef = useRef(false);

  const sendMessage = useCallback(async (userText, editorCode = '', language = '') => {
    if (busyRef.current || !userText?.trim()) return;
    busyRef.current = true;

    const code = (editorCode || '').slice(0, LIMITS.maxEditorCodeChars);
    const history = messagesRef.current
      .filter(m => !m.loading)
      .slice(-HISTORY_FOR_CONTEXT)
      .map(m => ({ role: m.role, content: m.content.slice(0, LIMITS.maxMessageChars) }));

    const userMsg = { id: crypto.randomUUID(), role: 'user', content: userText };
    const assistantMsg = { id: crypto.randomUUID(), role: 'assistant', content: '', loading: true, streaming: true };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsLoading(true);
    setError(null);

    try {
      const key = apiKeyRef.current?.trim();
      const text = key
        ? await generateDirect(key, buildContents(history, userText, code, language))
        : await generateViaServer({ messages: history, userText, editorCode: code, language });

      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id ? { ...m, content: text, loading: false, streaming: false } : m
      ));
    } catch (err) {
      if (err.code === 'LIMIT_EXCEEDED') setIsExhausted(true);
      setError(err.message);
      setMessages(prev => prev.filter(m => m.id !== assistantMsg.id));
    } finally {
      busyRef.current = false;
      setIsLoading(false);
    }
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setIsExhausted(false);
  }, []);

  return { messages, sendMessage, isLoading, error, isExhausted, clearMessages };
}
