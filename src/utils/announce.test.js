import { describe, it, expect } from 'vitest';
import { summarizeRun, projectAnnouncement } from './announce';

const line = (type, text) => ({ type, text });

describe('summarizeRun', () => {
  it('summarises a successful run with its time and output size', () => {
    const lines = [line('log', 'a'), line('log', 'b'), line('warn', 'c'), line('success', '✓ Completed in 12.6ms')];
    expect(summarizeRun(lines, 'success')).toBe('Run finished in 13 ms, 3 lines of output.');
    expect(summarizeRun([line('log', 'x'), line('success', '✓ Completed in 1ms')], 'success')).toBe('Run finished in 1 ms, 1 line of output.');
    // Output after completion (timers) doesn't change the summary
    expect(summarizeRun([line('log', 'x'), line('success', '✓ Completed in 1ms'), line('log', 'late')], 'success'))
      .toBe('Run finished in 1 ms, 1 line of output.');
  });

  it('reads the last error of a failed run', () => {
    const lines = [line('log', 'start'), line('error', '✗ TypeError: x is not a function (line 3)')];
    expect(summarizeRun(lines, 'error')).toBe('Run failed: TypeError: x is not a function (line 3)');
    expect(summarizeRun([], 'error')).toBe('Run failed: unknown error');
    expect(summarizeRun([line('error', 'x'.repeat(300))], 'error')).toHaveLength('Run failed: '.length + 158);
  });

  it('says nothing for other states', () => {
    expect(summarizeRun([], 'running')).toBe('');
  });
});

describe('projectAnnouncement', () => {
  it('describes each project step', () => {
    expect(projectAnnouncement('installing')).toBe('Installing dependencies.');
    expect(projectAnnouncement('installing', { depsFromCache: true })).toBe('Restoring saved dependencies.');
    expect(projectAnnouncement('ready')).toMatch(/preview is ready/);
    expect(projectAnnouncement('error', { error: 'npm install failed' })).toBe('Project failed: npm install failed');
    expect(projectAnnouncement('idle')).toBe('');
  });
});
