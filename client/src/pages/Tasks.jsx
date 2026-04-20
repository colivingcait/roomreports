import { useState, useEffect, useCallback } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, pointerWithin,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import Modal from '../components/Modal';
import AssigneePicker from '../components/AssigneePicker';
import MaintenanceToDoTabs from '../components/MaintenanceToDoTabs';
import { PRIORITIES, PRIORITY_COLORS } from '../../../shared/index.js';

const STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'];
const STATUS_LABELS = { TODO: 'Open', IN_PROGRESS: 'In Progress', DONE: 'Done' };
const STATUS_COLORS = { TODO: '#C0392B', IN_PROGRESS: '#BA7517', DONE: '#3B6D11' };

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function shortDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function TaskCard({ task, onEdit }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 };
  const overdue = task.isOverdue;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onEdit(task)}
      className={`maint-card ${overdue ? 'task-card-overdue' : ''}`}
    >
      <div className="maint-card-top">
        <div className="maint-card-desc">{task.title}</div>
        {task.priority && (
          <span className="maint-priority-tag" style={{ color: PRIORITY_COLORS[task.priority], borderColor: PRIORITY_COLORS[task.priority] }}>
            {task.priority}
          </span>
        )}
      </div>
      <div className="maint-card-meta">
        <span>{task.property?.name || 'General'}</span>
        {task.assignedTo && <><span className="dot" /><span>{task.assignedTo}</span></>}
      </div>
      <div className="maint-card-foot">
        <span className="maint-card-date">
          {task.dueAt ? `Due ${shortDate(task.dueAt)}` : 'No due date'}
          {overdue && <span style={{ color: '#C0392B', fontWeight: 600 }}> · overdue</span>}
        </span>
        {task.createdByName && <span className="maint-dim">by {task.createdByName}</span>}
      </div>
    </div>
  );
}

