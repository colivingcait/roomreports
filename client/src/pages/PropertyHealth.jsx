import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import UpgradeModal from '../components/UpgradeModal';
import { useFeatureGate } from '../hooks/useFeatureGate';

function initialsOf(name) {
  if (!name) return '?';
  return name.split(/\s+/).map((s) => s[0]).filter(Boolean).join('').toUpperCase().slice(0, 2);
}

// Six-color rotation for the initials square. Assigned by property
// index so the same property always lands on the same color.
const INITIALS_PALETTE = [
  { bg: '#E1F5EE', fg: '#085041' }, // teal
  { bg: '#EEEDFE', fg: '#3C3489' }, // purple
  { bg: '#FAECE7', fg: '#712B13' }, // coral
  { bg: '#FAEEDA', fg: '#633806' }, // amber
  { bg: '#E6F1FB', fg: '#0C447C' }, // blue
  { bg: '#EAF3DE', fg: '#27500A' }, // green
];

function fmtInspectionDate(date) {
  if (!date) return null;
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      return d;
    });

export default function PropertyHealth() {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const navigate = useNavigate();
  const { limit, gate, promptUpgrade, dismiss } = useFeatureGate();

  const load = () => {
    setLoading(true);
    setError('');
    api('/api/properties?withHealth=true')
      .then((d) => setProperties(d.properties || []))
      .catch((err) => setError(err.message || 'Failed to load properties'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Default + only sort: alphabetical by property name. Properties is
  // a navigation selector, not a dashboard.
  const sorted = [...properties].sort((a, b) => a.name.localeCompare(b.name));

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
          <p className="page-subtitle">
            {properties.length} {properties.length === 1 ? 'property' : 'properties'}
          </p>
        </div>
        <button
          className="btn-outline-sm"
          onClick={handleAddClick}
          title={atLimit ? 'Property limit reached — upgrade to add more' : 'Add a new property'}
        >
          + Add property
        </button>
      </div>

      {error && <div className="auth-error">{error}</div>}

      {sorted.length === 0 ? (
        <div className="empty-state">
          <p>No properties yet.</p>
          <button className="btn-outline-sm" onClick={handleAddClick}>Add your first property</button>
        </div>
      ) : (
        <div className="props-grid">
          {sorted.map((p, idx) => {
            const open = p.health?.openMaintenanceCount || 0;
            const last = p.health?.lastInspection;
            const roomCount = p._count?.rooms || 0;
            const palette = INITIALS_PALETTE[idx % INITIALS_PALETTE.length];
            const dotColor = open >= 5 ? '#E24B4A' : open > 0 ? '#BA7517' : '#639922';
            const dotLabel = open === 0 ? 'All clear' : `${open} open`;
            const inspectionLabel = last ? fmtInspectionDate(last.date) : 'Never inspected';
            return (
              <button
                key={p.id}
                className="props-card"
                onClick={() => navigate(`/properties/${p.id}/overview`)}
              >
                <div className="props-card-head">
                  <div
                    className="props-card-initials"
                    style={{ background: palette.bg, color: palette.fg }}
                  >
                    {initialsOf(p.name)}
                  </div>
                  <div className="props-card-id">
                    <div className="props-card-name">{p.name}</div>
                    <div className="props-card-rooms">
                      {roomCount} {roomCount === 1 ? 'room' : 'rooms'}
                    </div>
                  </div>
                </div>
                <div className="props-card-divider" />
                <div className="props-card-foot">
                  <span className="props-card-status">
                    <span className="props-card-dot" style={{ background: dotColor }} />
                    {dotLabel}
                  </span>
                  <span className={`props-card-inspected ${last ? '' : 'props-card-inspected-never'}`}>
                    {inspectionLabel}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Modal
        open={showAdd}
        onClose={() => { if (!saving) { setShowAdd(false); setAddError(''); } }}
        title="Add property"
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
              {saving ? 'Adding...' : 'Add property'}
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
