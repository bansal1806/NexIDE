import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AuthContext } from './authContextDef';

const notConfigured = async () => ({
  data: null,
  error: new Error('Cloud accounts are not configured for this deployment.'),
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => !!(supabase && supabase.auth));

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
    signUp: (data) => supabase.auth.signUp(data),
    signIn: (data) => supabase.auth.signInWithPassword(data),
    signOut: () => supabase.auth.signOut(),
    user,
    isConfigured: true,
  } : {
    signUp: notConfigured,
    signIn: notConfigured,
    signOut: notConfigured,
    user: null,
    isConfigured: false,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
