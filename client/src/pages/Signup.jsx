import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [inviteInfo, setInviteInfo] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(!!inviteToken);
  const [inviteError, setInviteError] = useState('');

  // If there's an invite token, fetch property/org info
  useEffect(() => {
    if (!inviteToken) return;
    fetch(`/api/auth/property-invite/${inviteToken}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setInviteInfo(data);
      })
      .catch((err) => setInviteError(err.message))
      .finally(() => setInviteLoading(false));
  }, [inviteToken]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = { email, password, name };
      if (inviteToken && inviteInfo) {
        payload.propertyInviteToken = inviteToken;
      } else {
        payload.organizationName = organizationName;
      }
      await signup(payload);
      // Residents route to /resident, others to /dashboard (AuthContext handles)
      navigate(inviteToken ? '/resident' : '/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Invite link — show resident signup form
  if (inviteToken) {
    if (inviteLoading) {
      return (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: '#8A8580' }}>Loading...</p>
        </div>
      );
    }
    if (inviteError) {
      return (
        <>
          <div className="auth-error">{inviteError}</div>
          <p className="auth-footer" style={{ marginTop: '1rem' }}>
            Contact your property manager for a new invitation link.
          </p>
        </>
      );
    }

    return (
      <>
        <form onSubmit={handleSubmit} className="auth-form">
          <h2>Welcome to {inviteInfo.propertyName}</h2>
          <p style={{ fontSize: '0.85rem', color: '#8A8580', marginTop: '-0.5rem', marginBottom: '1.25rem' }}>
            Create your resident account to get started.
          </p>

          {error && <div className="auth-error">{error}</div>}

          <label>
            Your name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              required
            />
          </label>

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
              placeholder="At least 8 characters"
              minLength={8}
              required
            />
          </label>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </>
    );
  }

  // Standard signup (OWNER)
  return (
    <>
      <form onSubmit={handleSubmit} className="auth-form">
        <h2>Create your account</h2>

        {error && <div className="auth-error">{error}</div>}

        <label>
          Your name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            required
          />
        </label>

        <label>
          Organization name
          <input
            type="text"
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            placeholder="Acme Coliving"
            required
          />
        </label>

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
            placeholder="At least 8 characters"
            minLength={8}
            required
          />
        </label>

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Creating account...' : 'Create account'}
        </button>
      </form>

      <div className="auth-divider">
        <span>or</span>
      </div>

      <a href="/api/auth/google" className="btn-google">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
          <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
        </svg>
        Sign up with Google
      </a>

      <p className="auth-footer">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </>
  );
}
