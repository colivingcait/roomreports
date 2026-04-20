import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { FLAG_CATEGORIES } from '../../../shared/index.js';

export default function PublicReport() {
  const { slug } = useParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [orgFound, setOrgFound] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [property, setProperty] = useState(null);

  const [reporterName, setReporterName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/public/org/${slug}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('Organization not found');
        setOrgFound(true);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!orgFound) return;
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/public/org/${slug}/properties?search=${encodeURIComponent(q)}`);
        const data = await r.json();
        if (r.ok) setSearchResults(data.properties || []);
      } catch { /* ignore */ }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, orgFound, slug]);

  const selectProperty = async (propertyId) => {
    try {
      const r = await fetch(`/api/public/org/${slug}/property/${propertyId}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setProperty(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/public/report/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: property.propertyId,
          roomId: roomId || null,
          description,
          flagCategory: category,
          note: note || null,
          reporterName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="pub-loading">Loading...</div>;
  if (error && !orgFound) return <div className="pub-error-page"><div className="auth-error">{error}</div></div>;

  if (done) {
    return (
      <div className="pub-done">
        <div className="pub-done-card">
          <div className="pub-done-emoji">{'\u{1F527}'}</div>
          <h1>Report received</h1>
          <p>Thanks — your maintenance team has been notified. {'\u2713'}</p>
        </div>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="pub-landing">
        <div className="pub-landing-card">
          <h1 className="pub-logo">RoomReport</h1>
          <h2 className="pub-landing-title">Report a Maintenance Issue</h2>
          <p className="pub-landing-desc">Enter your street name to find your place.</p>
          {error && <div className="auth-error">{error}</div>}
          <label className="pub-field">
            Street name
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g. Main St"
              className="pub-input"
              autoFocus
            />
          </label>
          <div className="pub-search-results">
            {searching && <p className="pub-hint">Searching...</p>}
            {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
              <p className="pub-hint">No matches. Try a different street name.</p>
            )}
            {searchResults.map((p) => (
              <button
                key={p.id}
                type="button"
                className="pub-search-item"
                onClick={() => selectProperty(p.id)}
              >
                {p.address}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pub-landing">
      <div className="pub-landing-card">
        <h1 className="pub-logo">RoomReport</h1>
        <h2 className="pub-landing-title">Report a Maintenance Issue</h2>
        <p className="pub-property-name">{property.address}</p>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit} className="modal-form">
          <label className="pub-field">
            Your name
            <input
              type="text"
              value={reporterName}
              onChange={(e) => setReporterName(e.target.value)}
              placeholder="Jane Doe"
              className="pub-input"
              required
            />
          </label>
          <label className="pub-field">
            Room <span className="form-optional">(optional)</span>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="pub-select">
              <option value="">— Common area / not a specific room —</option>
              {property.rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="pub-field">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="pub-select">
              {FLAG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="pub-field">
            What&apos;s the issue?
            <textarea
              className="detail-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the problem..."
              rows={3}
              required
            />
          </label>
          <label className="pub-field">
            Notes <span className="form-optional">(optional)</span>
            <textarea
              className="detail-textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any details that would help the maintenance team..."
              rows={2}
            />
          </label>
          <button
            type="submit"
            className="pub-start-btn"
            disabled={submitting || !reporterName.trim() || !description.trim()}
          >
            {submitting ? 'Submitting...' : 'Submit Report'}
          </button>
        </form>
      </div>
    </div>
  );
}
