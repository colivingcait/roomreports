import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  FLAG_CATEGORIES as CATEGORIES,
  PRIORITIES,
  PRIORITY_COLORS,
  roleLabel,
} from '../../../shared/index.js';
import MaintenanceDetail from '../components/MaintenanceDetail';
import NewMaintenance from '../components/NewMaintenance';

const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'];
const STATUS_LABELS = { OPEN: 'Open', ASSIGNED: 'Assigned', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved' };
const STATUS_COLORS = { OPEN: '#C0392B', ASSIGNED: '#D85A30', IN_PROGRESS: '#BA7517', RESOLVED: '#3B6D11' };

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function fmtCurrency(n) {
  if (n == null) return null;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function shortDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Draggable card ─────────────────────────────────────

function KanbanCard({ item, onOpenDetail, selected, onToggleSelect, selectMode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: { item },
    disabled: selectMode,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  const cost = fmtCurrency(item.actualCost ?? item.estimatedCost);

  const handleClick = (e) => {
    if (selectMode) {
      e.stopPropagation();
      onToggleSelect(item.id);
    } else {
      onOpenDetail(item.id);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`maint-card ${selected ? 'maint-card-selected' : ''} ${isDragging ? 'maint-card-dragging' : ''}`}
      {...(selectMode ? {} : { ...listeners, ...attributes })}
      onClick={handleClick}
    >
      {selectMode && (
        <input
          type="checkbox"
          checked={!!selected}
          onChange={() => onToggleSelect(item.id)}
          onClick={(e) => e.stopPropagation()}
          className="maint-card-checkbox"
        />
      )}
      <div className="maint-card-top">
        <div className="maint-card-desc">{item.description}</div>
        {item.priority && (
          <span
            className="maint-priority-tag"
            style={{
              color: PRIORITY_COLORS[item.priority],
              borderColor: PRIORITY_COLORS[item.priority],
            }}
          >
            {item.priority}
          </span>
        )}
      </div>
      <div className="maint-card-meta">
        <span>{item.property?.name}</span>
        {item.room && <><span className="dot" /><span>{item.room.label}</span></>}
        <span className="dot" /><span>{item.flagCategory}</span>
      </div>
      <div className="maint-card-foot">
        <span className="maint-card-date">
          {shortDate(item.createdAt)}
          {item.reportedByName && <span className="maint-dim"> · by {item.reportedByName}</span>}
        </span>
        <span className="maint-card-foot-right">
          {cost && <span className="maint-cost">{cost}</span>}
          {item.assignedTo && <span className="maint-assigned">{item.assignedTo}</span>}
        </span>
      </div>
      {item.photos?.length > 0 && (
        <div className="maint-photos-row">
          {item.photos.slice(0, 4).map((p) => (
            <div key={p.id} className="photo-thumb-sm">
              <img src={p.url} alt="" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Droppable column ───────────────────────────────────

function KanbanColumn({ status, items, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${status}` });
  return (
    <div ref={setNodeRef} className={`kanban-col ${isOver ? 'kanban-col-over' : ''}`}>
      <div className="kanban-col-header" style={{ borderBottomColor: STATUS_COLORS[status] }}>
        <span>{STATUS_LABELS[status]}</span>
        <span className="kanban-col-count">{items.length}</span>
      </div>
      <div className="kanban-col-body">
        {children}
        {items.length === 0 && <p className="empty-text">Drop here</p>}
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────

export default function Maintenance() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [statusCounts, setStatusCounts] = useState({});
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterProperty, setFilterProperty] = useState('');
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || '');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sortBy, setSortBy] = useState('recent'); // recent | priority
  const [search, setSearch] = useState('');

  // Detail slide-over
  const [detailId, setDetailId] = useState(null);

  // Select mode (for batch PDF)
  const [selectMode, setSelectMode] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState(new Set());

  // Drag state
  const [activeId, setActiveId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Sync status filter to URL
  useEffect(() => {
    if (filterStatus) setSearchParams({ status: filterStatus }, { replace: true });
    else if (searchParams.get('status')) setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus]);

  const fetchItems = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterProperty) params.set('propertyId', filterProperty);
    if (filterStatus) params.set('status', filterStatus);
    if (filterCategory) params.set('flagCategory', filterCategory);
    if (filterPriority) params.set('priority', filterPriority);
    if (includeArchived) params.set('includeArchived', 'true');
    if (search) params.set('search', search);
    try {
      const data = await api(`/api/maintenance?${params}`);
      setItems(data.items || []);
      setStatusCounts(data.statusCounts || {});
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filterProperty, filterStatus, filterCategory, filterPriority, includeArchived, search]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  useEffect(() => {
    fetch('/api/properties', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setProperties(d.properties || []));
  }, []);

  const sortedItems = useMemo(() => {
    if (sortBy === 'priority') {
      const rank = { High: 0, Medium: 1, Low: 2 };
      return [...items].sort((a, b) => {
        const ra = rank[a.priority] ?? 3;
        const rb = rank[b.priority] ?? 3;
        if (ra !== rb) return ra - rb;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    }
    return [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [items, sortBy]);

  const handleDragStart = (e) => setActiveId(e.active.id);

  const handleDragEnd = async (e) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    if (!overId.startsWith('col-')) return;
    const newStatus = overId.slice(4);
    const item = items.find((i) => i.id === active.id);
    if (!item || item.status === newStatus) return;

    // Optimistic update
    setItems((prev) => prev.map((i) => i.id === active.id ? { ...i, status: newStatus } : i));

    try {
      const data = await api(`/api/maintenance/${active.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      setItems((prev) => prev.map((i) => i.id === data.item.id ? data.item : i));
      fetchItems(); // refresh counts
    } catch {
      // Roll back
      setItems((prev) => prev.map((i) => i.id === active.id ? item : i));
    }
  };

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const batchPdf = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const res = await fetch('/api/maintenance/batch-pdf', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `work-order-${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSelectMode(false);
    setSelected(new Set());
  };

  const activeItem = activeId ? items.find((i) => i.id === activeId) : null;
  const totalOpen = (statusCounts.OPEN || 0) + (statusCounts.ASSIGNED || 0) + (statusCounts.IN_PROGRESS || 0);

  const cardProps = {
    onOpenDetail: setDetailId,
    selected: (id) => selected.has(id),
    onToggleSelect: toggleSelect,
    selectMode,
  };

  if (loading) return <div className="page-loading">Loading maintenance items...</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <div className="view-toggle" style={{ marginBottom: '0.5rem' }}>
            <button className="view-btn active">Maintenance</button>
            <button className="view-btn" onClick={() => navigate('/tasks')}>Tasks</button>
          </div>
          <h1>Maintenance</h1>
          <p className="page-subtitle">{totalOpen} open item{totalOpen !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {selectMode ? (
            <>
              <button className="btn-secondary" onClick={() => { setSelectMode(false); setSelected(new Set()); }}>
                Cancel
              </button>
              <button className="btn-primary-sm" onClick={batchPdf} disabled={selected.size === 0}>
                Download work order ({selected.size})
              </button>
            </>
          ) : (
            <>
              <button className="btn-text-sm" onClick={() => setSelectMode(true)}>Select for work order</button>
              <button className="btn-primary-sm" onClick={() => setShowNew(true)}>+ New Maintenance</button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="maint-filters">
        <input
          type="search"
          className="filter-select"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description..."
          style={{ minWidth: '180px' }}
        />
        <select className="filter-select" value={filterProperty} onChange={(e) => setFilterProperty(e.target.value)}>
          <option value="">All Properties</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="filter-select" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="filter-select" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
          <option value="">All Priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="filter-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="recent">Sort: Recent</option>
          <option value="priority">Sort: Priority</option>
        </select>
        <button
          className={`filter-toggle ${includeArchived ? 'active' : ''}`}
          onClick={() => setIncludeArchived((v) => !v)}
          title="Include resolved items older than 7 days"
        >
          {includeArchived ? '✓ Include archived' : 'Include archived'}
        </button>
      </div>

      {/* Board */}
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="kanban-board">
          {STATUSES.map((s) => {
            const colItems = sortedItems.filter((i) => i.status === s);
            return (
              <KanbanColumn key={s} status={s} items={colItems}>
                {colItems.map((item) => (
                  <KanbanCard
                    key={item.id}
                    item={item}
                    onOpenDetail={cardProps.onOpenDetail}
                    selected={cardProps.selected(item.id)}
                    onToggleSelect={cardProps.onToggleSelect}
                    selectMode={cardProps.selectMode}
                  />
                ))}
              </KanbanColumn>
            );
          })}
        </div>
        <DragOverlay>
          {activeItem ? (
            <div className="maint-card maint-card-drag-overlay">
              <div className="maint-card-top">
                <div className="maint-card-desc">{activeItem.description}</div>
                {activeItem.priority && (
                  <span
                    className="maint-priority-tag"
                    style={{
                      color: PRIORITY_COLORS[activeItem.priority],
                      borderColor: PRIORITY_COLORS[activeItem.priority],
                    }}
                  >
                    {activeItem.priority}
                  </span>
                )}
              </div>
              <div className="maint-card-meta">
                <span>{activeItem.property?.name}</span>
                {activeItem.room && <><span className="dot" /><span>{activeItem.room.label}</span></>}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {detailId && (
        <MaintenanceDetail
          itemId={detailId}
          onClose={() => setDetailId(null)}
          onUpdated={(updated) => {
            setItems((prev) => prev.map((i) => i.id === updated.id ? { ...i, ...updated } : i));
          }}
        />
      )}

      <NewMaintenance
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={(created) => {
          // Drop in at the top of Open column optimistically
          setItems((prev) => [created, ...prev]);
          fetchItems();
        }}
      />
    </div>
  );
}
