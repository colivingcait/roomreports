import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Modal from './Modal';
import {
  INSPECTION_TYPE_LABELS,
  INSPECTION_TYPE_COLORS,
} from '../../../shared/index.js';

// ─── Inspection types (order + room requirement) ──────
const INSPECTION_TYPES = [
  {
    value: 'QUARTERLY',
    description: 'Walk all rooms in one batch — compliance, maintenance, misc.',
    needsRoom: false,
  },
  {
    value: 'COMMON_AREA',
    description: 'Kitchens, shared bathrooms, common areas, exterior.',
    needsRoom: false,
  },
  {
    value: 'ROOM_TURN',
    description: 'Turnover cleaning + condition check for a specific room.',
    needsRoom: true,
  },
  {
    value: 'MOVE_IN_OUT',
    description: 'Photo-first move-in condition baseline for a resident.',
    needsRoom: true,
  },
  {
    value: 'RESIDENT_SELF_CHECK',
    description: 'A resident self-reports on their own room.',
    needsRoom: true,
  },
];

const ROLE_TYPES = {
  OWNER: INSPECTION_TYPES.map((t) => t.value),
  PM: INSPECTION_TYPES.map((t) => t.value),
  CLEANER: ['COMMON_AREA', 'ROOM_TURN'],
  RESIDENT: ['RESIDENT_SELF_CHECK'],
};

// ─── Inline icons per inspection type ────────────────
const TypeIcon = ({ type }) => {
  const common = { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (type) {
    case 'QUARTERLY':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M8 9h8M8 13h8M8 17h5" />
        </svg>
      );
    case 'COMMON_AREA':
      return (
        <svg {...common}>
          <path d="M3 11v8h4v-4h10v4h4v-8l-9-6z" />
        </svg>
      );
    case 'ROOM_TURN':
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 0116-6l2-2v6h-6l2-2a6 6 0 00-10 4" />
          <path d="M21 12a9 9 0 01-16 6l-2 2v-6h6l-2 2a6 6 0 0010-4" />
        </svg>
      );
    case 'MOVE_IN_OUT':
      return (
        <svg {...common}>
          <path d="M4 20h6V4H4z" />
          <path d="M14 12h7M17 9l3 3-3 3" />
        </svg>
      );
    case 'RESIDENT_SELF_CHECK':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3" />
          <path d="M4 21v-2a6 6 0 016-6h4a6 6 0 016 6v2" />
          <path d="M15 14l1.5 1.5L19 13" />
        </svg>
      );
    default:
      return null;
  }
};

function initialsOf(name) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function tileHueFor(id) {
  // deterministic green/amber/terracotta rotation so tiles aren't all the same
  const hues = ['#6B8F71', '#C4703F', '#8A2B6D', '#2B5F8A', '#BA7517'];
  const seed = (id || '').charCodeAt(0) || 0;
  return hues[seed % hues.length];
}

function PropertyTile({ property }) {
  if (property.imageUrl) {
    return (
      <div className="si-prop-thumb">
        <img src={property.imageUrl} alt="" />
      </div>
    );
  }
  return (
    <div
      className="si-prop-thumb si-prop-thumb-initials"
      style={{ background: tileHueFor(property.id) }}
    >
      {initialsOf(property.name)}
    </div>
  );
}

// ─── Main component ───────────────────────────────────

