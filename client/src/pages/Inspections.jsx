import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import StartInspection from '../components/StartInspection';
import RoomHistory from '../components/RoomHistory';

const TYPE_LABELS = {
  COMMON_AREA: 'Common Area', ROOM_TURN: 'Room Turn', QUARTERLY: 'Quarterly',
  RESIDENT_SELF_CHECK: 'Self-Check', MOVE_IN_OUT: 'Move-In/Out',
};
const STATUS_COLORS = { DRAFT: '#C4703F', SUBMITTED: '#6B8F71', REVIEWED: '#8A8583' };

function timeAgo(date) {
  const d = new Date(date);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Inspections() {
  const navigate = useNavigate();
  const location = useLocation();
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showStart, setShowStart] = useState(false);
  const [notification] = useState(location.state?.notification || '');

  // Filters
  const [properties, setProperties] = useState([]);
  const [filterProperty, setFilterProperty] = useState('');
  const [filterRoom, setFilterRoom] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [rooms, setRooms] = useState([]);

  // Load properties
  useEffect(() => {
    fetch('/api/properties', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setProperties(d.properties || []));
  }, []);

  // Load rooms when property changes
  useEffect(() => {
    if (filterProperty) {
      fetch(`/api/properties/${filterProperty}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => setRooms(d.property?.rooms || []));
    } else {
      setRooms([]);
      setFilterRoom('');
    }
  }, [filterProperty]);

  // Fetch inspections with filters
  useEffect(() => {
    const params = new URLSearchParams();
    if (filterProperty) params.set('propertyId', filterProperty);
    if (filterRoom) params.set('roomId', filterRoom);
    if (filterType) params.set('type', filterType);
    if (filterStatus) params.set('status', filterStatus);

    setLoading(true);
    fetch(`/api/inspections?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setInspections(d.inspections || []))
      .finally(() => setLoading(false));
  }, [filterProperty, filterRoom, filterType, filterStatus]);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Inspections</h1>
          <p className="page-subtitle">{inspections.length} inspection{inspections.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary-sm" onClick={() => setShowStart(true)}>
          + New Inspection
        </button>
      </div>

      {notification && (
        <div className="notification-bar">{notification}</div>
      )}

      {/* Filter bar */}
      <div className="insp-filters">
        <select className="filter-select" value={filterProperty} onChange={(e) => { setFilterProperty(e.target.value); setFilterRoom(''); }}>
          <option value="">All Properties</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {rooms.length > 0 && (
          <select className="filter-select" value={filterRoom} onChange={(e) => setFilterRoom(e.target.value)}>
            <option value="">All Rooms</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        )}

        <select className="filter-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        <select className="filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="REVIEWED">Reviewed</option>
        </select>

        {(filterProperty || filterType || filterStatus || filterRoom) && (
          <button
            className="btn-text-sm"
            onClick={() => { setFilterProperty(''); setFilterRoom(''); setFilterType(''); setFilterStatus(''); }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Room history view when a specific room is selected */}
      {filterRoom && (
        <RoomHistory roomId={filterRoom} />
      )}

      {/* Inspections list */}
      {loading ? (
        <div className="page-loading">Loading...</div>
      ) : inspections.length === 0 ? (
        <div className="empty-state">
          <p>No inspections match your filters</p>
          <button className="btn-primary-sm" onClick={() => setShowStart(true)}>Start an inspection</button>
        </div>
      ) : (
        <div className="insp-history-list">
          {inspections.map((insp) => (
            <div
              key={insp.id}
              className="insp-history-row"
              onClick={() => navigate(
                insp.status === 'DRAFT'
                  ? `/inspections/${insp.id}`
                  : `/inspections/${insp.id}/review`,
              )}
            >
              <div className="insp-history-left">
                <span className="dash-type-badge">{TYPE_LABELS[insp.type] || insp.type}</span>
                <div className="insp-history-info">
                  <span className="insp-history-prop">
                    {insp.property?.name}{insp.room ? ` — ${insp.room.label}` : ''}
                  </span>
                  <span className="insp-history-inspector">
                    {insp.inspectorName || 'Unknown'} &middot; {timeAgo(insp.createdAt)}
                  </span>
                </div>
              </div>
              <div className="insp-history-right">
                {(insp._count?.items > 0 || insp.flagCount > 0) && (
                  <span className="insp-history-items">{insp._count?.items || 0} items</span>
                )}
                <span
                  className="insp-status-badge"
                  style={{ color: STATUS_COLORS[insp.status], borderColor: STATUS_COLORS[insp.status] }}
                >
                  {insp.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <StartInspection open={showStart} onClose={() => setShowStart(false)} />
    </div>
  );
}
