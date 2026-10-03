// An email link Supabase rejected (expired, already used…) comes back as
// #error=access_denied&error_code=otp_expired&error_description=…
export function readAuthLinkError(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  if (!params.get('error') && !params.get('error_code')) return null;
  if (params.get('error_code') === 'otp_expired') {
    return 'That email link has expired or was already used. Sign in, or sign up again to get a new link.';
  }
  return `That email link didn't work: ${params.get('error_description') || params.get('error')}.`;
}
