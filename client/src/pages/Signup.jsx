import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roleLabel } from '../../../shared/index.js';

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const propertyInviteToken = searchParams.get('token');
  const teamInviteToken = searchParams.get('invite');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [propertyInviteInfo, setPropertyInviteInfo] = useState(null);
  const [propertyInviteLoading, setPropertyInviteLoading] = useState(!!propertyInviteToken);
  const [propertyInviteError, setPropertyInviteError] = useState('');

  const [teamInviteInfo, setTeamInviteInfo] = useState(null);
  const [teamInviteLoading, setTeamInviteLoading] = useState(!!teamInviteToken);
  const [teamInviteError, setTeamInviteError] = useState('');

  useEffect(() => {
    if (!propertyInviteToken) return;
    fetch(`/api/auth/property-invite/${propertyInviteToken}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setPropertyInviteInfo(data);
      })
      .catch((err) => setPropertyInviteError(err.message))
      .finally(() => setPropertyInviteLoading(false));
  }, [propertyInviteToken]);

  useEffect(() => {
    if (!teamInviteToken) return;
    fetch(`/api/auth/invite/${teamInviteToken}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setTeamInviteInfo(data);
        if (data.email) setEmail(data.email);
        if (data.name) setName(data.name);
      })
      .catch((err) => setTeamInviteError(err.message))
      .finally(() => setTeamInviteLoading(false));
  }, [teamInviteToken]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = { email, password, name };
      if (teamInviteToken && teamInviteInfo) {
        payload.teamInviteToken = teamInviteToken;
      } else if (propertyInviteToken && propertyInviteInfo) {
        payload.propertyInviteToken = propertyInviteToken;
      } else {
        payload.organizationName = organizationName;
      }
      await signup(payload);
      navigate(propertyInviteToken ? '/resident' : '/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Team invite signup ─────────────────────────────────
  if (teamInviteToken) {
    if (teamInviteLoading) {
      return (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: '#8A8583' }}>Loading invite...</p>
        </div>
      );
    }
    if (teamInviteError) {
      return (
        <>
          <h2>Invitation link</h2>
          <div className="auth-error">{teamInviteError}</div>
          <p className="auth-footer" style={{ marginTop: '1rem' }}>
            Ask whoever invited you for a new link.
          </p>
        </>
      );
    }
    if (teamInviteInfo.status === 'EXPIRED') {
      return (
        <>
          <h2>This invitation has expired</h2>
          <p style={{ color: '#8A8583', fontSize: '0.9rem' }}>
            Ask your Owner or Property Manager to resend the invite from the Team page.
          </p>
          <p className="auth-footer" style={{ marginTop: '1rem' }}>
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </>
      );
    }
    if (teamInviteInfo.status === 'REVOKED') {
      return (
        <>
          <h2>This invitation was revoked</h2>
          <p style={{ color: '#8A8583', fontSize: '0.9rem' }}>
            Contact your Owner or Property Manager if you think this is a mistake.
          </p>
        </>
      );
    }
    if (teamInviteInfo.status === 'ACCEPTED') {
      return (
        <>
          <h2>This invitation was already accepted</h2>
          <p className="auth-footer">
            <Link to="/login">Sign in instead</Link>
          </p>
        </>
      );
    }

    const roleHuman = roleLabel(teamInviteInfo.role, teamInviteInfo.customRole);

    // Existing-user path: send them to login with the invite token in
    // the redirect; the login flow accepts the invite via
    // /api/team/invitations/:token/accept-as-existing once they're
    // signed in.
    if (teamInviteInfo.existingUser) {
      const next = `/login?invite=${encodeURIComponent(teamInviteToken)}`;
      return (
        <>
          <h2>Join {teamInviteInfo.organizationName}</h2>
          <p style={{ fontSize: '0.9rem', color: '#5A5550', marginTop: '-0.25rem', marginBottom: '1.25rem' }}>
            You already have a RoomReport account.
            {teamInviteInfo.inviterName ? ` ${teamInviteInfo.inviterName} invited you` : ' You\'ve been invited'}
            {' '}as a {roleHuman}.
          </p>
          <p style={{ fontSize: '0.8rem', color: '#8A8583', marginBottom: '1.25rem' }}>
            Sign in with <strong>{teamInviteInfo.email}</strong> to add this organization to your account.
          </p>
          <Link to={next} className="btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            Sign in to accept
          </Link>
        </>
      );
    }

    return (
      <>
        <form onSubmit={handleSubmit} className="auth-form">
          <h2>Join {teamInviteInfo.organizationName}</h2>
          <p style={{ fontSize: '0.85rem', color: '#8A8583', marginTop: '-0.5rem', marginBottom: '1.25rem' }}>
            {teamInviteInfo.inviterName
              ? `${teamInviteInfo.inviterName} invited you as a ${roleHuman}.`
              : `You've been invited as a ${roleHuman}.`}
            {' '}Set a password to create your account.
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
              disabled
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
              autoFocus
            />
          </label>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Creating account...' : 'Accept invite & sign in'}
          </button>
        </form>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <a href={`/api/auth/google?invite=${encodeURIComponent(teamInviteToken)}`} className="btn-google">
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

  // ─── Property invite (resident) signup ──────────────────
  if (propertyInviteToken) {
    if (propertyInviteLoading) {
      return (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: '#8A8583' }}>Loading...</p>
        </div>
      );
    }
    if (propertyInviteError) {
      return (
        <>
          <div className="auth-error">{propertyInviteError}</div>
          <p className="auth-footer" style={{ marginTop: '1rem' }}>
            Contact your property manager for a new invitation link.
          </p>
        </>
      );
    }

    return (
      <>
        <form onSubmit={handleSubmit} className="auth-form">
          <h2>Welcome to {propertyInviteInfo.propertyName}</h2>
          <p style={{ fontSize: '0.85rem', color: '#8A8583', marginTop: '-0.5rem', marginBottom: '1.25rem' }}>
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

  // ─── Standard signup (creates new OWNER org) ────────────
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
