import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Trash2, Code2, AlertTriangle } from 'lucide-react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';

// Minimal markdown renderer for chat bubbles
function renderMarkdown(text) {
  if (!text) return '';
  
  const parts = [];
  let key = 0;

  // Split on code blocks first
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Text before code block
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++} dangerouslySetInnerHTML={{
          __html: inlineMarkdown(text.slice(lastIndex, match.index))
        }} />
      );
    }
    // Code block
    parts.push(
      <pre key={key++}>
        {match[2].trim()}
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(
      <span key={key++} dangerouslySetInnerHTML={{
        __html: inlineMarkdown(text.slice(lastIndex))
      }} />
    );
  }

  return parts.length > 0 ? parts : <span dangerouslySetInnerHTML={{ __html: inlineMarkdown(text) }} />;
}

function inlineMarkdown(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g,   '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <motion.div
      className={`ai-message ${isUser ? 'user' : 'assistant'}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div className="ai-message-avatar" aria-hidden="true">
        {isUser ? '👤' : '⚡'}
      </div>
      <div className="ai-message-bubble">
        {message.streaming && !message.content
          ? <div className="ai-typing" aria-label="AI is typing">
              <span /><span /><span />
            </div>
          : renderMarkdown(message.content)
        }
        {message.streaming && message.content && (
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 12,
              background: 'var(--accent-cyan)',
              marginLeft: 2,
              verticalAlign: 'text-bottom',
              animation: 'blink 1s step-end infinite',
            }}
            aria-hidden="true"
          />
        )}
      </div>
    </motion.div>
  );
}

export function AIChat({ gemini, editorCode, language, hasApiKey, isSignedIn, onApiKeyNeeded }) {
  // Own key → direct to Gemini; signed in → built-in proxy (if the server has a key)
  const canUseAI = hasApiKey || isSignedIn;
  const { messages, isLoading, error, sendMessage, clearMessages } = gemini || {};
  const onClear = clearMessages || (() => {});
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    const send = sendMessage || (() => {});
    send(text, editorCode, language);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [input, isLoading, sendMessage, editorCode, language]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickActions = [
    { label: '🐛 Find bugs', text: 'Find and explain any bugs or issues in my code.' },
    { label: '✨ Improve', text: 'How can I improve this code? Give me specific suggestions.' },
    { label: '📖 Explain', text: 'Explain this code in simple terms, step by step.' },
    { label: '⚡ Optimize', text: 'How can I optimize this for better performance?' },
  ];

  return (
    <div className="ai-chat" id="ai-chat-panel">
      {/* Header */}
      <div className="ai-chat-header">
        <div className="ai-avatar" aria-hidden="true">⚡</div>
        <div className="ai-chat-info">
          <h2>NexIDE AI</h2>
          <div className="ai-status">
            <div className="ai-status-dot" aria-hidden="true" />
            {hasApiKey ? 'Gemini · your key' : isSignedIn ? 'Gemini · built-in' : 'Setup required'}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          id="btn-clear-chat"
          className="btn-icon"
          onClick={onClear}
          aria-label="Clear chat history"
          title="Clear chat"
          style={{ width: 24, height: 24 }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* API Key Warning */}
      {!canUseAI && (
        <div className="api-key-banner" role="alert">
          <AlertTriangle size={12} aria-hidden="true" />
          <span>
          Add your <strong>Gemini API key</strong> or sign in to enable AI assistance.{' '}
            <button
              style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', fontSize: 'inherit', padding: 0, textDecoration: 'underline' }}
              onClick={onApiKeyNeeded}
            >Open Settings →</button>
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="ai-messages" aria-live="polite" aria-label="Chat messages">
        {(messages || []).length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ textAlign: 'center', padding: '24px 12px' }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>⚡</div>
            <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4, fontSize: 13 }}>
              NexIDE AI Assistant
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 16 }}>
              Powered by Google Gemini
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {quickActions.map(action => (
                <button
                  key={action.label}
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text-secondary)',
                    padding: '7px 10px',
                    cursor: 'pointer',
                    fontSize: 11,
                    textAlign: 'left',
                    transition: 'all 0.15s',
                    fontFamily: 'var(--font-sans)',
                  }}
                  onMouseEnter={e => {
                    e.target.style.borderColor = 'var(--accent-violet)';
                    e.target.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={e => {
                    e.target.style.borderColor = 'var(--border)';
                    e.target.style.color = 'var(--text-secondary)';
                  }}
                  onClick={() => { setInput(action.text); textareaRef.current?.focus(); }}
                  disabled={!canUseAI}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {(messages || []).map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </AnimatePresence>

        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 6,
              padding: '8px 10px',
              fontSize: 11,
              color: 'var(--accent-red)',
              display: 'flex',
              gap: 6,
              alignItems: 'flex-start',
            }}
            role="alert"
          >
            <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="ai-input-area">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Code2 size={11} style={{ color: 'var(--accent-cyan)' }} />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            AI can see your current editor code
          </span>
        </div>
        <div className="ai-input-row">
          <textarea
            id="ai-chat-input"
            ref={textareaRef}
            className="ai-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={canUseAI ? 'Ask AI about your code… (Enter to send, Shift+Enter for newline)' : 'Add a Gemini key in Settings or sign in to chat'}
            disabled={!canUseAI || isLoading}
            rows={1}
            aria-label="AI chat input"
          />
          <button
            id="btn-send-ai"
            className="btn-send"
            onClick={handleSend}
            disabled={!input.trim() || isLoading || !canUseAI}
            aria-label="Send message"
            title="Send (Enter)"
          >
            <Send size={13} />
          </button>
        </div>
        <div className="ai-hint">Enter to send · Shift+Enter for newline · AI sees your code</div>
      </div>
    </div>
  );
}
