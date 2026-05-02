import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import StartInspection from '../components/StartInspection';
import NewMaintenance from '../components/NewMaintenance';
import LogViolation from '../components/LogViolation';
import PropertyHealthTab from '../components/PropertyHealthTab';
import PropertyRoomTable from '../components/PropertyRoomTable';
import PropertyAnalyticsTab from '../components/PropertyAnalyticsTab';
import PropertyInsightsTab from '../components/PropertyInsightsTab';

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

function fmtMoneyShort(n) {
  if (n == null || isNaN(n)) return '$0';
  return Number(n).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  });
}

// Extract a room number ("3") from a RoomReport label like "Room 3",
// "Cedar (Room 3)", or just "3" — used to join with PadSplit data.
function roomNumberFromLabel(label) {
  if (!label) return null;
  const m = String(label).match(/(?:room\s*)?(\d+)/i);
  return m ? m[1] : null;
}

export default function PropertyOverview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [showStart, setShowStart] = useState(false);
  const [showNewMaint, setShowNewMaint] = useState(false);
  const [showLogViolation, setShowLogViolation] = useState(false);
  const [turnoverTarget, setTurnoverTarget] = useState(null);
  const [turningOver, setTurningOver] = useState(false);
  const [turnoverPlan, setTurnoverPlan] = useState(null);
  const [turnoverPlanLoading, setTurnoverPlanLoading] = useState(false);
  const [maintItems, setMaintItems] = useState([]);
  const [violations, setViolations] = useState([]);
  const [deferredByRoom, setDeferredByRoom] = useState({});
  const [financial, setFinancial] = useState(null); // { hasData, rooms, latestMonth }
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
    // Per-room financial detail for this property (latest uploaded month).
    fetch(`/api/financials/property/${id}`, { credentials: 'include' })
      .then((r) => r.json())
      .then(setFinancial)
      .catch(() => setFinancial({ hasData: false }));
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

      <div className="pd-tabs">
        <button
          className={`pd-tab ${activeTab === 'overview' ? 'pd-tab-active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >Overview</button>
        <button
          className={`pd-tab ${activeTab === 'analytics' ? 'pd-tab-active' : ''}`}
          onClick={() => setActiveTab('analytics')}
        >Analytics</button>
        <button
          className={`pd-tab ${activeTab === 'insights' ? 'pd-tab-active' : ''}`}
          onClick={() => setActiveTab('insights')}
        >Insights</button>
      </div>

      {activeTab === 'analytics' && <PropertyAnalyticsTab propertyId={id} />}
      {activeTab === 'insights' && <PropertyInsightsTab propertyId={id} />}

      {activeTab === 'overview' && (<>
      {/* ─── ROOM TABLE ─── */}
      <section className="po-section">
        <h2 className="po-section-title">Rooms</h2>
        <PropertyRoomTable
          propertyId={id}
          rooms={roomCards}
          financial={financial}
          deferredByRoom={deferredByRoom}
          maintItems={maintItems}
          violations={violations}
          onTurn={openTurnoverModal}
        />
      </section>

      {/* ─── ALL MAINTENANCE & VIOLATIONS (side by side on desktop) ─── */}
      <div className="po-split">
      <section className="po-section">
        <div className="po-section-head">
          <h2 className="po-section-title">Open maintenance</h2>
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
          <h2 className="po-section-title">Active violations</h2>
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
      </div>

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

      </>)}

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
