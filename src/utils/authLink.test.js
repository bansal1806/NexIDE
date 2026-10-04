import { describe, it, expect } from 'vitest';
import { readAuthLinkError, readAuthConfirmLink, confirmedMessage, signUpOutcome, friendlyAuthError } from './authLink';

describe('readAuthLinkError', () => {
  it('explains an expired or reused email link', () => {
    expect(readAuthLinkError('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb='))
      .toMatch(/expired or was already used/);
  });

  it('passes other errors through readably', () => {
    expect(readAuthLinkError('#error=server_error&error_description=Database+error+saving+new+user'))
      .toBe("That email link didn't work: Database error saving new user.");
  });

  it('ignores normal URLs and successful sign-in fragments', () => {
    expect(readAuthLinkError('')).toBeNull();
    expect(readAuthLinkError('#access_token=abc&type=signup')).toBeNull();
  });
});

describe('readAuthConfirmLink', () => {
  it('reads the token and type from our email links', () => {
    expect(readAuthConfirmLink('?token_hash=pkce_abc123&type=email')).toEqual({ tokenHash: 'pkce_abc123', type: 'email' });
    expect(readAuthConfirmLink('?token_hash=x&type=recovery')).toEqual({ tokenHash: 'x', type: 'recovery' });
  });

  it('ignores other URLs and unknown types', () => {
    expect(readAuthConfirmLink('')).toBeNull();
    expect(readAuthConfirmLink('?type=email')).toBeNull();
    expect(readAuthConfirmLink('?token_hash=x&type=admin')).toBeNull();
  });
});

describe('confirmedMessage', () => {
  it('says what happened for each kind of link', () => {
    expect(confirmedMessage('email')).toMatch(/Email confirmed/);
    expect(confirmedMessage('recovery')).toMatch(/new password/);
    expect(confirmedMessage('email_change')).toMatch(/new email address/);
  });
});

describe('signUpOutcome', () => {
  it('tells apart new accounts, existing ones and instant sign-ins', () => {
    expect(signUpOutcome({ user: { identities: [{ provider: 'email' }] }, session: null })).toBe('check-email');
    expect(signUpOutcome({ user: { identities: [] }, session: null })).toBe('exists');
    expect(signUpOutcome({ user: { identities: [{}] }, session: { access_token: 'x' } })).toBe('signed-in');
    expect(signUpOutcome(null)).toBe('check-email');
  });
});

describe('friendlyAuthError', () => {
  it('explains common auth failures', () => {
    expect(friendlyAuthError({ message: 'Error sending confirmation email' })).toMatch(/SMTP/);
    expect(friendlyAuthError({ message: 'email rate limit exceeded' })).toMatch(/Too many emails/);
    expect(friendlyAuthError({ message: 'Invalid login credentials' })).toMatch(/Wrong email or password/);
    expect(friendlyAuthError({ message: 'Email not confirmed' })).toMatch(/confirm your email/);
    expect(friendlyAuthError({ message: 'Something else' })).toBe('Something else');
  });
});
