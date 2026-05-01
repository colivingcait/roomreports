import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      setSubmitted(true);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="auth-form">
        <h2>Check your email</h2>
        <p>If an account exists with that email, we&apos;ve sent a reset link.</p>
        <p className="auth-footer">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="auth-form">
      <h2>Forgot password</h2>
      <p>Enter your email and we&apos;ll send you a link to reset your password.</p>

      {error && <div className="auth-error">{error}</div>}

      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          autoFocus
        />
      </label>

      <button type="submit" className="btn-primary" disabled={loading || !email.trim()}>
        {loading ? 'Sending...' : 'Send reset link'}
      </button>

      <p className="auth-footer">
        <Link to="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
