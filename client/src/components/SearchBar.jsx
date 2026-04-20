import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const TYPE_LABELS = {
  COMMON_AREA: 'Common Area', ROOM_TURN: 'Room Turn', QUARTERLY: 'Room Inspection',
  RESIDENT_SELF_CHECK: 'Self-Check', MOVE_IN_OUT: 'Move-In',
};

export default function SearchBar({ onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef();
  const timerRef = useRef();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleChange = (val) => {
    setQuery(val);
    clearTimeout(timerRef.current);
    if (val.trim().length < 2) { setResults(null); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(val)}`, { credentials: 'include' });
        const data = await res.json();
        setResults(data);
      } catch { setResults(null); }
      finally { setLoading(false); }
    }, 300);
  };

  const go = (path) => { navigate(path); onClose?.(); };

  const hasResults = results && (results.properties?.length || results.inspections?.length || results.maintenance?.length);

  return (
    <div className="search-container">
      <div className="search-input-wrap">
        <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input
          ref={inputRef}
          className="search-input"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search properties, inspections, maintenance..."
        />
        {onClose && <button className="search-close" onClick={onClose}>&times;</button>}
      </div>

      {query.length >= 2 && (
        <div className="search-results">
          {loading && <div className="search-loading">Searching...</div>}
          {!loading && !hasResults && <div className="search-empty">No results found</div>}

          {results?.properties?.length > 0 && (
            <div className="search-group">
              <h4>Properties</h4>
              {results.properties.map((p) => (
                <div key={p.id} className="search-item" onClick={() => go(`/properties/${p.id}`)}>
                  <span className="search-item-title">{p.name}</span>
                  <span className="search-item-sub">{p.address}</span>
                </div>
              ))}
            </div>
          )}

          {results?.inspections?.length > 0 && (
            <div className="search-group">
              <h4>Inspections</h4>
              {results.inspections.map((i) => (
                <div key={i.id} className="search-item" onClick={() => go(`/inspections/${i.id}`)}>
                  <span className="search-item-title">{i.property?.name} — {TYPE_LABELS[i.type] || i.type}</span>
                  <span className="search-item-sub">{i.room?.label || ''} {i.status}</span>
                </div>
              ))}
            </div>
          )}

          {results?.maintenance?.length > 0 && (
            <div className="search-group">
              <h4>Maintenance</h4>
              {results.maintenance.map((m) => (
                <div key={m.id} className="search-item" onClick={() => go('/maintenance')}>
                  <span className="search-item-title">{m.description}</span>
                  <span className="search-item-sub">{m.property?.name} — {m.zone}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
