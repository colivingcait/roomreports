import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { DEFAULT_FEATURES, DEFAULT_FURNITURE } from '../../../shared/index.js';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '../components/Modal';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      return d;
    });

// ─── Inline editable field ──────────────────────────────

function InlineEdit({ value, onSave, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const save = () => {
    if (draft.trim() && draft !== value) onSave(draft.trim());
    setEditing(false);
  };

  if (!editing) {
    return (
      <span className="inline-edit" onClick={() => { setDraft(value); setEditing(true); }} title="Click to edit">
        {value || placeholder}
      </span>
    );
  }

  return (
    <input
      className="inline-edit-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
      autoFocus
    />
  );
}

// ─── Space section (kitchens / bathrooms) ────────────────

function SpaceSection({ title, items, propertyId, endpoint, onRefresh }) {
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setSaving(true);
    try {
      await api(`/api/properties/${propertyId}/${endpoint}`, {
        method: 'POST',
        body: JSON.stringify({ label: newLabel.trim() }),
      });
      setNewLabel('');
      setAdding(false);
      onRefresh();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleUpdate = async (id, label) => {
    try {
      await api(`/api/properties/${propertyId}/${endpoint}/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ label }),
      });
      onRefresh();
    } catch { /* ignore */ }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api(`/api/properties/${propertyId}/${endpoint}/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      onRefresh();
    } catch { /* ignore */ } finally { setDeleting(false); }
  };

  return (
    <div className="detail-section">
      <div className="section-header">
        <h3>{title}</h3>
        <button className="btn-text-sm" onClick={() => setAdding(true)}>+ Add</button>
      </div>

      {items.length === 0 && !adding && (
        <p className="empty-text">No {title.toLowerCase()} yet</p>
      )}

      {items.map((item) => (
        <div key={item.id} className="space-row">
          <InlineEdit value={item.label} onSave={(label) => handleUpdate(item.id, label)} />
          <button className="btn-icon-danger" onClick={() => setDeleteTarget(item)} title="Remove">&times;</button>
        </div>
      ))}

      {adding && (
        <form onSubmit={handleAdd} className="inline-add-form">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={`e.g. ${title.slice(0, -1)} 1`}
            autoFocus
          />
          <button type="submit" className="btn-primary-xs" disabled={saving}>Add</button>
          <button type="button" className="btn-text-sm" onClick={() => { setAdding(false); setNewLabel(''); }}>Cancel</button>
        </form>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title={`Remove ${title.slice(0, -1)}`}
        message={`Are you sure you want to remove "${deleteTarget?.label}"? This cannot be undone.`}
      />
    </div>
  );
}

// ─── Room card ──────────────────────────────────────────

function RoomCard({ room, propertyId, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const handleUpdateLabel = async (label) => {
    try {
      await api(`/api/properties/${propertyId}/rooms/${room.id}`, {
        method: 'PUT',
        body: JSON.stringify({ label }),
      });
      onRefresh();
    } catch { /* ignore */ }
  };

  const toggleFeature = async (feature) => {
    const features = room.features.includes(feature)
      ? room.features.filter((f) => f !== feature)
      : [...room.features, feature];
    try {
      await api(`/api/properties/${propertyId}/rooms/${room.id}`, {
        method: 'PUT',
        body: JSON.stringify({ features }),
      });
      onRefresh();
    } catch { /* ignore */ }
  };

  const toggleFurniture = async (item) => {
    const furniture = room.furniture.includes(item)
      ? room.furniture.filter((f) => f !== item)
      : [...room.furniture, item];
    try {
      await api(`/api/properties/${propertyId}/rooms/${room.id}`, {
        method: 'PUT',
        body: JSON.stringify({ furniture }),
      });
      onRefresh();
    } catch { /* ignore */ }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api(`/api/properties/${propertyId}/rooms/${room.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      onRefresh();
    } catch { /* ignore */ } finally { setDeleting(false); }
  };

  return (
    <div className="room-card">
      <div className="room-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="room-card-left">
          <span className={`chevron ${expanded ? 'open' : ''}`}>&#9654;</span>
          <InlineEdit value={room.label} onSave={handleUpdateLabel} />
        </div>
        <div className="room-card-right">
          <span className="room-meta">{room.features.length} features, {room.furniture.length} items</span>
          <button className="btn-icon-danger" onClick={(e) => { e.stopPropagation(); setDeleteTarget(room); }} title="Remove">&times;</button>
        </div>
      </div>

      {expanded && (
        <div className="room-card-body">
          <div className="tag-section">
            <h4>Features</h4>
            <div className="tag-list">
              {DEFAULT_FEATURES.map((f) => (
                <button
                  key={f}
                  className={`tag ${room.features.includes(f) ? 'tag-active' : ''}`}
                  onClick={() => toggleFeature(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="tag-section">
            <h4>Furniture</h4>
            <div className="tag-list">
              {DEFAULT_FURNITURE.map((item) => (
                <button
                  key={item}
                  className={`tag ${room.furniture.includes(item) ? 'tag-active' : ''}`}
                  onClick={() => toggleFurniture(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title="Remove Room"
        message={`Are you sure you want to remove "${deleteTarget?.label}"? This cannot be undone.`}
      />
    </div>
  );
}

// ─── Copy Link button with "Copied!" feedback ───────────

function CopyLinkButton({ value, className = 'btn-primary-xs' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      type="button"
      className={className}
      onClick={handleCopy}
      style={copied ? { color: '#3B6D11', borderColor: '#6B8F71' } : undefined}
    >
      {copied ? 'Copied!' : 'Copy Link'}
    </button>
  );
}

// ─── Main component ─────────────────────────────────────

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addingRoom, setAddingRoom] = useState(false);
  const [deleteProperty, setDeleteProperty] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [qrToken, setQrToken] = useState('');

  useEffect(() => {
    if (showQR && !qrToken) {
      fetch(`/api/properties/${id}/qr-token`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => setQrToken(d.token || ''))
        .catch(() => {});
    }
  }, [showQR, qrToken, id]);

  const fetchProperty = useCallback(async () => {
    try {
      const data = await api(`/api/properties/${id}`);
      setProperty(data.property);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchProperty(); }, [fetchProperty]);

  const handleUpdateProperty = async (field, value) => {
    try {
      await api(`/api/properties/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ [field]: value }),
      });
      fetchProperty();
    } catch { /* ignore */ }
  };

  const handleAddRoom = async () => {
    setAddingRoom(true);
    try {
      await api(`/api/properties/${id}/rooms`, {
        method: 'POST',
        body: JSON.stringify({
          label: `Room ${(property?.rooms?.length || 0) + 1}`,
          features: [],
          furniture: [...DEFAULT_FURNITURE],
        }),
      });
      fetchProperty();
    } catch { /* ignore */ } finally { setAddingRoom(false); }
  };

  const handleDeleteProperty = async () => {
    setDeleting(true);
    try {
      await api(`/api/properties/${id}`, { method: 'DELETE' });
      navigate('/properties');
    } catch { /* ignore */ } finally { setDeleting(false); }
  };

  if (loading) return <div className="page-loading">Loading property...</div>;
  if (error) return <div className="page-container"><div className="auth-error">{error}</div></div>;
  if (!property) return null;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <button className="btn-text-sm" onClick={() => navigate('/properties')}>&larr; Properties</button>
          <h1 style={{ marginTop: '0.25rem' }}>
            <InlineEdit value={property.name} onSave={(v) => handleUpdateProperty('name', v)} />
          </h1>
          <p className="page-subtitle">
            <InlineEdit value={property.address} onSave={(v) => handleUpdateProperty('address', v)} placeholder="Add address" />
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" onClick={() => setShowQR(true)}>QR Code</button>
          <button className="btn-danger-sm" onClick={() => setDeleteProperty(true)}>Archive Property</button>
        </div>
      </div>

      <SpaceSection title="Kitchens" items={property.kitchens} propertyId={id} endpoint="kitchens" onRefresh={fetchProperty} />
      <SpaceSection title="Shared Bathrooms" items={property.bathrooms} propertyId={id} endpoint="bathrooms" onRefresh={fetchProperty} />

      <div className="detail-section">
        <div className="section-header">
          <h3>Rooms</h3>
          <button className="btn-text-sm" onClick={handleAddRoom} disabled={addingRoom}>
            {addingRoom ? 'Adding...' : '+ Add Room'}
          </button>
        </div>

        {property.rooms.length === 0 && (
          <p className="empty-text">No rooms yet</p>
        )}

        {property.rooms.map((room) => (
          <RoomCard key={room.id} room={room} propertyId={id} onRefresh={fetchProperty} />
        ))}
      </div>

      {/* Resident Links */}
      {(() => {
        const addrNum = (property.address || '').match(/\d+/)?.[0] || '';
        const nameSlug = property.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const slug = addrNum ? `${addrNum}-${nameSlug}` : nameSlug;
        const moveInUrl = `https://roomreport.co/movein/${slug}`;
        const selfCheckUrl = `https://roomreport.co/selfcheck/${slug}`;
        return (
          <div className="detail-section" style={{ marginTop: '1rem' }}>
            <div className="section-header"><h3>Resident Links</h3></div>
            <p className="empty-text" style={{ marginBottom: '0.75rem' }}>
              Share these links or print the QR codes for residents. No login required.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="pub-link-card">
                <h4>Move-In Inspection</h4>
                <div className="pub-link-qr">
                  <QRCodeSVG value={moveInUrl} size={120} level="M" fgColor="#4A4543" />
                </div>
                <code className="pub-link-url">{moveInUrl}</code>
                <CopyLinkButton value={moveInUrl} />
              </div>
              <div className="pub-link-card">
                <h4>Monthly Self-Check</h4>
                <div className="pub-link-qr">
                  <QRCodeSVG value={selfCheckUrl} size={120} level="M" fgColor="#4A4543" />
                </div>
                <code className="pub-link-url">{selfCheckUrl}</code>
                <CopyLinkButton value={selfCheckUrl} />
              </div>
            </div>
          </div>
        );
      })()}

      <ConfirmDialog
        open={deleteProperty}
        onClose={() => setDeleteProperty(false)}
        onConfirm={handleDeleteProperty}
        loading={deleting}
        title="Archive Property"
        message={`Are you sure you want to archive "${property.name}"? It will be hidden from all views.`}
        confirmLabel="Archive"
      />

      <Modal open={showQR} onClose={() => setShowQR(false)} title="Resident Invite">
        <div style={{ textAlign: 'center', padding: '1rem 0' }}>
          {!qrToken ? (
            <p style={{ color: '#8A8583' }}>Generating QR code...</p>
          ) : (
            <>
              <QRCodeSVG
                value={`${window.location.origin}/signup?invite=${qrToken}`}
                size={200}
                level="M"
                fgColor="#4A4543"
              />
              <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#8A8583' }}>
                Post this QR code at <strong>{property.name}</strong> so residents can scan and join.
              </p>

              {(() => {
                const addrNum = (property.address || '').match(/\d+/)?.[0] || '';
                const nameSlug = property.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                const slug = addrNum ? `${addrNum}${nameSlug}` : nameSlug;
                const friendlyUrl = `${window.location.origin}/join/${slug}`;
                return (
                  <div className="credentials-box" style={{ marginTop: '1rem', textAlign: 'left' }}>
                    <div className="credential-row">
                      <span className="credential-label">Share link</span>
                      <code className="credential-value">{friendlyUrl}</code>
                    </div>
                    <div className="credential-actions" style={{ marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => navigator.clipboard.writeText(friendlyUrl)}
                      >
                        Copy Link
                      </button>
                    </div>
                  </div>
                );
              })()}

              <p style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: '#B5B1AF' }}>
                Residents who use the QR code or link will be added as RESIDENT and assigned to this property.
              </p>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
