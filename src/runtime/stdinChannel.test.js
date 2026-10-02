import { describe, it, expect } from 'vitest';
import { Worker } from 'node:worker_threads';
import { createStdinChannel, readStdinBlocking } from './stdinChannel';

describe('stdin channel', () => {
  it('is unavailable without cross-origin isolation', () => {
    expect(createStdinChannel()).toBeNull();
  });

  it('returns an answer given before the reader blocks', () => {
    const ch = createStdinChannel({ force: true });
    let requested = false;
    // The reader arms the buffer and then calls request(); answer from inside request()
    const value = readStdinBlocking(ch.sab, () => { requested = true; ch.respond('héllo ⚡'); });
    expect(requested).toBe(true);
    expect(value).toBe('héllo ⚡');
  });

  it('signals EOF as null', () => {
    const ch = createStdinChannel({ force: true });
    expect(readStdinBlocking(ch.sab, () => ch.eof())).toBeNull();
  });

  it('blocks a worker thread until the page answers', async () => {
    const ch = createStdinChannel({ force: true });
    const src = `
      const { parentPort, workerData } = require('node:worker_threads');
      const ctl = new Int32Array(workerData, 0, 2);
      Atomics.store(ctl, 0, 0);
      parentPort.postMessage('request');
      Atomics.wait(ctl, 0, 0);
      const len = Atomics.load(ctl, 1);
      parentPort.postMessage(new TextDecoder().decode(new Uint8Array(workerData, 8, len).slice()));
    `;
    const worker = new Worker(src, { eval: true, workerData: ch.sab });
    const answer = await new Promise((resolve, reject) => {
      worker.on('message', (m) => {
        if (m === 'request') setTimeout(() => ch.respond('typed later'), 50);
        else resolve(m);
      });
      worker.on('error', reject);
    });
    await worker.terminate();
    expect(answer).toBe('typed later');
  });
});
