import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const subjects = JSON.parse(read('subjects.json'));

// Supabase fills these in; a template missing its link/code would send a useless email
const REQUIRED = {
  'confirm-signup': ['{{ .ConfirmationURL }}'],
  invite: ['{{ .ConfirmationURL }}'],
  'magic-link': ['{{ .ConfirmationURL }}'],
  'change-email': ['{{ .ConfirmationURL }}', '{{ .NewEmail }}'],
  'reset-password': ['{{ .ConfirmationURL }}'],
  reauthentication: ['{{ .Token }}'],
};

describe('Supabase email templates', () => {
  it('has a subject and a template for every auth email', () => {
    expect(Object.keys(subjects).sort()).toEqual(Object.keys(REQUIRED).sort());
  });

  for (const [name, vars] of Object.entries(REQUIRED)) {
    it(`${name}: contains its link/code and only known variables`, () => {
      const html = read(`${name}.html`);
      for (const v of vars) expect(html).toContain(v);
      const used = [...html.matchAll(/\{\{\s*\.(\w+)\s*\}\}/g)].map(m => m[1]);
      expect(used.every(v => ['ConfirmationURL', 'Token', 'SiteURL', 'Email', 'NewEmail'].includes(v))).toBe(true);
      // Email-safe: no scripts, external stylesheets or images that clients block
      expect(html).not.toMatch(/<script|<link\s|<img\s|box-shadow|@font-face/i);
    });
  }

  it('the committed HTML matches build.mjs (run: node supabase/templates/build.mjs)', async () => {
    const before = Object.fromEntries(Object.keys(REQUIRED).map(n => [n, read(`${n}.html`)]));
    await import('./build.mjs?rebuild=' + Date.now());
    for (const n of Object.keys(REQUIRED)) expect(read(`${n}.html`)).toBe(before[n]);
  });
});
