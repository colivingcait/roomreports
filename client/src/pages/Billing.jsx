import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  PLANS,
  PLAN_LABELS,
  PLAN_PRICES,
  PLAN_TAGLINES,
  FEATURE_META,
  FEATURES,
  PLAN_LIMITS,
} from '../../../shared/index.js';

const api = (path) =>
  fetch(path, { credentials: 'include' }).then(async (r) => {
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  });

// Which features each plan includes (for the comparison cards).
const STARTER_FEATURES = ['inspections', 'maintenance', 'residentLinks', 'offline', 'basicReports', 'toDo'];
const GROWTH_FEATURES = [...STARTER_FEATURES, 'vendors', 'teamScoping', 'customTemplates', 'fullReportsPDF', 'leaseViolations', 'unlimitedTeam'];
const OPERATOR_FEATURES = [...GROWTH_FEATURES, 'unlimitedProperties', 'batchWorkOrders', 'csvExport', 'prioritySupport'];

const PLAN_INCLUDES = {
  STARTER: STARTER_FEATURES,
  GROWTH: GROWTH_FEATURES,
  OPERATOR: OPERATOR_FEATURES,
};

export default function Billing() {
  const { organization } = useAuth();
  const [propertyCount, setPropertyCount] = useState(null);
  const [promo, setPromo] = useState('');
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState('');

  const plan = organization?.plan || 'STARTER';
  const isBeta = !!organization?.isBeta;

  useEffect(() => {
    api('/api/properties')
      .then((d) => setPropertyCount((d.properties || []).length))
      .catch(() => setPropertyCount(0));
  }, []);

  const handleApply = (e) => {
    e.preventDefault();
    if (!promo.trim()) return;
    setApplying(true);
    setMessage('');
    try {
      const stored = JSON.parse(localStorage.getItem('roomreport:promoCodes') || '[]');
      stored.push({ code: promo.trim(), at: new Date().toISOString() });
      localStorage.setItem('roomreport:promoCodes', JSON.stringify(stored));
      setMessage(`Promo code "${promo.trim()}" saved — we'll apply it when billing launches.`);
      setPromo('');
    } catch {
      setMessage('Could not save promo code.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Billing</h1>
          <p className="page-subtitle">Your plan and subscription</p>
        </div>
      </div>

      {/* Current plan */}
      <div className={`billing-banner ${isBeta ? '' : 'billing-banner-paid'}`}>
        <div className="billing-banner-tag">
          {isBeta ? 'Beta Access' : 'Current Plan'}
        </div>
        <h2 className="billing-banner-title">
          {isBeta ? 'All features unlocked' : PLAN_LABELS[plan]}
        </h2>
        <p className="billing-banner-body">
          {isBeta
            ? "You're in the beta program — nothing to pay, and every feature is turned on."
            : `${PLAN_TAGLINES[plan]}. ${PLAN_PRICES[plan]}.`}
        </p>
        <div className="billing-banner-stat">
          Current:
          <strong>
            {' '}
            {propertyCount ?? '—'} propert{propertyCount === 1 ? 'y' : 'ies'}
            {!isBeta && PLAN_LIMITS[plan]?.properties !== Infinity && (
              <> of {PLAN_LIMITS[plan].properties}</>
            )}
          </strong>
        </div>
      </div>

      {/* Compare plans */}
      <div className="billing-section">
        <h3 className="md-section-title">
          {isBeta ? 'Pricing (when billing launches)' : 'Plans'}
        </h3>
        <div className="billing-plans">
          {PLANS.map((p) => {
            const isCurrent = !isBeta && p === plan;
            const includes = PLAN_INCLUDES[p] || [];
            return (
              <div
                key={p}
                className={`billing-plan-card ${isCurrent ? 'billing-plan-card-current' : ''}`}
              >
                <div className="billing-plan-card-head">
                  <div className="billing-plan-name">{PLAN_LABELS[p]}</div>
                  {isCurrent && <span className="billing-plan-current-pill">Current</span>}
                </div>
                <div className="billing-plan-price">{PLAN_PRICES[p]}</div>
                <div className="billing-plan-desc">{PLAN_TAGLINES[p]}</div>
                <ul className="billing-plan-features">
                  {includes.map((f) => (
                    <li key={f}>
                      <span className="billing-check">&#10003;</span>
                      {FEATURE_META[f]?.label || f}
                    </li>
                  ))}
                </ul>
                {!isCurrent && !isBeta && (
                  <button
                    className="btn-primary-sm billing-plan-upgrade-btn"
                    onClick={() => setMessage(`Self-serve upgrade launches soon — email hello@roomreport.co to move to ${PLAN_LABELS[p]} now.`)}
                  >
                    Upgrade to {PLAN_LABELS[p]}
                  </button>
                )}
                {isBeta && (
                  <div className="billing-plan-beta-note">Included during beta</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="billing-section">
        <h3 className="md-section-title">Promo code</h3>
        <p className="empty-text" style={{ marginTop: 0 }}>
          Got a beta or referral code? Enter it here and we&apos;ll apply it when billing launches.
        </p>
        <form className="billing-promo-form" onSubmit={handleApply}>
          <input
            type="text"
            className="maint-input"
            value={promo}
            onChange={(e) => setPromo(e.target.value)}
            placeholder="Enter promo code"
          />
          <button
            type="submit"
            className="btn-primary-sm"
            disabled={applying || !promo.trim()}
          >
            {applying ? 'Applying...' : 'Apply'}
          </button>
        </form>
        {message && <div className="empty-text" style={{ color: '#3B6D11', marginTop: '0.5rem' }}>{message}</div>}
      </div>

      <div className="billing-section">
        <h3 className="md-section-title">Questions?</h3>
        <p>
          Email{' '}
          <a className="billing-link" href="mailto:hello@roomreport.co">hello@roomreport.co</a>
          {' '}— we reply same-day.
        </p>
      </div>
    </div>
  );
}
