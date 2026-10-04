import { useState, useRef } from 'react';
import { useDialog } from '../hooks/useDialog';
import { X, Mail, Lock, User, LogIn, UserPlus, Loader2, LogOut, KeyRound } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { signUpOutcome, friendlyAuthError } from '../utils/authLink';

export function AuthModal({ open, onClose }) {
  const { signIn, signUp, signOut, user, recovery, completeRecovery, resetPassword } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [message, setMessage]   = useState(null);
  const panelRef = useRef(null);
  useDialog(panelRef, { active: open, onClose });

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (isLogin) {
        const { error } = await signIn({ email, password });
        if (error) throw error;
        onClose();
      } else {
        const { data, error } = await signUp({ email, password });
        if (error) throw error;
        const outcome = signUpOutcome(data);
        if (outcome === 'signed-in') {
          onClose();
        } else if (outcome === 'exists') {
          // Supabase sends no email for an address that already has an account
          setIsLogin(true);
          setMessage('This email already has an account, so no new email was sent. Log in below, or use "Forgot password?".');
        } else {
          setMessage('Check your email for the confirmation link (and your spam folder, just in case).');
        }
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  // From a password-reset link: the user is signed in and picks a new password
  const handleNewPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await completeRecovery(password);
    setLoading(false);
    if (error) setError(friendlyAuthError(error));
    else setPassword('');
  };

  const handleForgot = async () => {
    setError(null);
    setMessage(null);
    if (!email) { setError('Type your email above first, then press "Forgot password?" again.'); return; }
    setLoading(true);
    const { error } = await resetPassword(email);
    setLoading(false);
    if (error) setError(friendlyAuthError(error));
    else setMessage('Check your email for a link to choose a new password.');
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      const { error } = (await signOut()) || {};
      if (error) throw error;
      onClose();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Authentication" onClick={onClose}>
      <div className="modal-panel auth-panel" ref={panelRef} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ maxWidth: 360 }}>
        <div className="modal-header">
          {recovery ? <KeyRound size={14} /> : user ? <User size={14} /> : (isLogin ? <LogIn size={14} /> : <UserPlus size={14} />)}
          <span>{recovery ? 'Choose a new password' : user ? 'Account' : (isLogin ? 'Login' : 'Sign Up')}</span>
          <div style={{ flex: 1 }} />
          <button className="btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: '24px' }}>
          {user && recovery ? (
            <form onSubmit={handleNewPassword} id="auth-new-password-form">
              {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</div>}
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
                You're signed in as <b>{user.email}</b>. Pick a new password to finish.
              </p>
              <label className="settings-label" htmlFor="auth-new-password">New password</label>
              <div className="settings-input-row" style={{ marginBottom: 20 }}>
                <Lock size={14} style={{ marginLeft: 10, color: 'var(--text-muted)' }} />
                <input
                  id="auth-new-password"
                  type="password"
                  className="settings-input"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
              </div>
              <button className="btn-run" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
                {loading && <Loader2 size={14} className="animate-spin" />}
                Save new password
              </button>
            </form>
          ) : user ? (
            <div className="auth-profile">
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ 
                  width: 64, height: 64, background: 'var(--bg-lighter)', borderRadius: '50%', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px'
                }}>
                  <User size={32} color="var(--accent-primary)" />
                </div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{user.email}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Authenticated via Supabase</div>
              </div>
              <button 
                className="btn-run" 
                onClick={handleLogout} 
                disabled={loading}
                style={{ width: '100%', justifyContent: 'center', background: '#ef4444' }}
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                Logout
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</div>}
              {message && <div style={{ color: '#10b981', fontSize: 12, marginBottom: 12 }}>{message}</div>}

              <div className="settings-section" style={{ border: 'none', padding: 0 }}>
                <label className="settings-label">Email</label>
                <div className="settings-input-row" style={{ marginBottom: 16 }}>
                  <Mail size={14} style={{ marginLeft: 10, color: 'var(--text-muted)' }} />
                  <input
                    type="email"
                    className="settings-input"
                    placeholder="name@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>

                <label className="settings-label">Password</label>
                <div className="settings-input-row" style={{ marginBottom: 20 }}>
                  <Lock size={14} style={{ marginLeft: 10, color: 'var(--text-muted)' }} />
                  <input
                    type="password"
                    className="settings-input"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>

                <button className="btn-run" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
                  {loading && <Loader2 size={14} className="animate-spin" />}
                  {isLogin ? 'Login' : 'Create Account'}
                </button>

                {isLogin && (
                  <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12 }}>
                    <button type="button" id="auth-forgot-password" onClick={handleForgot} disabled={loading}
                      style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: 0 }}>
                      Forgot password?
                    </button>
                  </div>
                )}

                <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
                  {isLogin ? "Don't have an account?" : "Already have an account?"}{' '}
                  <button 
                    type="button" 
                    onClick={() => setIsLogin(!isLogin)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: 0 }}
                  >
                    {isLogin ? 'Sign Up' : 'Login'}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
