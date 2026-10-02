// Interactive program input: a worker blocks (Atomics.wait) until the page answers.
//
// Layout of the SharedArrayBuffer:  Int32 state | Int32 length | UTF-8 bytes…
//   state 0 = waiting for the page, 1 = answer ready; length -1 = EOF.
// Requires cross-origin isolation (COOP/COEP headers); otherwise createStdinChannel()
// returns null and programs only get the lines pre-filled in the console's Input box.
//
// The Pyodide worker (public/pyodide.worker.js, not bundled) has a copy of the reader.

export const STDIN_CAPACITY = 64 * 1024;
const WAITING = 0;
const READY = 1;

/** Page side. */
export function createStdinChannel({ force = false } = {}) {
  const available = typeof SharedArrayBuffer === 'function' && (force || globalThis.crossOriginIsolated === true);
  if (!available) return null;
  const sab = new SharedArrayBuffer(8 + STDIN_CAPACITY);
  const ctl = new Int32Array(sab, 0, 2);
  const data = new Uint8Array(sab, 8);
  const send = (length) => {
    Atomics.store(ctl, 1, length);
    Atomics.store(ctl, 0, READY);
    Atomics.notify(ctl, 0);
  };
  return {
    sab,
    respond(text) {
      const bytes = new TextEncoder().encode(String(text)).slice(0, STDIN_CAPACITY);
      data.set(bytes);
      send(bytes.length);
    },
    eof() { send(-1); },
  };
}

/**
 * Worker side: ask the page for a line and block until it answers.
 * @param {SharedArrayBuffer} sab
 * @param {() => void} request  posts the request message (called after the buffer is armed)
 * @returns {string|null} the line, or null at EOF
 */
export function readStdinBlocking(sab, request) {
  const ctl = new Int32Array(sab, 0, 2);
  Atomics.store(ctl, 0, WAITING);
  request();
  Atomics.wait(ctl, 0, WAITING); // returns immediately if the answer is already there
  const length = Atomics.load(ctl, 1);
  if (length < 0) return null;
  // TextDecoder can't read shared memory directly: copy first
  return new TextDecoder().decode(new Uint8Array(sab, 8, length).slice());
}
