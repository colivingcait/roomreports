import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setValidating(false);
      setTokenValid(false);
      return;
    }
    fetch(`/api/auth/reset-password/${encodeURIComponent(token)}`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => setTokenValid(!!d.valid))
      .catch(() => setTokenValid(false))
      .finally(() => setValidating(false));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to reset password');
      navigate('/login?reset=1');
    } catch (err) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  if (validating) {
    return <div className="auth-form"><p>Checking link…</p></div>;
  }

  if (!tokenValid) {
    return (
      <div className="auth-form">
        <h2>Reset link invalid</h2>
        <p>This password reset link is invalid or has expired.</p>
        <p className="auth-footer">
          <Link to="/forgot-password">Request a new link</Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="auth-form">
      <h2>Reset password</h2>

      {error && <div className="auth-error">{error}</div>}

      <label>
        New password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          required
          autoFocus
        />
      </label>

      <label>
        Confirm new password
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </label>

      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? 'Resetting...' : 'Reset password'}
      </button>
    </form>
  );
}
