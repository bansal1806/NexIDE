import { useState } from 'react';
import { X, Mail, Lock, User, LogIn, UserPlus, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export function AuthModal({ open, onClose }) {
  const { signIn, signUp, signOut, user } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [message, setMessage]   = useState(null);

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
        const { error } = await signUp({ email, password });
        if (error) throw error;
        setMessage('Check your email for the confirmation link!');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    await signOut();
    setLoading(false);
    onClose();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Authentication" onClick={onClose}>
      <div className="modal-panel auth-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 360 }}>
        <div className="modal-header">
          {user ? <User size={14} /> : (isLogin ? <LogIn size={14} /> : <UserPlus size={14} />)}
          <span>{user ? 'Account' : (isLogin ? 'Login' : 'Sign Up')}</span>
          <div style={{ flex: 1 }} />
          <button className="btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: '24px' }}>
          {user ? (
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
