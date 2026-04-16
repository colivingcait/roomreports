import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';

const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'];
const STATUS_LABELS = { OPEN: 'Open', ASSIGNED: 'Assigned', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved' };
const STATUS_COLORS = { OPEN: '#C4703F', ASSIGNED: '#6B8F71', IN_PROGRESS: '#C9A84C', RESOLVED: '#B5B1AF' };
const CATEGORIES = ['Maintenance', 'Pest', 'Safety', 'Cleanliness', 'Lease Violation', 'Other'];

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

// ─── Maintenance Card ───────────────────────────────────

function MaintenanceCard({ item, onUpdate, onDelete }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [assignedTo, setAssignedTo] = useState(item.assignedTo || '');
  const [note, setNote] = useState(item.note || '');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleStatusChange = async (status) => {
    try {
      const data = await api(`/api/maintenance/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      onUpdate(data.item);
    } catch { /* ignore */ }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = await api(`/api/maintenance/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ assignedTo: assignedTo || null, note: note || null }),
      });
      onUpdate(data.item);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleReopen = async () => {
    try {
      const data = await api(`/api/maintenance/${item.id}/reopen`, { method: 'PUT' });
      onUpdate(data.item);
    } catch { /* ignore */ }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api(`/api/maintenance/${item.id}`, { method: 'DELETE' });
      onDelete(item.id);
    } catch { /* ignore */ }
    finally { setDeleting(false); setDeleteConfirm(false); }
  };

  return (
    <div className={`maint-card ${expanded ? 'maint-card-expanded' : ''}`}>
      <div className="maint-card-main" onClick={() => setExpanded(!expanded)}>
        <div className="maint-card-left">
          <div className="maint-card-desc">{item.description}</div>
          <div className="maint-card-meta">
            <span>{item.property?.name}</span>
            {item.room && <><span className="dot" /><span>{item.room.label}</span></>}
            <span className="dot" /><span>{item.zone}</span>
          </div>
          <div className="maint-card-date">
            {new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {item.assignedTo && <span className="maint-assigned"> — {item.assignedTo}</span>}
          </div>
        </div>
        <div className="maint-card-right" onClick={(e) => e.stopPropagation()}>
          <span
            className="maint-category-badge"
            style={{ borderColor: STATUS_COLORS.OPEN }}
          >
            {item.flagCategory}
          </span>
          <select
            className="maint-status-select"
            value={item.status}
            onChange={(e) => handleStatusChange(e.target.value)}
            style={{ borderColor: STATUS_COLORS[item.status], color: STATUS_COLORS[item.status] }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </div>

      {item.photos?.length > 0 && (
        <div className="maint-photos-row">
          {item.photos.map((p) => (
            <div key={p.id} className="photo-thumb-sm">
              <img src={p.url} alt="" />
            </div>
          ))}
        </div>
      )}

      {expanded && (
        <div className="maint-card-detail">
          <div className="maint-detail-grid">
            <label className="detail-label">
              Assigned To
              <input
                type="text"
                className="maint-input"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="Name or team..."
              />
            </label>
            <label className="detail-label">
              Priority
              <select
                className="form-select detail-select"
                value={item.priority || ''}
                onChange={async (e) => {
                  const data = await api(`/api/maintenance/${item.id}`, {
                    method: 'PUT', body: JSON.stringify({ priority: e.target.value || null }),
                  });
                  onUpdate(data.item);
                }}
              >
                <option value="">None</option>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Urgent">Urgent</option>
              </select>
            </label>
          </div>

          <label className="detail-label">
            Notes
            <textarea
              className="detail-textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add details..."
              rows={2}
            />
          </label>

          <div className="maint-detail-actions">
            <button className="btn-primary-xs" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            {item.inspection && (
              <button
                className="btn-text-sm"
                onClick={() => navigate(`/inspections/${item.inspection.id}`)}
              >
                View Inspection
              </button>
            )}
            {item.status === 'RESOLVED' && (
              <button className="btn-text-sm" onClick={handleReopen}>Reopen</button>
            )}
            <button
              className="btn-text-sm"
              style={{ color: '#C53030' }}
              onClick={() => setDeleteConfirm(true)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={handleDelete}
        loading={deleting}
        title="Dismiss Maintenance Item"
        message={`Are you sure you want to dismiss "${item.description}"?`}
        confirmLabel="Dismiss"
      />
    </div>
  );
}

// ─── Kanban Column ──────────────────────────────────────

function KanbanColumn({ status, items, onUpdate, onDelete }) {
  return (
    <div className="kanban-col">
      <div className="kanban-col-header" style={{ borderBottomColor: STATUS_COLORS[status] }}>
        <span>{STATUS_LABELS[status]}</span>
        <span className="kanban-col-count">{items.length}</span>
      </div>
      <div className="kanban-col-body">
        {items.map((item) => (
          <MaintenanceCard key={item.id} item={item} onUpdate={onUpdate} onDelete={onDelete} />
        ))}
        {items.length === 0 && <p className="empty-text">No items</p>}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────

export default function Maintenance() {
  const [items, setItems] = useState([]);
  const [statusCounts, setStatusCounts] = useState({});
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');

  // Filters
  const [filterProperty, setFilterProperty] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  const fetchItems = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterProperty) params.set('propertyId', filterProperty);
    if (filterStatus) params.set('status', filterStatus);
    if (filterCategory) params.set('flagCategory', filterCategory);

    try {
      const data = await api(`/api/maintenance?${params}`);
      setItems(data.items || []);
      setStatusCounts(data.statusCounts || {});
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filterProperty, filterStatus, filterCategory]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  useEffect(() => {
    fetch('/api/properties', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setProperties(d.properties || []));
  }, []);

  const handleUpdate = (updatedItem) => {
    setItems((prev) => prev.map((i) => (i.id === updatedItem.id ? updatedItem : i)));
    // Refresh counts
    fetchItems();
  };

  const handleDelete = (id) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    fetchItems();
  };

  const totalOpen = (statusCounts.OPEN || 0) + (statusCounts.ASSIGNED || 0) + (statusCounts.IN_PROGRESS || 0);

  if (loading) return <div className="page-loading">Loading maintenance items...</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Maintenance</h1>
          <p className="page-subtitle">{totalOpen} open item{totalOpen !== 1 ? 's' : ''}</p>
        </div>
        <div className="view-toggle">
          <button className={`view-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>List</button>
          <button className={`view-btn ${view === 'kanban' ? 'active' : ''}`} onClick={() => setView('kanban')}>Board</button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="maint-filters">
        <select className="filter-select" value={filterProperty} onChange={(e) => setFilterProperty(e.target.value)}>
          <option value="">All Properties</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <div className="filter-pills">
          <button
            className={`filter-pill ${filterStatus === '' ? 'active' : ''}`}
            onClick={() => setFilterStatus('')}
          >
            All ({Object.values(statusCounts).reduce((a, b) => a + b, 0)})
          </button>
          {STATUSES.map((s) => (
            <button
              key={s}
              className={`filter-pill ${filterStatus === s ? 'active' : ''}`}
              onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
              style={filterStatus === s ? { background: STATUS_COLORS[s], borderColor: STATUS_COLORS[s], color: '#fff' } : {}}
            >
              {STATUS_LABELS[s]} ({statusCounts[s] || 0})
            </button>
          ))}
        </div>

        <select className="filter-select" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Views */}
      {view === 'list' ? (
        <div className="maint-list">
          {items.length === 0 ? (
            <div className="empty-state"><p>No maintenance items match your filters</p></div>
          ) : (
            items.map((item) => (
              <MaintenanceCard key={item.id} item={item} onUpdate={handleUpdate} onDelete={handleDelete} />
            ))
          )}
        </div>
      ) : (
        <div className="kanban-board">
          {STATUSES.map((s) => (
            <KanbanColumn
              key={s}
              status={s}
              items={items.filter((i) => i.status === s)}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
