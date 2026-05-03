import { useState, useEffect, useRef } from 'react';
import Modal from './Modal';

const VIOLATION_TYPES = [
  { value: 'MESSY',               label: 'Messy' },
  { value: 'BAD_ODOR',            label: 'Bad odor' },
  { value: 'SMOKING',             label: 'Smoking' },
  { value: 'UNAUTHORIZED_GUESTS', label: 'Unauthorized guests' },
  { value: 'PETS',                label: 'Pets' },
  { value: 'OPEN_FOOD',           label: 'Open food' },
  { value: 'PESTS',               label: 'Pests/bugs' },
  { value: 'OPEN_FLAMES',         label: 'Open flames/candles' },
  { value: 'OVERLOADED_OUTLETS',  label: 'Overloaded outlets' },
  { value: 'KITCHEN_APPLIANCES',  label: 'Kitchen appliances in room' },
  { value: 'LITHIUM_BATTERIES',   label: 'Lithium batteries' },
  { value: 'MODIFICATIONS',       label: 'Modifications (paint, holes, etc.)' },
  { value: 'DRUG_PARAPHERNALIA',  label: 'Drug paraphernalia' },
  { value: 'WEAPONS',             label: 'Weapons' },
  { value: 'UNCLEAR_EGRESS',      label: 'Unclear egress path' },
  { value: 'NOISE',               label: 'Noise' },
  { value: 'OTHER',               label: 'Other' },
];

export default function LogViolation({ open, onClose, propertyId, rooms = [], defaultRoomId, onCreated }) {
  const [propId, setPropId] = useState(propertyId || '');
  const [properties, setProperties] = useState([]);
  const [propRooms, setPropRooms] = useState(rooms);
  const [roomId, setRoomId] = useState(defaultRoomId || '');
  const [residentName, setResidentName] = useState('');
  const [violationType, setViolationType] = useState('');
  const [otherDescription, setOtherDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState([]);
  const [photoPreviews, setPhotoPreviews] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  // If no propertyId is supplied (portfolio-wide entry point), fetch the
  // property list so the user can pick.
  useEffect(() => {
    if (!open || propertyId) return;
    fetch('/api/properties', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setProperties(d.properties || []))
      .catch(() => {});
  }, [open, propertyId]);

  // When the property changes (or opens with a default), load its rooms.
  useEffect(() => {
    if (!open) return;
    if (propertyId) { setPropRooms(rooms); return; }
    if (!propId) { setPropRooms([]); return; }
    fetch(`/api/properties/${propId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setPropRooms(d.property?.rooms || []))
      .catch(() => setPropRooms([]));
  }, [open, propId, propertyId, rooms]);

  useEffect(() => {
    if (!open) {
      setPropId(propertyId || '');
      setRoomId(defaultRoomId || '');
      setResidentName('');
      setViolationType('');
      setOtherDescription('');
      setNotes('');
      setPhotos([]);
      setPhotoPreviews([]);
      setError('');
    } else {
      setPropId(propertyId || '');
      setRoomId(defaultRoomId || '');
    }
  }, [open, propertyId, defaultRoomId]);

  const handlePhotoPick = (e) => {
    const files = Array.from(e.target.files).slice(0, 5);
    setPhotos(files);
    setPhotoPreviews(files.map((f) => URL.createObjectURL(f)));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!propId) { setError('Select a property'); return; }
    if (!violationType) { setError('Select a violation type'); return; }
    if (violationType === 'OTHER' && !otherDescription.trim()) {
      setError('Describe the violation');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const form = new FormData();
      form.append('propertyId', propId);
      if (roomId) form.append('roomId', roomId);
      if (residentName.trim()) form.append('residentName', residentName.trim());
      form.append('violationType', violationType);
      if (otherDescription.trim()) form.append('otherDescription', otherDescription.trim());
      if (notes.trim()) form.append('notes', notes.trim());
      for (const file of photos) form.append('photos', file);
      const res = await fetch('/api/violations', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to log violation');
      onCreated?.(d.violation);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Log Lease Violation">
      <form className="modal-form" onSubmit={submit}>
        {error && <div className="auth-error">{error}</div>}

        {!propertyId && (
          <label>
            Property
            <select
              className="form-select"
              value={propId}
              onChange={(e) => { setPropId(e.target.value); setRoomId(''); }}
              required
            >
              <option value="">Select a property...</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}

        <label>
          Room <span className="form-optional">(optional — leave blank for property-wide)</span>
          <select
            className="form-select"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            disabled={!propId || propRooms.length === 0}
          >
            <option value="">Property-wide</option>
            {propRooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>

        <label>
          Resident name <span className="form-optional">(optional)</span>
          <input
            type="text"
            className="maint-input"
            value={residentName}
            onChange={(e) => setResidentName(e.target.value)}
            placeholder="e.g. Jane Smith"
          />
        </label>

        <label>
          Violation type
          <select
            className="form-select"
            value={violationType}
            onChange={(e) => setViolationType(e.target.value)}
            required
          >
            <option value="">Select a violation type...</option>
            {VIOLATION_TYPES.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        {violationType === 'OTHER' && (
          <label>
            Describe the violation
            <input
              type="text"
              className="maint-input"
              value={otherDescription}
              onChange={(e) => setOtherDescription(e.target.value)}
              placeholder="Brief description..."
              required
            />
          </label>
        )}

        <label>
          Notes <span className="form-optional">(optional)</span>
          <textarea
            className="detail-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What did you observe?"
            rows={3}
          />
        </label>

        <label>
          Photos <span className="form-optional">(optional, up to 5)</span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handlePhotoPick}
              style={{ display: 'none' }}
            />
            <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
              {photos.length > 0 ? `Change photos (${photos.length})` : '+ Add photos'}
            </button>
            {photoPreviews.map((src, i) => (
              <div key={i} className="photo-thumb-sm"><img src={src} alt="" /></div>
            ))}
          </div>
        </label>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Logging...' : 'Log Violation'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
