import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import UpgradeModal from '../components/UpgradeModal';
import { useFeatureGate } from '../hooks/useFeatureGate';

function initialsOf(name) {
  if (!name) return '?';
  return name.split(/\s+/).map((s) => s[0]).filter(Boolean).join('').toUpperCase().slice(0, 2);
}

function healthTone(open, viol) {
  if (open >= 3 || viol >= 3) return 'red';
  if (open > 0 || viol > 0) return 'yellow';
  return 'green';
}

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      return d;
    });

function fmtMoneyShort(n) {
  if (n == null || isNaN(n)) return '$0';
  return Number(n).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  });
}

function PropertyFinancialFooter({ summary, hasData }) {
  // Hide entirely if no financial data uploaded yet, OR this property
  // doesn't have a match — keeps the regular card uncluttered.
  if (!hasData || !summary) return null;
  const netClass = summary.netMonthly > 0 ? 'pcf-value-good'
    : summary.netMonthly < 0 ? 'pcf-value-bad' : '';
  return (
    <div className="prop-card-financials">
      <div className="pcf-row">
        <span className="pcf-label">Avg monthly</span>
        <span className="pcf-value">{fmtMoneyShort(summary.avgRevenue)}</span>
      </div>
      <div className="pcf-row">
        <span className="pcf-label">Maintenance</span>
        <span className="pcf-value">{fmtMoneyShort(summary.avgMaintenance)}</span>
      </div>
      <div className="pcf-row">
        <span className="pcf-label">Net</span>
        <span className={`pcf-value ${netClass}`}>{fmtMoneyShort(summary.netMonthly)}</span>
      </div>
    </div>
  );
}

