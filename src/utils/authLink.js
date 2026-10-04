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

/**
 * What a successful signUp() call actually did. For an email that's already registered and
 * confirmed, Supabase sends no email but still answers "ok" with a user that has no identities
 * (so nobody can probe which emails exist): tell the user to log in instead.
 */
export function signUpOutcome(data) {
  if (data?.session) return 'signed-in';
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return 'exists';
  return 'check-email';
}

/** Supabase auth errors in plain words (falls back to its own message). */
export function friendlyAuthError(error) {
  const message = String(error?.message || error || '');
  if (/error sending .*email|smtp/i.test(message)) {
    return 'We couldn’t send the email. The site’s email settings (SMTP) may be wrong. Please try again later.';
  }
  if (/rate limit/i.test(message)) return 'Too many emails were sent just now. Wait a few minutes and try again.';
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password. (Signed up but never confirmed? Check your inbox for the link.)';
  if (/email not confirmed/i.test(message)) return 'Please confirm your email first: click the link we sent you (check spam too).';
  return message;
}
