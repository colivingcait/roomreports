import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import LogViolation from '../components/LogViolation';

const VIOLATION_TYPE_LABELS = {
  MESSY: 'Messy', BAD_ODOR: 'Bad odor', SMOKING: 'Smoking',
  UNAUTHORIZED_GUESTS: 'Unauthorized guests', PETS: 'Pets',
  OPEN_FOOD: 'Open food', PESTS: 'Pests/bugs',
  OPEN_FLAMES: 'Open flames/candles', KITCHEN_APPLIANCES: 'Kitchen appliances in room',
  LITHIUM_BATTERIES: 'Lithium batteries', MODIFICATIONS: 'Modifications',
  DRUG_PARAPHERNALIA: 'Drug paraphernalia', WEAPONS: 'Weapons', NOISE: 'Noise', OTHER: 'Other',
};

const ESCALATION_ORDER = ['FLAGGED', 'FIRST_WARNING', 'SECOND_WARNING', 'FINAL_NOTICE'];

const ESCALATION_STYLES = {
  FLAGGED:       { label: 'Flagged',       bg: '#F3F0EC', color: '#8A8583', border: '#C8C4C0' },
  FIRST_WARNING: { label: '1st Warning',   bg: '#FEF3C7', color: '#B45309', border: '#FDE68A' },
  SECOND_WARNING:{ label: '2nd Warning',   bg: '#FFEDD5', color: '#C2410C', border: '#FED7AA' },
  FINAL_NOTICE:  { label: 'Final Notice',  bg: '#FEE2E2', color: '#991B1B', border: '#FECACA' },
  RESOLVED:      { label: 'Resolved',      bg: '#DCFCE7', color: '#166534', border: '#BBF7D0' },
};

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function EscalationBadge({ level, resolved }) {
  const key = resolved ? 'RESOLVED' : (level || 'FLAGGED');
  const s = ESCALATION_STYLES[key] || ESCALATION_STYLES.FLAGGED;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>{s.label}</span>
  );
}

export default function Violations() {
  const navigate = useNavigate();
  const [violations, setViolations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState([]);
  const [showLog, setShowLog] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState('ACTIVE');
  const [filterType, setFilterType] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [filterProp, setFilterProp] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (filterType) params.set('violationType', filterType);
    if (filterLevel) params.set('escalationLevel', filterLevel);
    if (filterProp) params.set('propertyId', filterProp);
    if (filterStatus === 'all') params.set('includeArchived', 'false');
    try {
      const d = await api(`/api/violations?${params}`);
      setViolations(d.violations || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filterStatus, filterType, filterLevel, filterProp]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/properties', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setProperties(d.properties || []))
      .catch(() => {});
  }, []);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Lease Violations</h1>
          <p className="page-subtitle">{violations.length} record{violations.length === 1 ? '' : 's'}</p>
        </div>
        <button className="btn-primary" onClick={() => setShowLog(true)}>+ Log Violation</button>
      </div>

      {/* ── Filters ── */}
      <div className="filter-bar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <select className="filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="ACTIVE">Active</option>
          <option value="RESOLVED">Resolved</option>
          <option value="all">All</option>
        </select>
        <select className="filter-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(VIOLATION_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select className="filter-select" value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}>
          <option value="">All levels</option>
          {ESCALATION_ORDER.map((l) => (
            <option key={l} value={l}>{ESCALATION_STYLES[l]?.label || l}</option>
          ))}
        </select>
        {properties.length > 0 && (
          <select className="filter-select" value={filterProp} onChange={(e) => setFilterProp(e.target.value)}>
            <option value="">All properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {(filterType || filterLevel || filterProp || filterStatus !== 'ACTIVE') && (
          <button className="btn-text-sm" onClick={() => { setFilterStatus('ACTIVE'); setFilterType(''); setFilterLevel(''); setFilterProp(''); }}>
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="page-loading">Loading violations...</div>
      ) : violations.length === 0 ? (
        <div className="empty-state"><p>No violations found.</p></div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Room / Property</th>
                <th>Resident</th>
                <th>Violation Type</th>
                <th>Level</th>
                <th>Flagged</th>
                <th>Last Action</th>
              </tr>
            </thead>
            <tbody>
              {violations.map((v) => {
                const lastEntry = v.timelineEntries?.[0];
                return (
                  <tr
                    key={v.id}
                    onClick={() => navigate(`/violations/${v.id}`)}
                    style={{ cursor: 'pointer' }}
                    className="data-table-row"
                  >
                    <td>
                      <div style={{ fontWeight: 500 }}>{v.room?.label || 'Property'}</div>
                      <div style={{ fontSize: 12, color: '#8A8583' }}>{v.property?.name || '—'}</div>
                    </td>
                    <td>
                      {v.residentName || <span style={{ color: '#8A8583' }}>—</span>}
                      {v.isRepeat && (
                        <span style={{
                          marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 5px',
                          borderRadius: 3, background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A',
                        }}>REPEAT</span>
                      )}
                    </td>
                    <td>{v.typeLabel || v.category || '—'}</td>
                    <td><EscalationBadge level={v.escalationLevel} resolved={!!v.resolvedAt} /></td>
                    <td>{fmtDate(v.createdAt)}</td>
                    <td>{lastEntry ? fmtDate(lastEntry.date) : fmtDate(v.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <LogViolation
        open={showLog}
        onClose={() => setShowLog(false)}
        onCreated={() => { setShowLog(false); load(); }}
      />
    </div>
  );
}
