import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function JoinSlug() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/auth/join/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Not found');
        navigate(`/signup?invite=${data.token}`, { replace: true });
      })
      .catch((err) => setError(err.message));
  }, [slug, navigate]);

  if (error) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <h1><span className="brand-room">Room</span><span className="brand-report">Report</span></h1>
          </div>
          <div className="auth-error">{error}</div>
          <p className="auth-footer" style={{ marginTop: '1rem' }}>
            Ask your property manager for the correct link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <p style={{ color: '#8A8580' }}>Loading...</p>
      </div>
    </div>
  );
}
