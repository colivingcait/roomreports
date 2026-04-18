import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import StartInspection from '../components/StartInspection';
import RoomHistory from '../components/RoomHistory';
import ConfirmDialog from '../components/ConfirmDialog';

const TYPE_LABELS = {
  COMMON_AREA: 'Common Area', ROOM_TURN: 'Room Turn', QUARTERLY: 'Quarterly',
  RESIDENT_SELF_CHECK: 'Self-Check', MOVE_IN_OUT: 'Move-In',
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

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

// Group quarterly inspections by property+date (within same day = one batch)
function groupInspections(inspections) {
  const grouped = [];
  const quarterlyBuckets = {};

  for (const insp of inspections) {
    if (insp.type === 'QUARTERLY') {
      const dateKey = new Date(insp.createdAt).toDateString();
      const key = `${insp.property?.id || ''}-${dateKey}-${insp.status}`;
      if (!quarterlyBuckets[key]) {
        quarterlyBuckets[key] = {
          id: `qgroup-${key}`,
          isGroup: true,
          type: 'QUARTERLY',
          status: insp.status,
          property: insp.property,
          createdAt: insp.createdAt,
          inspections: [],
          _count: { items: 0 },
        };
        grouped.push(quarterlyBuckets[key]);
      }
      quarterlyBuckets[key].inspections.push(insp);
      quarterlyBuckets[key]._count.items += insp._count?.items || 0;
    } else {
      grouped.push(insp);
    }
  }

  // Set room count label for quarterly groups
  for (const g of Object.values(quarterlyBuckets)) {
    g.roomCount = g.inspections.length;
    g.propertyId = g.property?.id;
  }

  return grouped;
}

export default function Inspections() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showStart, setShowStart] = useState(false);
  const [notification] = useState(location.state?.notification || '');

  // Filters
  const [properties, setProperties] = useState([]);
  const [filterProperty, setFilterProperty] = useState('');
  const [filterRoom, setFilterRoom] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || '');
  const [rooms, setRooms] = useState([]);

  // Selection mode
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());

  // Delete
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  // Archived toggle
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    fetch('/api/properties', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setProperties(d.properties || []));
  }, []);

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

  const fetchInspections = () => {
    const params = new URLSearchParams();
    if (filterProperty) params.set('propertyId', filterProperty);
    if (filterRoom) params.set('roomId', filterRoom);
    if (filterType) params.set('type', filterType);
    if (filterStatus) params.set('status', filterStatus);
    if (showArchived) params.set('archived', 'true');

    setLoading(true);
    fetch(`/api/inspections?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setInspections(d.inspections || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchInspections(); }, [filterProperty, filterRoom, filterType, filterStatus, showArchived]);

  const grouped = groupInspections(inspections);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      if (deleteTarget.isGroup) {
        const ids = deleteTarget.inspections.map((i) => i.id);
        await api('/api/inspections/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) });
      } else {
        await api(`/api/inspections/${deleteTarget.id}`, { method: 'DELETE' });
      }
      setDeleteTarget(null);
      fetchInspections();
    } catch { /* ignore */ }
    finally { setDeleting(false); }
  };

  const handleRestore = async (item) => {
    try {
      if (item.isGroup) {
        for (const i of item.inspections) {
          await api(`/api/inspections/${i.id}/restore`, { method: 'POST' });
        }
      } else {
        await api(`/api/inspections/${item.id}/restore`, { method: 'POST' });
      }
      fetchInspections();
    } catch { /* ignore */ }
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      // Expand any quarterly groups into individual IDs
      const ids = [];
      for (const item of grouped) {
        if (!selected.has(item.id)) continue;
        if (item.isGroup) {
          for (const i of item.inspections) ids.push(i.id);
        } else {
          ids.push(item.id);
        }
      }
      await api('/api/inspections/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) });
      setSelected(new Set());
      setSelectMode(false);
      setBulkDeleteConfirm(false);
      fetchInspections();
    } catch { /* ignore */ }
    finally { setDeleting(false); }
  };

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllDeletable = () => {
    const ids = grouped.filter((i) => ['DRAFT', 'REVIEWED'].includes(i.status)).map((i) => i.id);
    setSelected(new Set(ids));
  };

  const handleRowClick = (item) => {
    if (selectMode) {
      if (['DRAFT', 'REVIEWED'].includes(item.status)) toggleSelect(item.id);
      return;
    }
    if (item.isGroup) {
      // Quarterly groups: DRAFT goes to flow, SUBMITTED/REVIEWED go to review
      if (item.status === 'DRAFT') {
        navigate(`/quarterly/${item.propertyId}`);
      } else {
        const dateKey = new Date(item.createdAt).toISOString().slice(0, 10);
        navigate(`/quarterly-review/${item.propertyId}/${dateKey}`);
      }
    } else if (item.status === 'DRAFT') {
      if (item.type === 'QUARTERLY') {
        navigate(`/quarterly/${item.property?.id}`);
      } else if (item.type === 'COMMON_AREA') {
        navigate(`/common-area/${item.id}`);
      } else if (item.type === 'ROOM_TURN') {
        navigate(`/room-turn/${item.id}`);
      } else {
        navigate(`/inspections/${item.id}`);
      }
    } else {
      navigate(`/inspections/${item.id}/review`);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Inspections</h1>
          <p className="page-subtitle">{inspections.length} inspection{inspections.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary-sm" onClick={() => setShowStart(true)}>+ New Inspection</button>
      </div>

      {notification && <div className="notification-bar">{notification}</div>}

      {/* Bulk select bar */}
      {selectMode && (
        <div className="bulk-bar">
          <div className="bulk-bar-left">
            <span className="bulk-count">{selected.size} selected</span>
            <button className="btn-text-sm" onClick={selectAllDeletable}>Select all</button>
          </div>
          <div className="bulk-bar-right">
            <button className="btn-text-sm" onClick={() => { setSelectMode(false); setSelected(new Set()); }}>Cancel</button>
            <button
              className="btn-danger-sm"
              onClick={() => setBulkDeleteConfirm(true)}
              disabled={selected.size === 0}
            >
              Delete selected
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
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

        <button
          className={`filter-toggle ${showArchived ? 'active' : ''}`}
          onClick={() => { setShowArchived(!showArchived); setSelectMode(false); }}
        >
          {showArchived ? '\u2713 Show Archived' : 'Show Archived'}
        </button>

        {!selectMode && !showArchived && (
          <button className="btn-text-sm" onClick={() => setSelectMode(true)}>Select</button>
        )}

        {(filterProperty || filterType || filterStatus || filterRoom) && (
          <button className="btn-text-sm" onClick={() => { setFilterProperty(''); setFilterRoom(''); setFilterType(''); setFilterStatus(''); }}>
            Clear
          </button>
        )}
      </div>

      {filterRoom && <RoomHistory roomId={filterRoom} />}

      {/* List */}
      {loading ? (
        <div className="page-loading">Loading...</div>
      ) : grouped.length === 0 ? (
        <div className="empty-state">
          <p>No inspections match your filters</p>
          <button className="btn-primary-sm" onClick={() => setShowStart(true)}>Start an inspection</button>
        </div>
      ) : (
        <div className="insp-history-list">
          {grouped.map((item) => {
            const canDelete = ['DRAFT', 'REVIEWED'].includes(item.status);
            return (
              <div
                key={item.id}
                className={`insp-history-row ${selectMode && canDelete ? 'selectable' : ''} ${showArchived ? 'insp-history-row-archived' : ''}`}
                onClick={() => !showArchived && handleRowClick(item)}
              >
                {selectMode && canDelete && (
                  <input
                    type="checkbox"
                    className="insp-checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}

                <div className="insp-history-left">
                  <span className="dash-type-badge">{TYPE_LABELS[item.type] || item.type}</span>
                  <div className="insp-history-info">
                    <span className="insp-history-prop">
                      {item.property?.name || item.inspections?.[0]?.property?.name}
                      {item.isGroup
                        ? ` (${item.roomCount} room${item.roomCount !== 1 ? 's' : ''})`
                        : item.room ? ` \u2014 ${item.room.label}` : ''}
                    </span>
                    <span className="insp-history-inspector">{timeAgo(item.createdAt)}</span>
                  </div>
                </div>

                <div className="insp-history-right">
                  <span className="insp-history-items">
                    {item.isGroup ? `${item._count.items} items` : `${item._count?.items || 0} items`}
                  </span>
                  {showArchived ? (
                    <span className="insp-archived-badge">Archived</span>
                  ) : (
                    <span
                      className="insp-status-badge"
                      style={{ color: STATUS_COLORS[item.status], borderColor: STATUS_COLORS[item.status] }}
                    >
                      {item.status}
                    </span>
                  )}
                  {showArchived ? (
                    <button
                      className="btn-text-sm"
                      onClick={(e) => { e.stopPropagation(); handleRestore(item); }}
                      title="Restore"
                    >
                      Restore
                    </button>
                  ) : (
                    !selectMode && canDelete && (
                      <button
                        className="insp-delete-btn"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(item); }}
                        title={`Delete ${item.status.toLowerCase()}`}
                      >
                        &#128465;
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <StartInspection open={showStart} onClose={() => setShowStart(false)} />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title={deleteTarget?.status === 'REVIEWED' ? 'Archive Inspection' : 'Delete Draft'}
        message={(() => {
          if (!deleteTarget) return '';
          if (deleteTarget.status === 'REVIEWED') {
            return deleteTarget.isGroup
              ? `Delete this completed quarterly inspection (${deleteTarget.roomCount} rooms)? The inspection record and any associated data will be archived. This cannot be undone.`
              : 'Delete this completed inspection? The inspection record and any associated data will be archived. This cannot be undone.';
          }
          return deleteTarget.isGroup
            ? `Delete this quarterly draft (${deleteTarget.roomCount} rooms)? This cannot be undone.`
            : 'Delete this draft inspection? This cannot be undone.';
        })()}
        confirmLabel={deleteTarget?.status === 'REVIEWED' ? 'Archive' : 'Delete'}
      />

      <ConfirmDialog
        open={bulkDeleteConfirm}
        onClose={() => setBulkDeleteConfirm(false)}
        onConfirm={handleBulkDelete}
        loading={deleting}
        title="Delete Selected"
        message={`Delete ${selected.size} draft inspection${selected.size !== 1 ? 's' : ''}? This cannot be undone.`}
      />
    </div>
  );
}
