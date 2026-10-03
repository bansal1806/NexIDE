// Short spoken summaries for screen readers (the console and terminals stay silent: reading every
// output line aloud would drown the user).

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** After a single-file run: "Run finished in 12 ms, 3 lines of output." / "Run failed: …" */
export function summarizeRun(lines, status) {
  const all = lines || [];
  if (status === 'error') {
    const error = [...all].reverse().find(l => l.type === 'error');
    const text = (error?.text || 'unknown error').replace(/^✗\s*/, '');
    return `Run failed: ${text.length > 160 ? `${text.slice(0, 157)}…` : text}`;
  }
  if (status === 'success') {
    // Count output up to the completion line, so late async output doesn't change (and re-announce) it
    let end = all.length - 1;
    while (end >= 0 && !(all[end].type === 'success' && /Completed in/.test(all[end].text))) end--;
    const done = end >= 0 ? all[end] : null;
    const time = done?.text.match(/Completed in ([\d.]+)\s*ms/)?.[1];
    const output = all.slice(0, end >= 0 ? end : all.length).filter(l => l.type === 'log' || l.type === 'info' || l.type === 'warn').length;
    return `Run finished${time ? ` in ${Math.round(Number(time))} ms` : ''}, ${plural(output, 'line')} of output.`;
  }
  return '';
}

/** Project status changes: "Installing dependencies", "Dev server running", "Project failed: …" */
export function projectAnnouncement(status, { error, depsFromCache } = {}) {
  switch (status) {
    case 'downloading': return 'Downloading the repository files.';
    case 'booting':     return 'Starting the project.';
    case 'installing':  return depsFromCache ? 'Restoring saved dependencies.' : 'Installing dependencies.';
    case 'starting':    return 'Starting the dev server.';
    case 'ready':       return 'Dev server running. The preview is ready.';
    case 'stopped':     return 'Project stopped.';
    case 'error':       return `Project failed: ${error || 'unknown error'}`;
    default:            return '';
  }
}
