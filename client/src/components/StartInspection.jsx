import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Modal from './Modal';

const INSPECTION_TYPES = [
  { value: 'COMMON_AREA', label: 'Common Area', needsRoom: false },
  { value: 'ROOM_TURN', label: 'Room Turn', needsRoom: true },
  { value: 'QUARTERLY', label: 'Quarterly', needsRoom: true },
  { value: 'RESIDENT_SELF_CHECK', label: 'Resident Self-Check', needsRoom: true },
  { value: 'MOVE_IN_OUT', label: 'Move-In/Out', needsRoom: true },
];

const ROLE_TYPES = {
  OWNER: INSPECTION_TYPES.map((t) => t.value),
  PM: INSPECTION_TYPES.map((t) => t.value),
  CLEANER: ['COMMON_AREA', 'ROOM_TURN'],
  RESIDENT: ['RESIDENT_SELF_CHECK'],
};

export default function StartInspection({ open, onClose }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState('');
  const [type, setType] = useState('');
  const [roomId, setRoomId] = useState('');
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const allowedTypes = INSPECTION_TYPES.filter((t) =>
    (ROLE_TYPES[user?.role] || []).includes(t.value),
  );

  const selectedType = INSPECTION_TYPES.find((t) => t.value === type);

  useEffect(() => {
    if (open) {
      fetch('/api/properties', { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => setProperties(d.properties || []));
    }
  }, [open]);

  useEffect(() => {
    if (propertyId && selectedType?.needsRoom) {
      fetch(`/api/properties/${propertyId}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => setRooms(d.property?.rooms || []));
    } else {
      setRooms([]);
      setRoomId('');
    }
  }, [propertyId, selectedType?.needsRoom]);

  const handleStart = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const body = { type, propertyId };
      if (selectedType?.needsRoom) body.roomId = roomId;

      const res = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onClose();
      navigate(`/inspections/${data.inspection.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setPropertyId('');
    setType('');
    setRoomId('');
    setRooms([]);
    setError('');
  };

  return (
    <Modal
      open={open}
      onClose={() => { onClose(); reset(); }}
      title="Start Inspection"
    >
      <form onSubmit={handleStart} className="modal-form">
        {error && <div className="auth-error">{error}</div>}

        <label>
          Property
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            required
            className="form-select"
          >
            <option value="">Select a property...</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        <label>
          Inspection Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            required
            className="form-select"
          >
            <option value="">Select type...</option>
            {allowedTypes.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>

        {selectedType?.needsRoom && (
          <label>
            Room
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              required
              className="form-select"
            >
              <option value="">Select a room...</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>
        )}

        <label>
          Inspector
          <input type="text" value={user?.name || ''} disabled className="form-input-disabled" />
        </label>

        <button
          type="submit"
          className="btn-primary"
          disabled={loading || !propertyId || !type || (selectedType?.needsRoom && !roomId)}
        >
          {loading ? 'Starting...' : 'Start Inspection'}
        </button>
      </form>
    </Modal>
  );
}
