import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

// Returns the `role` claim of a legacy JWT-style key, or null for opaque keys (sb_publishable_…).
function jwtRole(key) {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

function isSafeBrowserKey(key) {
  if (key.startsWith('sb_secret_')) return false;
  const role = jwtRole(key);
  return role === null || role === 'anon';
}

const keyIsSafe = !supabaseKey || isSafeBrowserKey(supabaseKey);

if (!keyIsSafe) {
  // A service_role / secret key bypasses Row Level Security. Never ship it to the browser.
  console.error('[NexIDE] Refusing to use a privileged Supabase key in the browser. Cloud features disabled.');
}

// Only create a real client if credentials are configured and safe for the browser
export const supabase = (supabaseUrl && supabaseKey && keyIsSafe)
  ? createClient(supabaseUrl, supabaseKey)
  : null;
