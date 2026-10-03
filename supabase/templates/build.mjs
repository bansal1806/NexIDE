// Builds NexIDE's Supabase auth emails (Playground style) from one layout.
// Usage: node supabase/templates/build.mjs   → writes the *.html files next to this script.
// Paste each file into Supabase → Authentication → Emails → Templates (subjects: see README.md).
//
// Email-safe on purpose: tables + inline styles, no web fonts, no images, no CSS animation or
// box-shadow (Gmail/Outlook drop them). The chunky offset shadow is a thicker right/bottom border.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INK = '#0d0b13';
const FONT = "'Trebuchet MS', 'Segoe UI', Helvetica, Arial, sans-serif";
const DISPLAY = "'Arial Rounded MT Bold', 'Trebuchet MS', 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "Menlo, Consolas, 'Courier New', monospace";
const C = { mint: '#7df2c6', lemon: '#ffe27a', lilac: '#c9b0ff', peach: '#ffb98f', sky: '#8fd8ff', pink: '#ff9ad1', paper: '#fffdf7', page: '#f3efff', text: '#2a2438', muted: '#5f5675' };

const chunky = (bg, radius = 16) =>
  `background:${bg};border:3px solid ${INK};border-right-width:7px;border-bottom-width:7px;border-radius:${radius}px;`;

const sticker = (emoji, bg) => `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
            <tr>
              <td align="center" valign="middle" width="76" height="76" style="${chunky(bg, 22)}font-size:40px;line-height:76px;">${emoji}</td>
            </tr>
          </table>`;

const button = (label, href, bg) => `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 0;">
            <tr>
              <td align="center" style="${chunky(bg, 999)}">
                <a href="${href}" target="_blank" style="display:inline-block;padding:15px 34px;font-family:${DISPLAY};font-size:18px;font-weight:bold;color:${INK};text-decoration:none;letter-spacing:0.3px;">${label}</a>
              </td>
            </tr>
          </table>`;

// Inline pills (not table cells), so they wrap onto a second line on phones
const chips = (items) => `
          <div style="margin:20px 0 2px;text-align:center;line-height:2.6;">
${items.map(([text, bg]) => `            <span style="display:inline-block;margin:0 3px;padding:5px 12px;line-height:1.4;background:${bg};border:2px solid ${INK};border-radius:999px;font-family:${FONT};font-size:12.5px;font-weight:bold;color:${INK};white-space:nowrap;">${text}</span>`).join('\n')}
          </div>`;

const fallbackLink = (href) => `
          <p style="margin:22px 0 0;font-family:${FONT};font-size:12.5px;line-height:1.6;color:${C.muted};">
            Button being shy? Paste this into your browser:<br>
            <a href="${href}" target="_blank" style="color:#5b3fd1;word-break:break-all;">${href}</a>
          </p>`;

