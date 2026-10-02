import { describe, it, expect } from 'vitest';
import { buildContents, validateRequest, LIMITS } from './gemini';

describe('buildContents', () => {
  it('starts with a user turn and alternates roles', () => {
    const contents = buildContents(
      [
        { role: 'assistant', content: 'orphan reply' },
        { role: 'user', content: 'q1' },
        { role: 'user', content: 'q1 again (previous answer failed)' },
        { role: 'assistant', content: 'a1' },
      ],
      'q2'
    );
    expect(contents.map(c => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[0].parts[0].text).toBe('q1\n\nq1 again (previous answer failed)');
  });

  it('attaches editor code to the final user turn', () => {
    const contents = buildContents([], 'explain', 'let a = 1;', 'javascript');
    expect(contents).toHaveLength(1);
    expect(contents[0].parts[0].text).toContain('```javascript\nlet a = 1;\n```');
  });

  it('drops empty and unknown-role messages and sanitizes the language tag', () => {
    const contents = buildContents([{ role: 'system', content: 'x' }, { role: 'user', content: '  ' }], 'hi', 'x', 'js\n```evil');
    expect(contents).toHaveLength(1);
    expect(contents[0].parts[0].text).toContain('(plaintext)');
  });
});

describe('validateRequest', () => {
  it('accepts a normal payload', () => {
    expect(validateRequest({ userText: 'hi', editorCode: '', language: 'python', messages: [] })).toBeNull();
  });
  it('rejects oversized or malformed input', () => {
    expect(validateRequest({ userText: '' })).toMatch(/required/);
    expect(validateRequest({ userText: 'x'.repeat(LIMITS.maxUserTextChars + 1) })).toMatch(/exceeds/);
    expect(validateRequest({ userText: 'x', editorCode: 'y'.repeat(LIMITS.maxEditorCodeChars + 1) })).toMatch(/exceeds/);
    expect(validateRequest({ userText: 'x', messages: 'nope' })).toMatch(/array/);
    expect(validateRequest({ userText: 'x', messages: Array(LIMITS.maxHistoryMessages + 1).fill({ content: 'a' }) })).toMatch(/at most/);
    expect(validateRequest({ userText: 'x', messages: [{ content: 5 }] })).toMatch(/invalid/);
  });
});
