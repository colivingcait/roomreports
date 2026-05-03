import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import LogViolation from './LogViolation';

const VIOLATION_TYPE_LABELS = {
  MESSY: 'Messy', BAD_ODOR: 'Bad odor', SMOKING: 'Smoking',
  UNAUTHORIZED_GUESTS: 'Unauthorized guests', PETS: 'Pets',
  OPEN_FOOD: 'Open food', PESTS: 'Pests/bugs',
  OPEN_FLAMES: 'Open flames/candles', KITCHEN_APPLIANCES: 'Kitchen appliances in room',
  LITHIUM_BATTERIES: 'Lithium batteries', MODIFICATIONS: 'Modifications',
  DRUG_PARAPHERNALIA: 'Drug paraphernalia', WEAPONS: 'Weapons', NOISE: 'Noise', OTHER: 'Other',
};

const ESCALATION_STYLES = {
  FLAGGED:       { label: 'Flagged',       bg: '#F3F0EC', color: '#8A8583', border: '#C8C4C0' },
  FIRST_WARNING: { label: '1st Warning',   bg: '#FEF3C7', color: '#B45309', border: '#FDE68A' },
  SECOND_WARNING:{ label: '2nd Warning',   bg: '#FFEDD5', color: '#C2410C', border: '#FED7AA' },
  FINAL_NOTICE:  { label: 'Final Notice',  bg: '#FEE2E2', color: '#991B1B', border: '#FECACA' },
  RESOLVED:      { label: 'Resolved',      bg: '#DCFCE7', color: '#166534', border: '#BBF7D0' },
};

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

export default function PropertyViolationsTab({ propertyId }) {
  const navigate = useNavigate();
  const [violations, setViolations] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('ACTIVE');
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ propertyId });
    if (filterStatus !== 'all') params.set('status', filterStatus);
    try {
      const r = await fetch(`/api/violations?${params}`, { credentials: 'include' });
      const d = await r.json();
      setViolations(d.violations || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [propertyId, filterStatus]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch(`/api/properties/${propertyId}/overview`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setRooms(d.rooms || []))
      .catch(() => {});
  }, [propertyId]);

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <select className="filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="ACTIVE">Active</option>
          <option value="RESOLVED">Resolved</option>
          <option value="all">All</option>
        </select>
        <button className="btn-primary-sm" onClick={() => setShowLog(true)}>+ Log Violation</button>
      </div>

      {loading ? (
        <div className="page-loading" style={{ padding: 16 }}>Loading...</div>
      ) : violations.length === 0 ? (
        <p className="empty-text">No violations{filterStatus !== 'all' ? ' in this view' : ''}.</p>
      ) : (
        <div className="po-flat-list">
          {violations.map((v) => (
            <div
              key={v.id}
              className="po-flat-row"
              onClick={() => navigate(`/violations/${v.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <div className="po-flat-row-main">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="po-flat-desc">
                    {v.typeLabel || VIOLATION_TYPE_LABELS[v.violationType] || v.category || 'Violation'}
                  </span>
                  {v.isRepeat && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                      background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A',
                    }}>REPEAT</span>
                  )}
                </div>
                <span className="po-dim">
                  {v.room?.label || 'Property'}
                  {v.residentName && ` · ${v.residentName}`}
                  {' · '}{fmtDate(v.createdAt)}
                </span>
              </div>
              <EscalationBadge level={v.escalationLevel} resolved={!!v.resolvedAt} />
            </div>
          ))}
        </div>
      )}

      <LogViolation
        open={showLog}
        onClose={() => setShowLog(false)}
        propertyId={propertyId}
        rooms={rooms}
        onCreated={() => { setShowLog(false); load(); }}
      />
    </div>
  );
}