function Column({ status, items, children }) {
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

const EMPTY_FORM = {
  title: '', description: '', propertyId: '', dueAt: '',
  priority: 'Medium', assignedTo: '', assignedUserId: null, assignedVendorId: null,
};

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [statusCounts, setStatusCounts] = useState({});
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);

  const [filterPropertyId, setFilterPropertyId] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAssignedMine, setFilterAssignedMine] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // task being edited
  const [draft, setDraft] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [activeId, setActiveId] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterPropertyId) params.set('propertyId', filterPropertyId);
    if (filterPriority) params.set('priority', filterPriority);
    if (filterAssignedMine) params.set('mine', 'true');
    try {
      const d = await api(`/api/tasks?${params}`);
      setTasks(d.tasks || []);
      setStatusCounts(d.statusCounts || {});
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filterPropertyId, filterPriority, filterAssignedMine]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api('/api/properties').then((d) => setProperties(d.properties || [])).catch(() => {});
  }, []);

  const openCreate = () => {
    setEditing(null);
    setDraft(EMPTY_FORM);
    setShowForm(true);
  };
  const openEdit = (task) => {
    setEditing(task);
    setDraft({
      title: task.title,
      description: task.description || '',
      propertyId: task.propertyId || '',
      dueAt: task.dueAt ? task.dueAt.slice(0, 10) : '',
      priority: task.priority || 'Medium',
      assignedTo: task.assignedTo || '',
      assignedUserId: task.assignedUserId || null,
      assignedVendorId: task.assignedVendorId || null,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    setSaving(true);
    try {
      const body = {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        propertyId: draft.propertyId || null,
        dueAt: draft.dueAt || null,
        priority: draft.priority || null,
        assignedUserId: draft.assignedUserId,
        assignedVendorId: draft.assignedVendorId,
        assignedTo: draft.assignedTo || null,
      };
      if (editing) {
        const d = await api(`/api/tasks/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
        setTasks((prev) => prev.map((t) => t.id === d.task.id ? d.task : t));
      } else {
        const d = await api('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
        setTasks((prev) => [...prev, d.task]);
      }
      setShowForm(false);
      load();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!editing) return;
    await api(`/api/tasks/${editing.id}`, { method: 'DELETE' });
    setTasks((prev) => prev.filter((t) => t.id !== editing.id));
    setShowForm(false);
    load();
  };

  const handleDragEnd = async (e) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    if (!overId.startsWith('col-')) return;
    const newStatus = overId.slice(4);
    const task = tasks.find((t) => t.id === active.id);
    if (!task || task.status === newStatus) return;
    setTasks((prev) => prev.map((t) => t.id === active.id ? { ...t, status: newStatus } : t));
    try {
      const d = await api(`/api/tasks/${active.id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
      setTasks((prev) => prev.map((t) => t.id === d.task.id ? d.task : t));
      load();
    } catch {
      setTasks((prev) => prev.map((t) => t.id === active.id ? task : t));
    }
  };

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;
  const totalOpen = (statusCounts.TODO || 0) + (statusCounts.IN_PROGRESS || 0);

  if (loading) return <div className="page-loading">Loading to-do...</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <MaintenanceToDoTabs />
          <h1>To-Do</h1>
          <p className="page-subtitle">{totalOpen} open to-do{totalOpen !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary-sm" onClick={openCreate}>+ New To-Do</button>
      </div>

      <div className="maint-filters">
        <select className="filter-select" value={filterPropertyId} onChange={(e) => setFilterPropertyId(e.target.value)}>
          <option value="">All Properties (incl. General)</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="filter-select" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
          <option value="">All Priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button
          className={`filter-toggle ${filterAssignedMine ? 'active' : ''}`}
          onClick={() => setFilterAssignedMine((v) => !v)}
        >
          {filterAssignedMine ? '✓ Assigned to me' : 'Assigned to me'}
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={pointerWithin}
        onDragStart={(e) => setActiveId(e.active.id)} onDragEnd={handleDragEnd}>
        <div className="kanban-board" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {STATUSES.map((s) => {
            const col = tasks.filter((t) => t.status === s);
            return (
              <Column key={s} status={s} items={col}>
                {col.map((t) => <TaskCard key={t.id} task={t} onEdit={openEdit} />)}
              </Column>
            );
          })}
        </div>
        <DragOverlay>
          {activeTask ? <div className="maint-card maint-card-drag-overlay">{activeTask.title}</div> : null}
        </DragOverlay>
      </DndContext>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? 'Edit To-Do' : 'New To-Do'}>
        <form onSubmit={handleSubmit} className="modal-form">
          <label>
            Title
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              required
            />
          </label>
          <label>
            Description <span className="form-optional">(optional)</span>
            <textarea
              className="detail-textarea"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={2}
            />
          </label>
          <label>
            Property <span className="form-optional">(leave blank for General)</span>
            <select className="form-select" value={draft.propertyId} onChange={(e) => setDraft({ ...draft, propertyId: e.target.value })}>
              <option value="">General</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>
            Due date
            <input type="date" value={draft.dueAt} onChange={(e) => setDraft({ ...draft, dueAt: e.target.value })} />
          </label>
          <label>
            Priority
            <select
              className="form-select"
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
              style={{ color: PRIORITY_COLORS[draft.priority], borderColor: PRIORITY_COLORS[draft.priority] }}
            >
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            Assign to
            <AssigneePicker
              value={{ assignedTo: draft.assignedTo }}
              onChange={(patch) => setDraft({
                ...draft,
                assignedTo: patch.assignedTo || '',
                assignedUserId: patch.assignedUserId ?? null,
                assignedVendorId: patch.assignedVendorId ?? null,
              })}
            />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between' }}>
            {editing ? (
              <button type="button" className="btn-text-sm" style={{ color: '#C53030' }} onClick={handleDelete}>
                Delete
              </button>
            ) : <span />}
            <button type="submit" className="btn-primary" disabled={saving || !draft.title.trim()}>
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create To-Do'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
