// Shared between the browser (direct calls with the user's own key) and /api/generate.

export const DEFAULT_MODEL = 'gemini-2.5-flash';

export const SYSTEM_INSTRUCTION = `You are NexIDE AI, an expert programming assistant embedded in a browser-based code editor.
You help users write, debug, explain, and improve their code.
When the user shares their code, analyze it carefully and provide specific, actionable help.`;

export const LIMITS = {
  maxHistoryMessages: 20,
  maxMessageChars: 16_000,
  maxUserTextChars: 8_000,
  maxEditorCodeChars: 100_000,
};

/** Validate a request payload. Returns an error string, or null when valid. */
export function validateRequest({ messages, userText, editorCode, language }) {
  if (typeof userText !== 'string' || !userText.trim()) return 'userText is required';
  if (userText.length > LIMITS.maxUserTextChars) return `userText exceeds ${LIMITS.maxUserTextChars} characters`;
  if (editorCode != null && typeof editorCode !== 'string') return 'editorCode must be a string';
  if ((editorCode || '').length > LIMITS.maxEditorCodeChars) return `editorCode exceeds ${LIMITS.maxEditorCodeChars} characters`;
  if (language != null && (typeof language !== 'string' || language.length > 32)) return 'invalid language';
  if (messages != null) {
    if (!Array.isArray(messages)) return 'messages must be an array';
    if (messages.length > LIMITS.maxHistoryMessages) return `at most ${LIMITS.maxHistoryMessages} history messages`;
    for (const m of messages) {
      if (!m || typeof m.content !== 'string' || m.content.length > LIMITS.maxMessageChars) return 'invalid history message';
    }
  }
  return null;
}

/**
 * Build a valid Gemini `contents` array: roles alternate, the first turn is the
 * user's, consecutive same-role turns are merged and empty turns are dropped.
 */
export function buildContents(messages = [], userText, editorCode = '', language = '') {
  const lang = /^[\w+#.-]*$/.test(language) ? language : '';
  const context = editorCode
    ? `\n\n[Current editor code (${lang || 'plaintext'})]:\n\`\`\`${lang}\n${editorCode}\n\`\`\``
    : '';

  const turns = [
    ...messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content?.trim())
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', text: m.content })),
    { role: 'user', text: userText + context },
  ];

  const merged = [];
  for (const t of turns) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === t.role) prev.text += `\n\n${t.text}`;
    else merged.push({ ...t });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();

  return merged.map(t => ({ role: t.role, parts: [{ text: t.text }] }));
}
