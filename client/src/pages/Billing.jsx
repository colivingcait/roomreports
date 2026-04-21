import { useState, useEffect } from 'react';

const api = (path) =>
  fetch(path, { credentials: 'include' }).then(async (r) => {
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  });

const PLANS = [
  { name: 'Starter', price: '$19/mo', desc: 'Up to 2 properties' },
  { name: 'Growth', price: '$39/mo', desc: 'Up to 5 properties' },
  { name: 'Unlimited', price: '$79/mo', desc: 'Unlimited properties' },
];

export default function Billing() {
  const [propertyCount, setPropertyCount] = useState(null);
  const [promo, setPromo] = useState('');
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState('');

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
    // Stored locally for now — wires to Stripe once billing launches.
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

      <div className="billing-banner">
        <div className="billing-banner-tag">Beta Access</div>
        <h2 className="billing-banner-title">All features unlocked</h2>
        <p className="billing-banner-body">
          You&apos;re in the beta program — nothing to pay, and every feature is turned on.
          When billing launches, your plan will be based on your property count.
        </p>
        <div className="billing-banner-stat">
          Current:
          <strong> {propertyCount ?? '—'} propert{propertyCount === 1 ? 'y' : 'ies'}</strong>
        </div>
      </div>

      <div className="billing-section">
        <h3 className="md-section-title">Pricing (when billing launches)</h3>
        <div className="billing-plans">
          {PLANS.map((p) => (
            <div key={p.name} className="billing-plan">
              <div className="billing-plan-name">{p.name}</div>
              <div className="billing-plan-price">{p.price}</div>
              <div className="billing-plan-desc">{p.desc}</div>
            </div>
          ))}
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
