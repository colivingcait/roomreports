import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

// Active template editors: Room Inspection (QUARTERLY) drives the
// quarterly room-by-room flow, Common Area drives Kitchens/Bathrooms/
// Laundry/Living/Exterior, Room Turn drives the turnover checklist.
// Self-Check and Move-In are surfaced as "Coming soon" until those flows
// finish — their templates still exist server-side so we can re-enable
// them without losing customizations.
const TYPES = [
  { value: 'QUARTERLY', label: 'Room Inspection' },
  { value: 'COMMON_AREA', label: 'Common Area' },
  { value: 'ROOM_TURN', label: 'Room Turn' },
];

const COMING_SOON_LABELS = ['Self-Check', 'Move-In'];

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function SortableRow({ item, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="tpl-row">
      <button type="button" className="tpl-drag" {...attributes} {...listeners} title="Drag to reorder">⋮⋮</button>
      <div className="tpl-row-content">
        <div className="tpl-row-text">{item.text}</div>
        <div className="tpl-row-meta">
          {item.options?.length > 0 ? item.options.join(' / ') : 'Pass / Fail / N/A'}
        </div>
      </div>
      <div className="tpl-row-actions">
        <button type="button" className="btn-text-sm" onClick={() => onEdit(item)}>Edit</button>
        <button type="button" className="btn-text-sm" style={{ color: '#C53030' }} onClick={() => onDelete(item)}>Remove</button>
      </div>
    </div>
  );
}

const EMPTY = { zone: '', text: '', options: 'Pass, Fail, N/A' };

export default function Templates() {
  const navigate = useNavigate();
  const [type, setType] = useState('QUARTERLY');
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // item | null
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [error, setError] = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api(`/api/templates/${type}`);
      setTemplate(d.template);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [type]);

  useEffect(() => { load(); }, [load]);

  // Group items by zone for display
  const groups = {};
  const zoneOrder = [];
  for (const it of template?.items || []) {
    if (!groups[it.zone]) { groups[it.zone] = []; zoneOrder.push(it.zone); }
    groups[it.zone].push(it);
  }

  const handleDragEnd = async (e) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const items = template.items;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(items, oldIdx, newIdx);
    setTemplate({ ...template, items: reordered });
    try {
      await api(`/api/templates/${type}/reorder`, {
        method: 'POST',
        body: JSON.stringify({ order: reordered.map((i) => i.id) }),
      });
    } catch (err) { setError(err.message); load(); }
  };

  const openAdd = (zone = '') => {
    setEditing(null);
    setDraft({ ...EMPTY, zone });
    setShowForm(true);
  };
  const openEdit = (item) => {
    setEditing(item);
    setDraft({
      zone: item.zone,
      text: item.text,
      options: item.options?.length > 0 ? item.options.join(', ') : 'Pass, Fail, N/A',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!draft.zone.trim() || !draft.text.trim()) return;
    setSaving(true);
    const options = draft.options.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      if (editing) {
        const d = await api(`/api/templates/${type}/items/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ zone: draft.zone, text: draft.text, options }),
        });
        setTemplate((t) => ({ ...t, items: t.items.map((i) => i.id === d.item.id ? d.item : i) }));
      } else {
        const d = await api(`/api/templates/${type}/items`, {
          method: 'POST',
          body: JSON.stringify({ zone: draft.zone, text: draft.text, options }),
        });
        setTemplate((t) => ({ ...t, items: [...t.items, d.item] }));
      }
      setShowForm(false);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api(`/api/templates/${type}/items/${deleteTarget.id}`, { method: 'DELETE' });
      setTemplate((t) => ({ ...t, items: t.items.filter((i) => i.id !== deleteTarget.id) }));
    } catch (err) { setError(err.message); }
    finally { setDeleteTarget(null); }
  };

  const handleReset = async () => {
    try {
      const d = await api(`/api/templates/${type}/reset`, { method: 'POST' });
      setTemplate(d.template);
    } catch (err) { setError(err.message); }
    finally { setResetConfirm(false); }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <button className="btn-text-sm" onClick={() => navigate('/team')}>&larr; More</button>
          <h1 style={{ marginTop: '0.25rem' }}>Inspection Templates</h1>
          <p className="page-subtitle">
            Customize the checklist for each inspection type. Changes apply to future inspections only.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" onClick={() => setResetConfirm(true)}>Reset to defaults</button>
          <button className="btn-primary-sm" onClick={() => openAdd()}>+ Add Item</button>
        </div>
      </div>

      {/* Type tabs */}
      <div className="view-toggle" style={{ flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`view-btn ${type === t.value ? 'active' : ''}`}
            onClick={() => setType(t.value)}
          >
            {t.label}
          </button>
        ))}
        {COMING_SOON_LABELS.map((label) => (
          <button
            key={label}
            type="button"
            className="view-btn"
            disabled
            style={{ opacity: 0.5, cursor: 'not-allowed' }}
            title="Coming soon"
          >
            {label} <span style={{ fontSize: '0.75em', marginLeft: '0.4em' }}>(coming soon)</span>
          </button>
        ))}
      </div>

      {error && <div className="auth-error">{error}</div>}

      {loading ? (
        <div className="page-loading">Loading template...</div>
      ) : !template ? (
        <div className="empty-state"><p>Template not found.</p></div>
      ) : template.items.length === 0 ? (
        <div className="empty-state">
          <p>No items yet. Click + Add Item to build your checklist.</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={template.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            {zoneOrder.map((zone) => (
              <div key={zone} className="tpl-zone">
                <div className="tpl-zone-head">
                  <h3>{zone}</h3>
                  <button className="btn-text-sm" onClick={() => openAdd(zone)}>+ Add to {zone}</button>
                </div>
                {groups[zone].map((item) => (
                  <SortableRow
                    key={item.id}
                    item={item}
                    onEdit={openEdit}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </div>
            ))}
          </SortableContext>
        </DndContext>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? 'Edit Item' : 'Add Item'}
      >
        <form onSubmit={handleSubmit} className="modal-form">
          <label>
            Zone / section
            <input
              type="text"
              value={draft.zone}
              onChange={(e) => setDraft({ ...draft, zone: e.target.value })}
              placeholder="e.g. Bathroom, Kitchen, Bedroom"
              required
            />
          </label>
          <label>
            Item text
            <input
              type="text"
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              placeholder="e.g. Sink drains freely"
              required
            />
          </label>
          <label>
            Answer options (comma-separated)
            <input
              type="text"
              value={draft.options}
              onChange={(e) => setDraft({ ...draft, options: e.target.value })}
              placeholder="Pass, Fail, N/A"
            />
          </label>
          <button type="submit" className="btn-primary" disabled={saving || !draft.zone.trim() || !draft.text.trim()}>
            {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Item'}
          </button>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Remove item"
        message={`Remove "${deleteTarget?.text}" from this template? Future inspections won't include it; completed inspections are unchanged.`}
        confirmLabel="Remove"
      />
      <ConfirmDialog
        open={resetConfirm}
        onClose={() => setResetConfirm(false)}
        onConfirm={handleReset}
        title="Reset template"
        message="Replace this template with the built-in defaults? Your customizations for this inspection type will be lost."
        confirmLabel="Reset"
      />
    </div>
  );
}