export default function StartInspection({ open, onClose, defaultPropertyId }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  // When defaultPropertyId is set we skip step 1 entirely.
  const initialStep = defaultPropertyId ? 'type' : 'property';

  const [step, setStep] = useState(initialStep);
  const [propertyId, setPropertyId] = useState(defaultPropertyId || '');
  const [type, setType] = useState('');
  const [properties, setProperties] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const allowedTypes = INSPECTION_TYPES.filter((t) =>
    (ROLE_TYPES[user?.role] || []).includes(t.value),
  );
  const selectedType = INSPECTION_TYPES.find((t) => t.value === type);

  const reset = useCallback(() => {
    setStep(defaultPropertyId ? 'type' : 'property');
    setPropertyId(defaultPropertyId || '');
    setType('');
    setRooms([]);
    setError('');
  }, [defaultPropertyId]);

  // Reset every time the modal is opened; fetch property list on step 1.
  useEffect(() => {
    if (!open) return;
    reset();
    if (!defaultPropertyId) {
      fetch('/api/properties', { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => setProperties(d.properties || []))
        .catch(() => {});
    }
  }, [open, reset, defaultPropertyId]);

  const startInspection = useCallback(async (pickedRoomId) => {
    setStarting(true);
    setError('');
    try {
      // QUARTERLY has its own batch flow (no POST)
      if (type === 'QUARTERLY') {
        onClose();
        navigate(`/quarterly/${propertyId}`);
        return;
      }

      const body = { type, propertyId };
      if (selectedType?.needsRoom && pickedRoomId) body.roomId = pickedRoomId;

      const res = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start inspection');

      onClose();
      if (type === 'COMMON_AREA') {
        navigate(`/common-area/${data.inspection.id}`);
      } else if (type === 'ROOM_TURN') {
        navigate(`/room-turn/${data.inspection.id}`);
      } else {
        navigate(`/inspections/${data.inspection.id}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }, [type, propertyId, selectedType, navigate, onClose]);

  const handlePickType = async (t) => {
    setType(t.value);
    if (!t.needsRoom) {
      // Start immediately — no room required.
      // startInspection reads `type` from state, which we just set, but the
      // closure captures the previous value. Use a direct call by updating
      // and awaiting via micro-pass: swap in the new type before calling.
      // Simpler: inline the start logic here using `t.value` directly.
      setStarting(true);
      setError('');
      try {
        if (t.value === 'QUARTERLY') {
          onClose();
          navigate(`/quarterly/${propertyId}`);
          return;
        }
        const res = await fetch('/api/inspections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ type: t.value, propertyId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to start inspection');
        onClose();
        if (t.value === 'COMMON_AREA') navigate(`/common-area/${data.inspection.id}`);
        else navigate(`/inspections/${data.inspection.id}`);
      } catch (err) {
        setError(err.message);
      } finally {
        setStarting(false);
      }
      return;
    }
    // Needs a room — go fetch rooms and advance to step 3.
    setLoadingRooms(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}`, { credentials: 'include' });
      const d = await res.json();
      setRooms(d.property?.rooms || []);
    } catch {
      setRooms([]);
    } finally {
      setLoadingRooms(false);
      setStep('room');
    }
  };

  const title =
    step === 'property' ? 'Start an inspection'
      : step === 'type' ? 'What kind of inspection?'
      : 'Which room?';

  const activeProperty = properties.find((p) => p.id === propertyId);

  return (
    <Modal
      open={open}
      onClose={() => { onClose(); reset(); }}
      title={title}
      size="wide"
    >
      <div className="si-root">
        {/* ─── Step 1: Property ─── */}
        {step === 'property' && (
          <>
            {properties.length === 0 ? (
              <div className="empty-state"><p>No properties yet. Add one first.</p></div>
            ) : (
              <div className="si-grid si-grid-prop">
                {properties.map((p) => (
                  <button
                    key={p.id}
                    className="si-card si-card-prop"
                    onClick={() => { setPropertyId(p.id); setStep('type'); }}
                  >
                    <PropertyTile property={p} />
                    <div className="si-card-body">
                      <div className="si-card-title">{p.name}</div>
                      <div className="si-card-sub">{p.address}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* ─── Step 2: Type ─── */}
        {step === 'type' && (
          <>
            {activeProperty && (
              <div className="si-context-row">
                <PropertyTile property={activeProperty} />
                <div>
                  <div className="si-context-label">Property</div>
                  <div className="si-context-value">{activeProperty.name}</div>
                </div>
              </div>
            )}
            {error && <div className="auth-error">{error}</div>}
            <div className="si-grid si-grid-type">
              {allowedTypes.map((t) => {
                const c = INSPECTION_TYPE_COLORS[t.value] || {};
                return (
                  <button
                    key={t.value}
                    className="si-card si-card-type"
                    style={{ '--type-bg': c.bg || '#F5F2EF', '--type-color': c.color || '#4A4543' }}
                    onClick={() => handlePickType(t)}
                    disabled={starting}
                  >
                    <div className="si-type-icon">
                      <TypeIcon type={t.value} />
                    </div>
                    <div className="si-card-body">
                      <div className="si-card-title">{INSPECTION_TYPE_LABELS[t.value]}</div>
                      <div className="si-card-sub">{t.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            {starting && <div className="si-starting">Starting inspection…</div>}
          </>
        )}

        {/* ─── Step 3: Room ─── */}
        {step === 'room' && (
          <>
            {activeProperty && (
              <div className="si-context-row">
                <PropertyTile property={activeProperty} />
                <div>
                  <div className="si-context-label">
                    {INSPECTION_TYPE_LABELS[type]} &middot; {activeProperty.name}
                  </div>
                  <div className="si-context-value">Pick a room</div>
                </div>
              </div>
            )}
            {error && <div className="auth-error">{error}</div>}
            {loadingRooms ? (
              <div className="page-loading">Loading rooms…</div>
            ) : rooms.length === 0 ? (
              <div className="empty-state"><p>No rooms on this property yet.</p></div>
            ) : (
              <div className="si-grid si-grid-room">
                {rooms.map((r) => (
                  <button
                    key={r.id}
                    className="si-card si-card-room"
                    onClick={() => startInspection(r.id)}
                    disabled={starting}
                  >
                    <div className="si-card-title">{r.label}</div>
                    {r.features?.length > 0 && (
                      <div className="si-room-features">
                        {r.features.slice(0, 3).map((f) => (
                          <span key={f} className="si-room-feature">{f}</span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
            {starting && <div className="si-starting">Starting inspection…</div>}
          </>
        )}

        {/* ─── Footer (back / cancel) ─── */}
        <div className="si-footer">
          {step === 'property' && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { onClose(); reset(); }}
            >
              Cancel
            </button>
          )}
          {step === 'type' && !defaultPropertyId && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setStep('property'); setType(''); }}
            >
              &larr; Back
            </button>
          )}
          {step === 'type' && defaultPropertyId && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { onClose(); reset(); }}
            >
              Cancel
            </button>
          )}
          {step === 'room' && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setStep('type'); }}
            >
              &larr; Back
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
