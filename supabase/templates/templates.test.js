import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const subjects = JSON.parse(read('subjects.json'));

// Supabase fills these in; a template missing its link/code would send a useless email
// Links carry the token hash to the app's /auth/confirm, with the verifyOtp type it needs
const REQUIRED = {
  'confirm-signup': ['/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email'],
  invite: ['/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite'],
  'magic-link': ['/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email'],
  'change-email': ['/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email_change', '{{ .NewEmail }}'],
  'reset-password': ['/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery'],
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
      // Supabase's own link is consumed by mail scanners that pre-click links
      expect(html).not.toContain('ConfirmationURL');
      const used = [...html.matchAll(/\{\{\s*\.(\w+)\s*\}\}/g)].map(m => m[1]);
      expect(used.every(v => ['TokenHash', 'Token', 'SiteURL', 'Email', 'NewEmail'].includes(v))).toBe(true);
      // Email-safe: no scripts, external stylesheets or images that clients block
      expect(html).not.toMatch(/<script|<link\s|<img\s|box-shadow|@font-face/i);
    });
  }

  it('the committed files match build.mjs (run: node supabase/templates/build.mjs)', async () => {
    const { TEMPLATES, subjectsJson } = await import('./build.mjs');
    const lf = (text) => text.replace(/\r\n/g, '\n'); // Git may check files out with CRLF
    for (const n of Object.keys(REQUIRED)) expect(lf(read(`${n}.html`))).toBe(TEMPLATES[n].html);
    expect(lf(read('subjects.json'))).toBe(subjectsJson());
  });
});
