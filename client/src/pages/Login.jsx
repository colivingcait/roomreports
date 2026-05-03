import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const justReset = params.get('reset') === '1';

  const inviteToken = params.get('invite') || '';

  // After successful login, if the URL carried an invite token,
  // accept it (adds an OrganizationMember row + switches active
  // org). Errors there are non-fatal — the user is already signed
  // in, they just stay on their current org.
  const acceptInviteIfPresent = async () => {
    if (!inviteToken) return;
    try {
      await fetch(`/api/team/invitations/${encodeURIComponent(inviteToken)}/accept-as-existing`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch { /* surface as non-fatal */ }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      await acceptInviteIfPresent();
      // Reload so the sidebar org switcher + active-org pointer
      // pick up the newly-joined org.
      if (inviteToken) window.location.assign('/dashboard');
      else navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="auth-form">
        <h2>Sign in</h2>

        {inviteToken && (
          <div className="notification-bar" style={{ marginBottom: '0.75rem' }}>
            Sign in to accept your team invitation.
          </div>
        )}
        {justReset && (
          <div className="notification-bar" style={{ marginBottom: '0.75rem' }}>
            Password reset — you can now log in.
          </div>
        )}
        {error && <div className="auth-error">{error}</div>}

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            required
          />
        </label>

        <div style={{ textAlign: 'right', marginTop: '-0.25rem', marginBottom: '0.5rem' }}>
          <Link to="/forgot-password" className="auth-link-sm">Forgot password?</Link>
        </div>

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <div className="auth-divider">
        <span>or</span>
      </div>

      <a
        href={inviteToken ? `/api/auth/google?invite=${encodeURIComponent(inviteToken)}` : '/api/auth/google'}
        className="btn-google"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
          <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
        </svg>
        Sign in with Google
      </a>

      <p className="auth-footer">
        Don&apos;t have an account? <Link to="/signup">Sign up</Link>
      </p>
    </>
  );
}
