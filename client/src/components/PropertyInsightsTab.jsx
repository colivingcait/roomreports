import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const api = (path) =>
  fetch(path, { credentials: 'include' }).then(async (r) => {
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  });

const ICON = {
  warning: '⚠',
  opportunity: '↗',
  info: 'ⓘ',
};

export default function PropertyInsightsTab({ propertyId }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api(`/api/properties/${propertyId}/insights`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [propertyId]);

  if (loading) return <div className="ph-loading">Loading insights...</div>;
  if (error) return <div className="auth-error">{error}</div>;
  if (!data) return null;

  if (!data.insights || data.insights.length === 0) {
    return (
      <div className="pi-empty">
        <div className="pi-empty-check">✓</div>
        <p>No issues detected — this property is performing well.</p>
      </div>
    );
  }

  return (
    <div className="pi-tab">
      {data.insights.map((ins, i) => (
        <div key={i} className={`pi-card pi-card-${ins.kind}`}>
          <div className="pi-card-header">
            <span className={`pi-icon pi-icon-${ins.kind}`}>{ICON[ins.kind] || ICON.info}</span>
            <h3 className="pi-headline">{ins.headline}</h3>
          </div>
          <p className="pi-detail">{ins.detail}</p>
          <div className="pi-meta">
            <div className="pi-meta-row">
              <span className="pi-meta-label">Recommended action</span>
              <span className="pi-meta-value">{ins.action}</span>
            </div>
            <div className="pi-meta-row">
              <span className="pi-meta-label">Cost / effort</span>
              <span className="pi-meta-value">{ins.cost}</span>
            </div>
            <div className="pi-meta-row">
              <span className="pi-meta-label">Potential impact</span>
              <span className="pi-meta-value">{ins.impact}</span>
            </div>
          </div>
          {ins.link && (
            <button
              type="button"
              className="pi-link-btn"
              onClick={() => navigate(ins.link)}
            >
              {ins.linkLabel || 'View'} →
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
