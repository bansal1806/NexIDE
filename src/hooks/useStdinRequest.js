import { useState, useRef, useCallback } from 'react';
import { createStdinChannel } from '../runtime/stdinChannel';

/**
 * Interactive program input shared by the JS and Python runners.
 * open() creates a fresh channel per run (null when the page isn't cross-origin isolated);
 * the worker's 'stdin-request' message calls ask(); the console answers with submit()/eof().
 */
export function useStdinRequest() {
  const [inputRequest, setInputRequest] = useState(null); // { prompt } | null
  const channelRef = useRef(null);

  const open = useCallback(() => {
    channelRef.current = createStdinChannel();
    setInputRequest(null);
    return channelRef.current;
  }, []);

  const ask = useCallback((prompt) => setInputRequest({ prompt: prompt || '' }), []);

  const submit = useCallback((text) => {
    channelRef.current?.respond(text);
    setInputRequest(null);
  }, []);

  const eof = useCallback(() => {
    channelRef.current?.eof();
    setInputRequest(null);
  }, []);

  // The worker is gone (finished, stopped or replaced): nothing is waiting any more
  const cancel = useCallback(() => {
    channelRef.current = null;
    setInputRequest(null);
  }, []);

  return { inputRequest, open, ask, submit, eof, cancel };
}
