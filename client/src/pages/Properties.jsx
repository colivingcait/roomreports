import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';

export default function Properties() {
  const navigate = useNavigate();
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchProperties = async () => {
    try {
      const res = await fetch('/api/properties', { credentials: 'include' });
      const data = await res.json();
      setProperties(data.properties || []);
    } catch {
      setError('Failed to load properties');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProperties(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowAdd(false);
      setName('');
      setAddress('');
      fetchProperties();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="page-loading">Loading properties...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Properties</h1>
          <p className="page-subtitle">{properties.length} {properties.length === 1 ? 'property' : 'properties'}</p>
        </div>
        <button className="btn-primary-sm" onClick={() => setShowAdd(true)}>
          + Add Property
        </button>
      </div>

      {error && <div className="auth-error">{error}</div>}

      {properties.length === 0 ? (
        <div className="empty-state">
          <p>No properties yet</p>
          <button className="btn-primary-sm" onClick={() => setShowAdd(true)}>Add your first property</button>
        </div>
      ) : (
        <div className="property-grid">
          {properties.map((p) => (
            <div key={p.id} className="property-card" onClick={() => navigate(`/properties/${p.id}`)}>
              <h3>{p.name}</h3>
              <p className="property-address">{p.address}</p>
              <div className="property-counts">
                <span>{p._count.rooms} {p._count.rooms === 1 ? 'room' : 'rooms'}</span>
                <span className="dot" />
                <span>{p._count.kitchens} {p._count.kitchens === 1 ? 'kitchen' : 'kitchens'}</span>
                <span className="dot" />
                <span>{p._count.bathrooms} {p._count.bathrooms === 1 ? 'bath' : 'baths'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showAdd} onClose={() => { setShowAdd(false); setError(''); }} title="Add Property">
        <form onSubmit={handleAdd} className="modal-form">
          <label>
            Property name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sunset House" required />
          </label>
          <label>
            Address
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, Austin TX" required />
          </label>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Creating...' : 'Create Property'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
