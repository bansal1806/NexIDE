// Links in NexIDE's auth emails come back to the app in one of two shapes:
//  • /auth/confirm?token_hash=…&type=…  — our templates: the app verifies the token itself, so a mail
//    scanner that "pre-clicks" the link can't use it up (it doesn't run the app's JavaScript)
//  • #error=…&error_code=otp_expired…   — a link Supabase rejected (expired, already used)

const LINK_TYPES = new Set(['email', 'signup', 'invite', 'magiclink', 'recovery', 'email_change']);

/** `{ tokenHash, type }` for an email confirmation link, else null. */
export function readAuthConfirmLink(search) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  return tokenHash && LINK_TYPES.has(type) ? { tokenHash, type } : null;
}

export function readAuthLinkError(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  if (!params.get('error') && !params.get('error_code')) return null;
  if (params.get('error_code') === 'otp_expired') return EXPIRED;
  return `That email link didn't work: ${params.get('error_description') || params.get('error')}.`;
}

export const EXPIRED = 'That email link has expired or was already used. Sign in, or sign up again to get a new link.';

/** What to tell the user once a confirmation link was verified. */
export function confirmedMessage(type) {
  switch (type) {
    case 'invite':       return 'Welcome aboard! You’re signed in. 🎉';
    case 'email_change': return 'Your new email address is confirmed. 📬';
    case 'recovery':     return 'You’re signed in. Choose a new password to finish.';
    case 'magiclink':
    case 'email':
    case 'signup':
    default:             return 'Email confirmed. You’re signed in! 🎉';
  }
}