function timeAgo(date) {
  if (!date) return null;
  const d = new Date(date);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function PropertyHealth() {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('attention');
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const navigate = useNavigate();
  const { limit, isBeta, gate, promptUpgrade, dismiss } = useFeatureGate();

  const [financials, setFinancials] = useState({ propertySummary: {}, hasData: false });

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      api('/api/properties?withHealth=true'),
      api('/api/financials/property-summary').catch(() => ({ propertySummary: {}, hasData: false })),
    ])
      .then(([d, f]) => {
        setProperties(d.properties || []);
        setFinancials(f || { propertySummary: {}, hasData: false });
      })
      .catch((err) => setError(err.message || 'Failed to load properties'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const needsAttention = (p) => {
    const open = p.health?.openMaintenanceCount || 0;
    const viol = p.health?.activeViolationCount || 0;
    return open >= 3 || viol >= 3;
  };

  const sorted = [...properties].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'open') {
      return (b.health?.openMaintenanceCount || 0) - (a.health?.openMaintenanceCount || 0);
    }
    if (sortBy === 'violations') {
      return (b.health?.activeViolationCount || 0) - (a.health?.activeViolationCount || 0);
    }
    // 'attention' default — needs-attention first, then by combined open + violations desc
    const aAtt = needsAttention(a) ? 1 : 0;
    const bAtt = needsAttention(b) ? 1 : 0;
    if (aAtt !== bAtt) return bAtt - aAtt;
    const aSum = (a.health?.openMaintenanceCount || 0) + (a.health?.activeViolationCount || 0);
    const bSum = (b.health?.openMaintenanceCount || 0) + (b.health?.activeViolationCount || 0);
    return bSum - aSum;
  });

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!name.trim() || !address.trim()) {
      setAddError('Name and address are required');
      return;
    }
    setSaving(true);
    setAddError('');
    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), address: address.trim() }),
      });
      const d = await res.json();
      if (!res.ok) {
        if (d.code === 'PLAN_LIMIT_PROPERTIES') {
          setShowAdd(false);
          setAddError('');
          promptUpgrade({
            feature: 'unlimitedProperties',
            title: 'Property limit reached',
            body: `Your plan allows ${d.limit} properties. Upgrade to add more.`,
          });
          return;
        }
        throw new Error(d.error || 'Failed to create property');
      }
      setShowAdd(false);
      setName('');
      setAddress('');
      load();
    } catch (err) {
      setAddError(err.message || 'Failed to create property');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page-loading">Loading properties...</div>;

  const propertyLimit = limit('properties');
  const atLimit = isFinite(propertyLimit) && properties.length >= propertyLimit;
  const usageLabel = isFinite(propertyLimit)
    ? `${properties.length} of ${propertyLimit} properties used`
    : `${properties.length} ${properties.length === 1 ? 'property' : 'properties'}`;

  const handleAddClick = () => {
    if (atLimit) {
      promptUpgrade({
        feature: 'unlimitedProperties',
        title: 'Property limit reached',
        body: `You're at your plan's limit of ${propertyLimit} properties. Upgrade to add more.`,
      });
    } else {
      setShowAdd(true);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Properties</h1>
          <p className="page-subtitle">{usageLabel}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select
            className="filter-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="attention">Sort: Needs attention</option>
            <option value="name">Sort: Name</option>
            <option value="open">Sort: Open maintenance</option>
            <option value="violations">Sort: Active violations</option>
          </select>
          <button
            className={`btn-primary-sm ${atLimit ? 'btn-at-limit' : ''}`}
            onClick={handleAddClick}
            title={atLimit ? 'Property limit reached — upgrade to add more' : 'Add a new property'}
          >
            + Add Property
          </button>
        </div>
      </div>

      {error && <div className="auth-error">{error}</div>}

      {sorted.length === 0 ? (
        <div className="empty-state">
          <p>No properties yet.</p>
          <button className="btn-primary-sm" onClick={() => setShowAdd(true)}>Add your first property</button>
        </div>
      ) : (
        <div className="prop-grid">
          {sorted.map((p) => {
            const open = p.health?.openMaintenanceCount || 0;
            const viol = p.health?.activeViolationCount || 0;
            const last = p.health?.lastInspection;
            const roomCount = p._count?.rooms || 0;
            const attention = needsAttention(p);
            const tone = healthTone(open, viol);
            const subtitle = last
              ? `${roomCount} room${roomCount === 1 ? '' : 's'} · Inspected ${timeAgo(last.date)}`
              : `${roomCount} room${roomCount === 1 ? '' : 's'} · Never inspected`;
            return (
              <button
                key={p.id}
                className={`prop-card prop-card-tone-${tone} ${attention ? 'prop-card-attention' : ''}`}
                onClick={() => navigate(`/properties/${p.id}/overview`)}
              >
                {attention && <span className="prop-card-pill">Needs attention</span>}
                <div className="prop-card-head-row">
                  {p.imageUrl ? (
                    <div className="prop-card-thumb">
                      <img src={p.imageUrl} alt="" />
                    </div>
                  ) : (
                    <div className="prop-card-thumb prop-card-thumb-initials">
                      {initialsOf(p.name)}
                    </div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="prop-card-name">{p.name}</div>
                    <div className="prop-card-subtitle">{subtitle}</div>
                  </div>
                </div>
                <PropertyFinancialFooter
                  summary={financials.propertySummary?.[p.id]}
                  hasData={financials.hasData}
                />
                <div className="prop-card-status">
                  {open === 0 && viol === 0 ? (
                    <span className="prop-status">
                      <span className="prop-status-dot prop-status-dot-good" />
                      <span className="prop-status-text">All clear</span>
                    </span>
                  ) : (
                    <>
                      {open > 0 && (
                        <span className="prop-status prop-status-big">
                          <span className="prop-status-dot prop-status-dot-open" />
                          <span className="prop-status-num">{open}</span>
                          <span className="prop-status-label">
                            open
                          </span>
                        </span>
                      )}
                      {viol > 0 && (
                        <span className="prop-status prop-status-big">
                          <span className="prop-status-dot prop-status-dot-violation" />
                          <span className="prop-status-num">{viol}</span>
                          <span className="prop-status-label">
                            violation{viol === 1 ? '' : 's'}
                          </span>
                        </span>
                      )}
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Modal
        open={showAdd}
        onClose={() => { if (!saving) { setShowAdd(false); setAddError(''); } }}
        title="Add Property"
      >
        <form className="modal-form" onSubmit={handleAdd}>
          <label>
            Name
            <input
              type="text"
              className="maint-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Meadowchase"
              autoFocus
            />
          </label>
          <label>
            Address
            <input
              type="text"
              className="maint-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, city, state"
            />
          </label>
          {addError && <div className="auth-error">{addError}</div>}
          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setShowAdd(false); setAddError(''); }}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={saving || !name.trim() || !address.trim()}
            >
              {saving ? 'Adding...' : 'Add Property'}
            </button>
          </div>
        </form>
      </Modal>

      <UpgradeModal
        open={gate.open}
        onClose={dismiss}
        feature={gate.feature}
        plan={gate.plan}
        title={gate.title}
        body={gate.body}
      />
    </div>
  );
}
