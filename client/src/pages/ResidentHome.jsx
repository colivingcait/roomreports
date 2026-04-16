import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ResidentHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [properties, setProperties] = useState([]);
  const [roomId, setRoomId] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [lastCheck, setLastCheck] = useState(null);

  useEffect(() => {
    // Load available rooms (residents usually have only one)
    fetch('/api/properties', { credentials: 'include' })
      .then((r) => r.json())
      .then(async (d) => {
        const props = d.properties || [];
        setProperties(props);
        // Load rooms for each property
        const allRooms = [];
        for (const p of props) {
          const res = await fetch(`/api/properties/${p.id}`, { credentials: 'include' });
          const data = await res.json();
          for (const r of data.property?.rooms || []) {
            allRooms.push({ ...r, propertyName: p.name, propertyId: p.id });
          }
        }
        setRooms(allRooms);
        if (allRooms.length === 1) setRoomId(allRooms[0].id);
      });

    // Fetch last self-check for friendly context
    fetch('/api/inspections?type=RESIDENT_SELF_CHECK', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.inspections?.length) {
          setLastCheck(d.inspections[0]);
        }
      });
  }, []);

  const handleStart = async () => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) {
      setError('Please select your room');
      return;
    }
    setStarting(true);
    setError('');
    try {
      const res = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          type: 'RESIDENT_SELF_CHECK',
          propertyId: room.propertyId,
          roomId: room.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      navigate(`/resident/check/${data.inspection.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const formatDate = (d) => {
    if (!d) return '';
    const date = new Date(d);
    const now = new Date();
    const diff = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'today';
    if (diff === 1) return 'yesterday';
    if (diff < 30) return `${diff} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="resident-home">
      <div className="resident-greeting">
        <h1>Hi {user?.name?.split(' ')[0] || 'there'}!</h1>
        <p>Time for your monthly room check</p>
      </div>

      {lastCheck && (
        <p className="resident-last-check">
          Your last check was {formatDate(lastCheck.createdAt)}
        </p>
      )}

      {rooms.length > 1 && (
        <div className="resident-room-select">
          <label>Which room?</label>
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="form-select">
            <option value="">Choose your room...</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.propertyName} — {r.label}</option>
            ))}
          </select>
        </div>
      )}

      {rooms.length === 0 && (
        <div className="resident-empty">
          <p>You don&apos;t have a room assigned yet.</p>
          <p className="resident-empty-sub">Ask your property manager to add you.</p>
        </div>
      )}

      {error && <div className="auth-error">{error}</div>}

      {rooms.length > 0 && (
        <button
          className="btn-resident-big"
          onClick={handleStart}
          disabled={starting || !roomId}
        >
          {starting ? 'Getting ready...' : 'Start Monthly Room Check'}
        </button>
      )}

      <p className="resident-estimate">Takes about 2-3 minutes</p>
    </div>
  );
}
