import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AuthContext } from './authContextDef';
import { readAuthLinkError, readAuthConfirmLink, confirmedMessage, EXPIRED } from '../utils/authLink';

const notConfigured = async () => ({
  data: null,
  error: new Error('Cloud accounts are not configured for this deployment.'),
});

// An email link is verified at most once per page load (React runs effects twice in development,
// and a second attempt would fail: the token is single-use)
let confirmLinkHandled = false;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => !!(supabase && supabase.auth));
  // Result of an email link, shown in the status bar: { type: 'error' | 'info', text }
  const [authNotice, setAuthNotice] = useState(() => {
    const error = readAuthLinkError(window.location.hash);
    return error ? { type: 'error', text: error } : null;
  });
  const [recovery, setRecovery] = useState(false); // signed in from a reset link: choose a new password

  // Don't leave tokens or errors in the address bar (or in bookmarks)
  useEffect(() => {
    if (authNotice?.type === 'error' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [authNotice]);

  // Our email templates link to /auth/confirm?token_hash=…&type=…: verify it here
  useEffect(() => {
    const link = readAuthConfirmLink(window.location.search);
    if (!link || confirmLinkHandled) return;
    confirmLinkHandled = true;
    window.history.replaceState(null, '', '/');
    if (!supabase) {
      Promise.resolve().then(() => setAuthNotice({ type: 'error', text: 'Cloud accounts are not configured for this deployment.' }));
      return;
    }
    supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type }).then(({ error }) => {
      if (error) {
        setAuthNotice({ type: 'error', text: error.code === 'otp_expired' || /expired|invalid/i.test(error.message) ? EXPIRED : error.message });
      } else {
        setAuthNotice({ type: 'info', text: confirmedMessage(link.type) });
        if (link.type === 'recovery') setRecovery(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!supabase || !supabase.auth) return;

    // Force loading to false after timeout to prevent blank screen hangs
    const timeoutId = setTimeout(() => setLoading(false), 2000);

    // Initial check
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setUser(session?.user ?? null);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
        clearTimeout(timeoutId);
      });

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });

    return () => {
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  const shared = {
    authNotice,
    clearAuthNotice: () => setAuthNotice(null),
    recovery,
    finishRecovery: () => setRecovery(false),
  };

  const value = supabase ? {
    // Confirmation links return to the site the user signed up on (it must be in the project's
    // Redirect URLs; otherwise Supabase falls back to its Site URL)
    signUp: (data) => supabase.auth.signUp({
      ...data,
      options: { emailRedirectTo: window.location.origin, ...data?.options },
    }),
    signIn: (data) => supabase.auth.signInWithPassword(data),
    signOut: () => supabase.auth.signOut(),
    resetPassword: (email) => supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
    // Finish a password reset: save the new password, then leave recovery mode with a confirmation
    completeRecovery: async (password) => {
      const result = await supabase.auth.updateUser({ password });
      if (!result.error) {
        setRecovery(false);
        setAuthNotice({ type: 'info', text: 'Password updated. ✅' });
      }
      return result;
    },
    user,
    isConfigured: true,
    ...shared,
  } : {
    signUp: notConfigured,
    signIn: notConfigured,
    signOut: notConfigured,
    resetPassword: notConfigured,
    completeRecovery: notConfigured,
    user: null,
    isConfigured: false,
    ...shared,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
