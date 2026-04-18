import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import StartInspection from '../components/StartInspection';

const TYPE_LABELS = {
  COMMON_AREA: 'Common Area', ROOM_TURN: 'Room Turn', QUARTERLY: 'Quarterly',
  RESIDENT_SELF_CHECK: 'Self-Check', MOVE_IN_OUT: 'Move-In/Out',
};

const MAINT_STATUS_COLORS = { OPEN: '#C4703F', ASSIGNED: '#6B8F71', IN_PROGRESS: '#C9A84C' };
const MAINT_STATUS_LABELS = { OPEN: 'Open', ASSIGNED: 'Assigned', IN_PROGRESS: 'In Progress' };
const HEALTH_COLORS = { green: '#6B8F71', yellow: '#C9A84C', red: '#C4703F' };
const HEALTH_LABELS = { green: 'Healthy', yellow: 'Watch', red: 'Needs Attention' };

function timeAgo(date) {
  if (!date) return 'Never';
  const d = new Date(date);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function healthBarColor(count) {
  if (count >= 6) return '#C4703F';
  if (count >= 3) return '#C9A84C';
  return '#6B8F71';
}

export default function PropertyOverview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showStart, setShowStart] = useState(false);

  useEffect(() => {
    fetch(`/api/properties/${id}/overview`, { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="page-loading">Loading property...</div>;
  if (!data || !data.property) return <div className="page-container"><div className="auth-error">Property not found</div></div>;

  const { property, health, totalOpenMaintenance, roomCards, maintenanceByRoom, recentInspections, commonArea, overdueRooms } = data;

  const caStatus = commonArea.daysSince === null ? 'red'
    : commonArea.daysSince <= 30 ? 'green'
    : commonArea.daysSince <= 60 ? 'yellow' : 'red';

  return (
    <div className="page-container">
      {/* Breadcrumb */}
      <div className="po-breadcrumb">
        <Link to="/dashboard">Dashboard</Link>
        <span> / </span>
        <span>{property.name}</span>
      </div>

      {/* Header */}
      <div className="po-header">
        <div className="po-header-left">
          <h1>{property.name}</h1>
          <p className="po-address">{property.address}</p>
          <div className="po-stats">
            <span>{property.roomCount} room{property.roomCount !== 1 ? 's' : ''}</span>
            <span className="dot" />
            <span>{property.kitchenCount} kitchen{property.kitchenCount !== 1 ? 's' : ''}</span>
            <span className="dot" />
            <span>{property.bathroomCount} bath{property.bathroomCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="po-header-right">
          <div className="po-health-badge" style={{ color: HEALTH_COLORS[health], borderColor: HEALTH_COLORS[health] }}>
            <div className="po-health-dot" style={{ background: HEALTH_COLORS[health] }} />
            {HEALTH_LABELS[health]}
          </div>
          <div className="po-header-actions">
            <button className="btn-text-sm" onClick={() => navigate(`/properties/${id}`)}>Edit Property</button>
            <button className="btn-primary-sm" onClick={() => setShowStart(true)}>+ New Inspection</button>
          </div>
        </div>
      </div>

      {/* ─── ROOM GRID ─── */}
      <section className="po-section">
        <h2 className="po-section-title">Rooms</h2>
        <div className="po-room-grid">
          {roomCards.map((room) => (
            <div key={room.id} className="po-room-card">
              <div className="po-room-health-bar" style={{ background: healthBarColor(room.openMaintenanceCount) }} />
              <div className="po-room-body">
                <h3 className="po-room-label">{room.label}</h3>
                <div className="po-room-meta">
                  {room.openMaintenanceCount > 0 ? (
                    <span className="po-room-issues" style={{ color: '#C4703F' }}>
                      {room.openMaintenanceCount} open issue{room.openMaintenanceCount !== 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span style={{ color: '#6B8F71' }}>No issues</span>
                  )}
                  <span className="dot" />
                  <span>
                    {room.lastInspection
                      ? `${TYPE_LABELS[room.lastInspection.type] || room.lastInspection.type} ${timeAgo(room.lastInspection.date)}`
                      : 'Never inspected'}
                  </span>
                </div>
                {room.features?.length > 0 && (
                  <div className="po-room-features">
                    {room.features.map((f) => (
                      <span key={f} className="po-feature-tag">{f}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="po-split">
        {/* ─── OPEN MAINTENANCE BY ROOM ─── */}
        <section className="po-section">
          <h2 className="po-section-title">Open Maintenance</h2>
          {Object.keys(maintenanceByRoom).length === 0 ? (
            <div className="dash-caught-up">
              <span className="dash-caught-up-icon">&#10003;</span>
              <span>No open maintenance</span>
            </div>
          ) : (
            <div className="po-maint-groups">
              {Object.entries(maintenanceByRoom).map(([key, group]) => (
                <div key={key} className="po-maint-group">
                  <div className="po-maint-group-header">
                    <span>{group.label}</span>
                    <span className="po-maint-group-count">{group.items.length}</span>
                  </div>
                  {group.items.map((m) => (
                    <div key={m.id} className="po-maint-item" onClick={() => navigate('/maintenance')}>
                      <div className="po-maint-item-left">
                        <span className="po-maint-desc">{m.description}</span>
                        <span className="po-maint-zone">{m.zone}</span>
                      </div>
                      <div className="po-maint-item-right">
                        <span className="review-cat-badge">{m.flagCategory}</span>
                        <span className="insp-status-badge" style={{ color: MAINT_STATUS_COLORS[m.status], borderColor: MAINT_STATUS_COLORS[m.status] }}>
                          {MAINT_STATUS_LABELS[m.status]}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─── INSPECTION TIMELINE ─── */}
        <section className="po-section">
          <h2 className="po-section-title">
            Recent Inspections
            {recentInspections.length >= 10 && (
              <button className="btn-text-sm" onClick={() => navigate(`/inspections?propertyId=${id}`)}>
                View All &rarr;
              </button>
            )}
          </h2>
          {recentInspections.length === 0 ? (
            <p className="empty-text">No inspections yet</p>
          ) : (
            <div className="po-timeline">
              {recentInspections.map((insp) => (
                <div
                  key={insp.id}
                  className="po-timeline-item"
                  onClick={() => navigate(
                    insp.status === 'DRAFT' ? `/inspections/${insp.id}` : `/inspections/${insp.id}/review`,
                  )}
                >
                  <div className="po-timeline-left">
                    <span className="po-timeline-date">{timeAgo(insp.createdAt)}</span>
                    <span className="dash-type-badge">{TYPE_LABELS[insp.type] || insp.type}</span>
                  </div>
                  <div className="po-timeline-right">
                    {insp.roomLabel && <span className="po-timeline-room">{insp.roomLabel}</span>}
                    <span className="po-timeline-inspector">{insp.inspectorName}</span>
                    {insp.flagCount > 0 && (
                      <span className="pending-flag-count">&#9873; {insp.flagCount}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="po-split">
        {/* ─── COMMON AREA STATUS ─── */}
        <section className="po-section">
          <h2 className="po-section-title">Common Area Status</h2>
          <div className="po-ca-card">
            <div className="po-ca-indicator" style={{ background: HEALTH_COLORS[caStatus] }} />
            <div className="po-ca-info">
              <div className="po-ca-label">
                {commonArea.daysSince === null
                  ? 'Never inspected'
                  : commonArea.daysSince === 0
                    ? 'Inspected today'
                    : `Inspected ${commonArea.daysSince} day${commonArea.daysSince !== 1 ? 's' : ''} ago`}
              </div>
              {commonArea.openFlags > 0 && (
                <div className="po-ca-flags">{commonArea.openFlags} open maintenance item{commonArea.openFlags !== 1 ? 's' : ''}</div>
              )}
            </div>
            <button
              className="btn-primary-xs"
              onClick={() => setShowStart(true)}
            >
              Inspect
            </button>
          </div>
        </section>

        {/* ─── OVERDUE ROOMS ─── */}
        <section className="po-section">
          <h2 className="po-section-title">Overdue Rooms</h2>
          {overdueRooms.length === 0 ? (
            <div className="dash-caught-up">
              <span className="dash-caught-up-icon">&#10003;</span>
              <span>All rooms on schedule</span>
            </div>
          ) : (
            <div className="po-overdue-list">
              {overdueRooms.map((room) => (
                <div key={room.id} className="po-overdue-item">
                  <div className="po-overdue-info">
                    <span className="po-overdue-name">{room.label}</span>
                    <span className="po-overdue-since">
                      {room.daysSince === null
                        ? 'Never inspected'
                        : `Last inspected ${room.daysSince} days ago`}
                    </span>
                  </div>
                  <button className="btn-primary-xs" onClick={() => setShowStart(true)}>
                    Inspect
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <StartInspection open={showStart} onClose={() => setShowStart(false)} />
    </div>
  );
}
