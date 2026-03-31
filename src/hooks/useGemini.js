import { useState, useCallback } from 'react';

export function useGemini() {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isExhausted, setIsExhausted] = useState(false);

  const sendMessage = useCallback(async (userText, editorCode = '', language = '', customKey = '') => {
    const userMsg = { id: Date.now(), role: 'user', content: userText };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);

    const assistantMsg = { id: Date.now() + 1, role: 'assistant', content: '', loading: true };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.slice(-10), // Send last 10 messages for context
          userText,
          editorCode,
          language,
          customKey // Pass the custom key if the user has provided one
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.code === 'LIMIT_EXCEEDED') {
          setIsExhausted(true);
          throw new Error('System API limit reached. Please add your own Gemini API key in Settings to continue.');
        }
        throw new Error(data.error || 'Failed to generate AI response');
      }

      setMessages(prev => prev.map(m => 
        m.id === assistantMsg.id 
          ? { ...m, content: data.text, loading: false } 
          : m
      ));

    } catch (err) {
      console.error('AI error:', err);
      setError(err.message);
      setMessages(prev => prev.filter(m => m.id !== assistantMsg.id));
    } finally {
      setIsLoading(false);
    }
  }, [messages]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setIsExhausted(false);
  }, []);

  return { messages, sendMessage, isLoading, error, isExhausted, clearMessages };
}