function layout({ preheader, accent, emoji, title, highlight, body, cta, footerNote }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};">
  <!-- Inbox preview text (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${C.page};">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
    <tr>
      <td align="center" style="padding:32px 14px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

          <!-- Wordmark -->
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="${chunky(C.lemon, 12)}padding:6px 12px;font-size:20px;line-height:24px;">⚡</td>
                  <td style="padding-left:10px;font-family:${DISPLAY};font-size:28px;font-weight:bold;color:${INK};letter-spacing:-0.5px;">nexide</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="${chunky(C.paper, 22)}padding:34px 30px 30px;" align="center">
${sticker(emoji, accent)}
              <h1 style="margin:22px 0 6px;font-family:${DISPLAY};font-size:27px;line-height:1.25;color:${INK};">${title}</h1>
              <p style="margin:0 0 4px;font-family:${DISPLAY};font-size:17px;line-height:1.5;color:${C.text};">
                <span style="background:${accent};border:2px solid ${INK};border-radius:8px;padding:1px 8px;font-weight:bold;color:${INK};">${highlight}</span>
              </p>
              <div style="margin:18px 0 22px;font-family:${FONT};font-size:15.5px;line-height:1.65;color:${C.text};text-align:center;">
${body}
              </div>
${cta}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:24px 16px 0;font-family:${FONT};font-size:12.5px;line-height:1.7;color:${C.muted};">
              ${footerNote}<br>
              Made with 💜 (and a little too much coffee) by the NexIDE robots 🤖<br>
              <a href="{{ .SiteURL }}" target="_blank" style="color:#5b3fd1;font-weight:bold;text-decoration:none;">Open NexIDE →</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

const linkCta = (label, bg) => button(label, '{{ .ConfirmationURL }}', bg) + fallbackLink('{{ .ConfirmationURL }}');
const notYou = "Didn't ask for this? Just ignore it — nothing changes and nobody gets in.";

const TEMPLATES = {
  'confirm-signup': {
    subject: '🎈 One click and you’re in — welcome to NexIDE!',
    html: layout({
      preheader: 'Confirm your email and your coding playground is ready to go.',
      accent: C.mint, emoji: '🎈',
      title: 'Welcome to the playground!',
      highlight: 'You’re one click away.',
      body: `                Tap the big button to confirm <b>{{ .Email }}</b> and unlock your cloud projects.
${chips([['▶ Run JS & Python', C.lemon], ['▲ Next.js in a tab', C.lilac], ['⏪ Time-travel debug', C.sky]])}`,
      cta: linkCta('Confirm my email ✨', C.mint),
      footerNote: 'Someone (hopefully you!) signed up for NexIDE with this address. ' + notYou,
    }),
  },
  invite: {
    subject: '🎟️ You’ve got an invite to NexIDE',
    html: layout({
      preheader: 'Someone saved you a seat in the coding playground.',
      accent: C.lilac, emoji: '🎟️',
      title: 'You’re invited!',
      highlight: 'A seat in the playground has your name on it.',
      body: `                NexIDE is a browser IDE where you can write, run and <i>rewind</i> code — no installs, no fuss.
                Accept the invite to set up your account.`,
      cta: linkCta('Accept my invite 🎉', C.lilac),
      footerNote: 'You were invited to NexIDE with this address. Not expecting it? Ignore this email.',
    }),
  },
  'magic-link': {
    subject: '✨ Your magic NexIDE sign-in link',
    html: layout({
      preheader: 'No password needed — this link signs you right in.',
      accent: C.sky, emoji: '🪄',
      title: 'Abracadabra!',
      highlight: 'Your magic sign-in link is here.',
      body: `                No password needed — tap the button and you’re in.<br>
                It works <b>once</b> and expires soon, so don’t let it get cold.`,
      cta: linkCta('Sign me in 🪄', C.sky),
      footerNote: 'Someone asked to sign in to NexIDE as {{ .Email }}. ' + notYou,
    }),
  },
  'change-email': {
    subject: '📮 Confirm your new NexIDE email',
    html: layout({
      preheader: 'One click to move your NexIDE account to this address.',
      accent: C.peach, emoji: '📮',
      title: 'New address, who dis?',
      highlight: 'Let’s make the move official.',
      body: `                You asked to change your NexIDE email from<br>
                <b>{{ .Email }}</b> &nbsp;➜&nbsp; <b>{{ .NewEmail }}</b><br>
                Confirm below and we’ll update your account.`,
      cta: linkCta('Yep, use this address 📬', C.peach),
      footerNote: 'Didn’t ask to change your email? Ignore this — your account stays as it is.',
    }),
  },
  'reset-password': {
    subject: '🔑 Let’s get you back into NexIDE',
    html: layout({
      preheader: 'Pick a new password and get back to coding.',
      accent: C.lemon, emoji: '🔑',
      title: 'Forgot your password?',
      highlight: 'Happens to the best of us.',
      body: `                Tap the button to choose a new password for <b>{{ .Email }}</b>.<br>
                The link works once and expires soon.`,
      cta: linkCta('Choose a new password 🔐', C.lemon),
      footerNote: 'Didn’t ask for a reset? Ignore this — your current password keeps working.',
    }),
  },
  reauthentication: {
    subject: '🛡️ Your NexIDE verification code',
    html: layout({
      preheader: 'Use this code to confirm it’s really you.',
      accent: C.pink, emoji: '🛡️',
      title: 'Quick check — is it you?',
      highlight: 'Here’s your one-time code.',
      body: `                Enter this code in NexIDE to confirm the change you’re making:`,
      cta: `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
            <tr>
              <td align="center" style="${chunky(C.pink, 16)}padding:14px 26px;font-family:${MONO};font-size:34px;font-weight:bold;letter-spacing:8px;color:${INK};">{{ .Token }}</td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-family:${FONT};font-size:13px;color:${C.muted};">It expires soon and works only once.</p>`,
      footerNote: 'Didn’t try to change anything? Ignore this code — and maybe change your password.',
    }),
  },
};

export { TEMPLATES };
export const subjectsJson = () => JSON.stringify(Object.fromEntries(Object.entries(TEMPLATES).map(([k, v]) => [k, v.subject])), null, 2) + '\n';

// Write the files only when run directly (tests import TEMPLATES instead)
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const dir = new URL('.', import.meta.url);
  for (const [name, { html }] of Object.entries(TEMPLATES)) writeFileSync(new URL(`${name}.html`, dir), html);
  writeFileSync(new URL('subjects.json', dir), subjectsJson());
  console.log(`Wrote ${Object.keys(TEMPLATES).length} templates to ${fileURLToPath(dir)}`);
}
