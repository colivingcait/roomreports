import { useState, useEffect, useCallback, useMemo } from 'react';
import LogViolation from './LogViolation';
import ViolationDetailSlideover from './ViolationDetailSlideover';

const VIOLATION_TYPE_LABELS = {
  MESSY: 'Messy', BAD_ODOR: 'Bad odor', SMOKING: 'Smoking',
  UNAUTHORIZED_GUESTS: 'Unauthorized guests', PETS: 'Pets',
  OPEN_FOOD: 'Open food', PESTS: 'Pests/bugs',
  OPEN_FLAMES: 'Open flames/candles', OVERLOADED_OUTLETS: 'Overloaded outlets',
  KITCHEN_APPLIANCES: 'Kitchen appliances in room',
  LITHIUM_BATTERIES: 'Lithium batteries', MODIFICATIONS: 'Modifications',
  DRUG_PARAPHERNALIA: 'Drug paraphernalia', WEAPONS: 'Weapons',
  UNCLEAR_EGRESS: 'Unclear egress path', NOISE: 'Noise', OTHER: 'Other',
};

const ESCALATION_LABELS = {
  FLAGGED: 'Flagged',
  FIRST_WARNING: '1st Warning',
  SECOND_WARNING: '2nd Warning',
  FINAL_NOTICE: 'Final Notice',
  RESOLVED: 'Resolved',
};
const ESCALATION_COLORS = {
  FLAGGED:        '#8A8580',
  FIRST_WARNING:  '#BA7517',
  SECOND_WARNING: '#C0392B',
  FINAL_NOTICE:   '#A02420',
  RESOLVED:       '#2F7A48',
};
const ESCALATION_WEIGHT = {
  FINAL_NOTICE: 4, SECOND_WARNING: 3, FIRST_WARNING: 2, FLAGGED: 1,
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function EscalationBadge({ level, resolved }) {
  const key = resolved ? 'RESOLVED' : (level || 'FLAGGED');
  const color = ESCALATION_COLORS[key] || ESCALATION_COLORS.FLAGGED;
  return (
    <span
      className="md-modal-badge"
      style={{ color, borderColor: color }}
    >
      {ESCALATION_LABELS[key] || key}
    </span>
  );
}

function SortHeader({ label, field, sortField, sortDir, onSort }) {
  const active = sortField === field;
  const arrow = active ? (sortDir === 'asc' ? '↑' : '↓') : '';
  return (
    <th
      onClick={() => onSort(field)}
      className={active ? 'fin-th-sorted' : ''}
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      {label} {arrow}
    </th>
  );
}

export default function PropertyViolationsTab({ propertyId }) {
  const [violations, setViolations] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('ACTIVE');
  const [filterType, setFilterType] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [viewingId, setViewingId] = useState(null);
  const [sortField, setSortField] = useState('default');
  const [sortDir, setSortDir] = useState('asc');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ propertyId });
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (filterType) params.set('violationType', filterType);
    try {
      const r = await fetch(`/api/violations?${params}`, { credentials: 'include' });
      const d = await r.json();
      setViolations(d.violations || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [propertyId, filterStatus, filterType]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch(`/api/properties/${propertyId}/overview`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setRooms(d.rooms || []))
      .catch(() => {});
  }, [propertyId]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    const arr = [...violations];
    if (sortField === 'default') {
      arr.sort((a, b) => {
        const aActive = a.resolvedAt ? 1 : 0;
        const bActive = b.resolvedAt ? 1 : 0;
        if (aActive !== bActive) return aActive - bActive;
        const aw = ESCALATION_WEIGHT[a.escalationLevel] || 0;
        const bw = ESCALATION_WEIGHT[b.escalationLevel] || 0;
        if (aw !== bw) return bw - aw;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      return arr;
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av, bv;
      switch (sortField) {
        case 'room': av = a.room?.label || ''; bv = b.room?.label || ''; break;
        case 'resident': av = a.residentName || ''; bv = b.residentName || ''; break;
        case 'type': av = a.typeLabel || a.category || ''; bv = b.typeLabel || b.category || ''; break;
        case 'level':
          av = ESCALATION_WEIGHT[a.escalationLevel] || 0;
          bv = ESCALATION_WEIGHT[b.escalationLevel] || 0;
          break;
        case 'flagged': av = new Date(a.createdAt); bv = new Date(b.createdAt); break;
        case 'lastAction': {
          const al = a.timelineEntries?.[0]?.date || a.createdAt;
          const bl = b.timelineEntries?.[0]?.date || b.createdAt;
          av = new Date(al); bv = new Date(bl);
          break;
        }
        case 'status': av = a.resolvedAt ? 1 : 0; bv = b.resolvedAt ? 1 : 0; break;
        default: return 0;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [violations, sortField, sortDir]);

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
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
        <div style={{ flex: 1 }} />
        <button className="btn-primary-sm" onClick={() => setShowLog(true)}>+ Log Violation</button>
      </div>

      {loading ? (
        <div className="page-loading" style={{ padding: 16 }}>Loading...</div>
      ) : sorted.length === 0 ? (
        <div className="empty-state" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          <p className="empty-text">No violations recorded.</p>
          <button className="btn-primary-sm" onClick={() => setShowLog(true)} style={{ marginTop: 8 }}>
            + Log Violation
          </button>
        </div>
      ) : (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <SortHeader label="Room" field="room" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Resident" field="resident" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Type" field="type" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Level" field="level" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Flagged" field="flagged" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Last Action" field="lastAction" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((v) => {
                const lastEntry = v.timelineEntries?.[0];
                return (
                  <tr
                    key={v.id}
                    className="fin-row-clickable"
                    onClick={() => setViewingId(v.id)}
                  >
                    <td>{v.room?.label || <span className="fin-muted">Property-wide</span>}</td>
                    <td>{v.residentName || <span className="fin-muted">—</span>}</td>
                    <td>{v.typeLabel || VIOLATION_TYPE_LABELS[v.violationType] || v.category || '—'}</td>
                    <td><EscalationBadge level={v.escalationLevel} resolved={!!v.resolvedAt} /></td>
                    <td>{fmtDate(v.createdAt)}</td>
                    <td>{lastEntry ? fmtDate(lastEntry.date) : fmtDate(v.createdAt)}</td>
                    <td>{v.resolvedAt ? 'Resolved' : 'Active'}</td>
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
        propertyId={propertyId}
        rooms={rooms}
        onCreated={() => { setShowLog(false); load(); }}
      />

      {viewingId && (
        <ViolationDetailSlideover
          violationId={viewingId}
          onClose={() => setViewingId(null)}
          onUpdated={load}
        />
      )}
    </div>
  );
}
