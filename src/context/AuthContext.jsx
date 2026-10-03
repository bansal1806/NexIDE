import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AuthContext } from './authContextDef';
import { readAuthLinkError } from '../utils/authLink';

const notConfigured = async () => ({
  data: null,
  error: new Error('Cloud accounts are not configured for this deployment.'),
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => !!(supabase && supabase.auth));
  const [linkError, setLinkError] = useState(() => readAuthLinkError(window.location.hash));

  // Don't leave the error in the address bar (or in bookmarks)
  useEffect(() => {
    if (linkError) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [linkError]);

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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  const value = supabase ? {
    // Confirmation links return to the site the user signed up on (it must be in the project's
    // Redirect URLs; otherwise Supabase falls back to its Site URL)
    signUp: (data) => supabase.auth.signUp({
      ...data,
      options: { emailRedirectTo: window.location.origin, ...data?.options },
    }),
    signIn: (data) => supabase.auth.signInWithPassword(data),
    signOut: () => supabase.auth.signOut(),
    user,
    isConfigured: true,
    linkError,
    clearLinkError: () => setLinkError(null),
  } : {
    signUp: notConfigured,
    signIn: notConfigured,
    signOut: notConfigured,
    user: null,
    isConfigured: false,
    linkError,
    clearLinkError: () => setLinkError(null),
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
