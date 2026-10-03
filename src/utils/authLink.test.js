import { describe, it, expect } from 'vitest';
import { readAuthLinkError } from './authLink';

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
