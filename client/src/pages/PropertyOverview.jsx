import { useState, useEffect, Fragment } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import StartInspection from '../components/StartInspection';
import NewMaintenance from '../components/NewMaintenance';
import LogViolation from '../components/LogViolation';
import PropertyFinancialHealth from '../components/PropertyFinancialHealth';

const TYPE_LABELS = {
  COMMON_AREA: 'Common Area', COMMON_AREA_QUICK: 'Common Area Quick Check',
  ROOM_TURN: 'Room Turn', QUARTERLY: 'Room Inspection',
  RESIDENT_SELF_CHECK: 'Self-Check', MOVE_IN_OUT: 'Move-In',
};

const MAINT_STATUS_COLORS = { OPEN: '#C0392B', ASSIGNED: '#D85A30', IN_PROGRESS: '#BA7517', RESOLVED: '#3B6D11' };
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
  const [showNewMaint, setShowNewMaint] = useState(false);
  const [showLogViolation, setShowLogViolation] = useState(false);
  const [expandedRoomId, setExpandedRoomId] = useState(null);
  const [showFurniture, setShowFurniture] = useState(false);
  const [turnoverTarget, setTurnoverTarget] = useState(null);
  const [turningOver, setTurningOver] = useState(false);
  const [turnoverPlan, setTurnoverPlan] = useState(null);
  const [turnoverPlanLoading, setTurnoverPlanLoading] = useState(false);
  const [maintItems, setMaintItems] = useState([]);
  const [violations, setViolations] = useState([]);
  const [deferredByRoom, setDeferredByRoom] = useState({});
  const [maintFilter, setMaintFilter] = useState('active'); // active | all
  const [violationFilter, setViolationFilter] = useState('active'); // active | all

  useEffect(() => {
    // Fetch the full maintenance + violations lists for this property.
    fetch(`/api/maintenance?propertyId=${id}&includeArchived=true`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setMaintItems(d.items || []))
      .catch(() => {});
    fetch(`/api/violations?propertyId=${id}&includeArchived=true`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setViolations(d.violations || []))
      .catch(() => {});
    // Deferred tickets — separate query since they're not returned by
    // the default list (DEFERRED is excluded from active boards).
    fetch(`/api/maintenance?propertyId=${id}&deferredOnly=true`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const byRoom = {};
        for (const it of d.items || []) {
          const k = it.roomId || '';
          if (!byRoom[k]) byRoom[k] = [];
          byRoom[k].push(it);
        }
        setDeferredByRoom(byRoom);
      })
      .catch(() => {});
  }, [id]);

  const openTurnoverModal = async (room) => {
    setTurnoverTarget(room);
    setTurnoverPlan(null);
    setTurnoverPlanLoading(true);
    try {
      const r = await fetch(
        `/api/properties/${id}/rooms/${room.id}/turnover-plan`,
        { credentials: 'include' },
      );
      const d = await r.json();
      if (r.ok) setTurnoverPlan(d);
    } catch { /* ignore */ }
    finally { setTurnoverPlanLoading(false); }
  };

  const handleTurnoverConfirm = async () => {
    if (!turnoverTarget) return;
    setTurningOver(true);
    try {
      const res = await fetch(
        `/api/properties/${id}/rooms/${turnoverTarget.id}/turnover`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) throw new Error('turnover failed');
      setTurnoverTarget(null);
      setTurnoverPlan(null);
      // Refetch overview + deferred list
      const [rOverview, rDeferred] = await Promise.all([
        fetch(`/api/properties/${id}/overview`, { credentials: 'include' }),
        fetch(`/api/maintenance?propertyId=${id}&deferredOnly=true`, { credentials: 'include' }),
      ]);
      const d = await rOverview.json();
      setData(d);
      const dd = await rDeferred.json();
      const byRoom = {};
      for (const it of dd.items || []) {
        const k = it.roomId || '';
        if (!byRoom[k]) byRoom[k] = [];
        byRoom[k].push(it);
      }
      setDeferredByRoom(byRoom);
    } catch { /* ignore */ }
    finally { setTurningOver(false); }
  };

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
            <button className="btn-secondary-sm" onClick={() => setShowLogViolation(true)}>+ Log Violation</button>
            <button className="btn-secondary-sm" onClick={() => setShowNewMaint(true)}>+ Report Issue</button>
            <button className="btn-primary-sm" onClick={() => setShowStart(true)}>+ New Inspection</button>
          </div>
        </div>
      </div>

      <PropertyFinancialHealth propertyId={id} />

      {/* ─── ROOM ACCORDION LIST ─── */}
      <section className="po-section">
        <h2 className="po-section-title">Rooms</h2>
        <div className="po-room-list">
          {roomCards.map((room) => {
            const isExpanded = expandedRoomId === room.id;
            const open = room.openMaintenanceCount || 0;
            const viol = room.activeViolationCount || 0;
            const deferred = deferredByRoom[room.id] || [];
            const tone = (open > 0 && viol > 0) ? 'red' : (open > 0 || viol > 0) ? 'yellow' : 'green';
            return (
              <Fragment key={room.id}>
                <div
                  className={`po-room-row po-room-row-${tone} ${isExpanded ? 'expanded' : ''}`}
                  onClick={() => { setExpandedRoomId(isExpanded ? null : room.id); setShowFurniture(false); }}
                >
                  <div className="po-room-row-main">
                    <div className="po-room-row-title">
                      <h3 className="po-room-label">{room.label}</h3>
                      <button
                        className="btn-secondary-sm"
                        onClick={(e) => { e.stopPropagation(); openTurnoverModal(room); }}
                        title="Turn room for new resident"
                      >
                        Turn Room
                      </button>
                      {viol >= 3 && (
                        <span className="po-room-escalation" title={`${viol} active violations`}>
                          &#9888; {viol}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="po-room-row-right">
                    <span className={`po-count-badge po-count-badge-maint ${open === 0 ? 'po-count-empty' : ''}`} title="Open maintenance">
                      {open} <span className="po-count-label">open</span>
                    </span>
                    <span className={`po-count-badge po-count-badge-viol ${viol === 0 ? 'po-count-empty' : ''}`} title="Active violations">
                      {viol} <span className="po-count-label">viol</span>
                    </span>
                    {deferred.length > 0 && (
                      <span className="po-count-badge po-count-badge-deferred" title="Deferred maintenance">
                        {deferred.length} <span className="po-count-label">deferred</span>
                      </span>
                    )}
                    <span className={`po-room-chevron ${isExpanded ? 'open' : ''}`}>&#9656;</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="po-room-expanded">
                    <div className="po-room-expanded-grid">
                      <div>
                        <div className="po-dim">
                          {room.lastInspection
                            ? `Last inspected: ${TYPE_LABELS[room.lastInspection.type] || room.lastInspection.type} ${timeAgo(room.lastInspection.date)}`
                            : 'Never inspected'}
                          {room.lastTurnoverAt && (
                            <> &middot; Turned {timeAgo(room.lastTurnoverAt)}</>
                          )}
                        </div>
                        {room.features?.length > 0 && (
                          <div className="po-room-features" style={{ marginTop: '0.5rem' }}>
                            {room.features.map((f) => (
                              <span key={f} className="po-feature-tag">{f}</span>
                            ))}
                          </div>
                        )}
                        {room.furniture?.length > 0 && (
                          <button
                            className="po-furniture-toggle"
                            onClick={(e) => { e.stopPropagation(); setShowFurniture(!showFurniture); }}
                          >
                            {showFurniture ? '▾' : '▸'} Furniture ({room.furniture.length})
                          </button>
                        )}
                        {showFurniture && room.furniture?.length > 0 && (
                          <div className="po-furniture-list">
                            {room.furniture.map((f) => (
                              <span key={f} className="po-feature-tag">{f}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="po-room-quick-links">
                        <button
                          className="btn-text-sm"
                          onClick={(e) => { e.stopPropagation(); navigate(`/maintenance?propertyId=${id}&roomId=${room.id}`); }}
                        >
                          View {open} ticket{open === 1 ? '' : 's'} &rarr;
                        </button>
                        <button
                          className="btn-text-sm"
                          onClick={(e) => { e.stopPropagation(); navigate(`/reports?tab=violations&propertyId=${id}&roomId=${room.id}`); }}
                        >
                          View {viol} violation{viol === 1 ? '' : 's'} &rarr;
                        </button>
                      </div>
                    </div>
                    {deferred.length > 0 && (
                      <div className="po-room-deferred">
                        <div className="po-room-deferred-heading">Deferred</div>
                        {deferred.map((d) => (
                          <div key={d.id} className="po-room-deferred-row" onClick={(e) => { e.stopPropagation(); navigate('/maintenance'); }}>
                            <div>
                              <div className="po-room-deferred-title">{d.description}</div>
                              <div className="po-room-deferred-sub">
                                {d.flagCategory || 'General'}
                                {d.deferType === 'ROOM_TURN'
                                  ? ' · Until room turn'
                                  : d.deferUntil
                                    ? ` · Until ${new Date(d.deferUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                                    : ''}
                              </div>
                            </div>
                            <span className="invite-badge invite-badge-pending">Deferred</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </section>

      {/* ─── ALL MAINTENANCE TICKETS ─── */}
      <section className="po-section">
        <div className="po-section-head">
          <h2 className="po-section-title">All Maintenance Tickets</h2>
          <select className="filter-select" value={maintFilter} onChange={(e) => setMaintFilter(e.target.value)}>
            <option value="active">Active only</option>
            <option value="all">All (incl. archived)</option>
          </select>
        </div>
        {(() => {
          const rows = (maintItems || []).filter((m) => (
            maintFilter === 'all' ? true : (!m.archivedAt && m.status !== 'RESOLVED')
          ));
          if (rows.length === 0) return <p className="empty-text">No maintenance tickets.</p>;
          return (
            <div className="po-flat-list">
              {rows.slice(0, 20).map((m) => (
                <div key={m.id} className="po-flat-row" onClick={() => navigate('/maintenance')}>
                  <div className="po-flat-row-main">
                    <span className="po-flat-desc">{m.description}</span>
                    <span className="po-dim">
                      {m.room?.label || 'Common'} &middot; {m.flagCategory}
                      {m.archivedAt && <> &middot; archived</>}
                    </span>
                  </div>
                  <span
                    className="insp-status-badge"
                    style={{ color: MAINT_STATUS_COLORS[m.status], borderColor: MAINT_STATUS_COLORS[m.status] }}
                  >
                    {MAINT_STATUS_LABELS[m.status] || m.status}
                  </span>
                </div>
              ))}
            </div>
          );
        })()}
      </section>

      {/* ─── ALL LEASE VIOLATIONS ─── */}
      <section className="po-section">
        <div className="po-section-head">
          <h2 className="po-section-title">All Lease Violations</h2>
          <select className="filter-select" value={violationFilter} onChange={(e) => setViolationFilter(e.target.value)}>
            <option value="active">Active only</option>
            <option value="all">All (incl. resolved/archived)</option>
          </select>
        </div>
        {(() => {
          const rows = (violations || []).filter((v) => (
            violationFilter === 'all' ? true : (!v.archivedAt && !v.resolvedAt)
          ));
          if (rows.length === 0) return <p className="empty-text">No violations.</p>;
          return (
            <div className="po-flat-list">
              {rows.slice(0, 20).map((v) => (
                <div key={v.id} className="po-flat-row">
                  <div className="po-flat-row-main">
                    <span className="po-flat-desc">{v.category || 'Violation'}</span>
                    <span className="po-dim">
                      {v.room?.label || 'Property'} &middot; {timeAgo(v.createdAt)}
                      {v.resolvedAt && <> &middot; resolved</>}
                      {v.archivedAt && <> &middot; archived</>}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </section>

      {/* ─── RECENT INSPECTIONS (grouped by type) ─── */}
      <section className="po-section">
        <h2 className="po-section-title">Recent Inspections</h2>
        {(() => {
          const groups = {};
          for (const insp of (recentInspections || [])) {
            const k = insp.type;
            if (!groups[k]) groups[k] = [];
            groups[k].push(insp);
          }
          const keys = Object.keys(groups);
          if (keys.length === 0) return <p className="empty-text">No inspections yet.</p>;
          return (
            <div className="po-inspection-groups">
              {keys.map((k) => (
                <div key={k} className="po-inspection-group">
                  <h4 className="po-inspection-group-title">{TYPE_LABELS[k] || k}</h4>
                  <div className="po-flat-list">
                    {groups[k].slice(0, 5).map((insp) => (
                      <div
                        key={insp.id}
                        className="po-flat-row"
                        onClick={() => navigate(
                          insp.status === 'DRAFT' ? `/inspections/${insp.id}` : `/inspections/${insp.id}/review`,
                        )}
                      >
                        <div className="po-flat-row-main">
                          <span className="po-flat-desc">{insp.inspectorName || 'Inspector'}</span>
                          <span className="po-dim">
                            {new Date(insp.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            {' · '}{insp.status}
                          </span>
                        </div>
                        {insp.flagCount > 0 && (
                          <span className="pending-flag-count">&#9873; {insp.flagCount}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
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

      <StartInspection
        open={showStart}
        onClose={() => setShowStart(false)}
        defaultPropertyId={property.id}
      />
      <NewMaintenance
        open={showNewMaint}
        onClose={() => setShowNewMaint(false)}
        defaultPropertyId={property.id}
        onCreated={() => { setShowNewMaint(false); }}
      />
      <LogViolation
        open={showLogViolation}
        onClose={() => setShowLogViolation(false)}
        propertyId={property.id}
        rooms={roomCards}
        onCreated={() => { setShowLogViolation(false); }}
      />

      {turnoverTarget && (
        <div className="modal-overlay" onClick={() => !turningOver && setTurnoverTarget(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Turn Room — {turnoverTarget.label}</h3>
              <button className="modal-close" onClick={() => !turningOver && setTurnoverTarget(null)}>&times;</button>
            </div>
            <div className="modal-form">
              <p className="po-turn-lead">The following actions will be taken:</p>

              {turnoverPlanLoading && !turnoverPlan ? (
                <p className="empty-text">Loading plan...</p>
              ) : !turnoverPlan ? (
                <div className="auth-error">Could not load the turnover plan.</div>
              ) : (
                <ul className="po-turn-list">
                  <li>
                    <span className="po-turn-check">✓</span>
                    {turnoverPlan.deferredItems.length === 0 ? (
                      <span>No deferred maintenance items</span>
                    ) : (
                      <span>
                        <strong>{turnoverPlan.deferredItems.length}</strong> deferred maintenance item
                        {turnoverPlan.deferredItems.length === 1 ? '' : 's'} will be reactivated
                        <ul className="po-turn-sublist">
                          {turnoverPlan.deferredItems.map((d) => (
                            <li key={d.id}>{d.description}</li>
                          ))}
                        </ul>
                      </span>
                    )}
                  </li>
                  <li>
                    <span className="po-turn-check">✓</span>
                    <span>
                      A Room Turn ticket will be created and
                      {turnoverPlan.cleaners.length > 0
                        ? <> assigned to <strong>{turnoverPlan.cleaners.map((c) => c.name).join(', ')}</strong></>
                        : <> left unassigned (no cleaner assigned to this property)</>}
                    </span>
                  </li>
                  <li>
                    <span className="po-turn-check">✓</span>
                    {turnoverPlan.activeViolations.length === 0 ? (
                      <span>No active lease violations</span>
                    ) : (
                      <span>
                        <strong>{turnoverPlan.activeViolations.length}</strong> active lease violation
                        {turnoverPlan.activeViolations.length === 1 ? '' : 's'} will be archived
                        <ul className="po-turn-sublist">
                          {turnoverPlan.activeViolations.map((v) => (
                            <li key={v.id}>{v.description}{v.category ? ` — ${v.category}` : ''}</li>
                          ))}
                        </ul>
                      </span>
                    )}
                  </li>
                  <li>
                    <span className="po-turn-check">✓</span>
                    <span>
                      {turnoverPlan.cleaners.length > 0
                        ? <><strong>{turnoverPlan.cleaners.map((c) => c.name).join(', ')}</strong> will be notified</>
                        : <>No cleaners assigned — nobody will be notified</>}
                    </span>
                  </li>
                </ul>
              )}

              <div className="modal-actions">
                <button
                  className="btn-secondary"
                  onClick={() => setTurnoverTarget(null)}
                  disabled={turningOver}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={handleTurnoverConfirm}
                  disabled={turningOver || !turnoverPlan}
                >
                  {turningOver ? 'Turning...' : 'Confirm Turn Room'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
