import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { ChecklistItem } from '../components/InspectionItems';

const MOVEIN_PHOTOS = [
  'Take a photo of Wall 1',
  'Take a photo of Wall 2',
  'Take a photo of Wall 3',
  'Take a photo of Wall 4',
  'Take a photo of the floor',
  'Take a photo of the ceiling',
  'Take a photo of your window(s)',
  'Take a photo of the closet/clothing rack',
  'Take a photo of the mattress',
];

const SELFCHECK_PHOTOS = [
  'Take a photo of Wall 1',
  'Take a photo of Wall 2',
  'Take a photo of Wall 3',
  'Take a photo of Wall 4',
  'Take a photo of your mattress',
  'Take a photo of your window(s)',
  'Take a photo of your smoke detector',
];

const MOVEIN_QUESTIONS = [
  { text: 'Room is clean and ready?', goodAnswer: 'Pass' },
  { text: 'No unusual odors?', goodAnswer: 'Pass' },
  { text: 'All furniture present and in good condition?', goodAnswer: 'Pass' },
  { text: 'Door lock working properly?', goodAnswer: 'Pass' },
  { text: 'Lights and outlets all working?', goodAnswer: 'Pass' },
  { text: 'Smoke detector present?', goodAnswer: 'Pass' },
  { text: 'Any existing damage to note?', goodAnswer: 'Pass' },
  { text: 'Everything looks good overall?', goodAnswer: 'Pass' },
];

const SELFCHECK_QUESTIONS = [
  { text: 'Any pest issues?', goodAnswer: 'Pass' },
  { text: 'Any mold or mildew?', goodAnswer: 'Pass' },
  { text: 'Any water leaks?', goodAnswer: 'Pass' },
  { text: 'Any broken furniture?', goodAnswer: 'Pass' },
  { text: 'Is your door lock working properly?', goodAnswer: 'Pass' },
  { text: 'Any other concerns?', goodAnswer: 'Pass' },
];

// ─── Photo Screen ───────────────────────────────────────

function PhotoScreen({ text, photo, onTakePhoto, uploading, onNext, onBack, progress, total, canGoBack }) {
  const fileRef = useRef();

  return (
    <div className="pub-screen">
      <div className="pub-progress-bar">
        <div className="pub-progress-fill" style={{ width: `${(progress / total) * 100}%` }} />
      </div>
      <div className="pub-progress-label">{progress} of {total}</div>

      <div className="pub-screen-content">
        <h2 className="pub-instruction">{text}</h2>

        {photo ? (
          <div className="pub-photo-preview">
            <img src={photo} alt="" />
          </div>
        ) : null}

        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onTakePhoto(file);
          fileRef.current.value = '';
        }} style={{ display: 'none' }} />

        <button className="pub-camera-btn" onClick={() => fileRef.current.click()} disabled={uploading}>
          <span className="pub-camera-icon">{'\uD83D\uDCF7'}</span>
          <span>{uploading ? 'Uploading...' : photo ? 'Retake photo' : 'Take photo'}</span>
        </button>

        {!photo && <p className="pub-hint">A photo is required to continue</p>}
      </div>

      <div className="pub-footer">
        {canGoBack ? <button className="pub-back" onClick={onBack}>&larr; Back</button> : <div />}
        <button className="pub-next" onClick={onNext} disabled={!photo}>Next &rarr;</button>
      </div>
    </div>
  );
}

// ─── Questions Screen ───────────────────────────────────

function QuestionsScreen({ questions, answers, onAnswer, onSubmit, submitting, onBack, isMoveIn }) {
  const allAnswered = questions.every((_, i) => answers[i]?.status);
  const fileRefs = useRef({});

  return (
    <div className="pub-screen">
      <div className="pub-screen-content" style={{ maxWidth: 640 }}>
        <h2 className="pub-section-title">{isMoveIn ? 'Quick Check' : 'Any Issues?'}</h2>
        <div className="pub-questions">
          {questions.map((q, i) => {
            const ans = answers[i] || {};
            const isFailed = ans.status === 'Fail';
            return (
              <div key={i} className={`q-item ${ans.status === 'Pass' ? 'q-item-pass' : ''} ${isFailed ? 'q-item-fail' : ''}`}>
                <div className="q-item-row">
                  <div className="q-item-text">{q.text}</div>
                  <div className="q-item-buttons">
                    <button
                      className={`q-btn q-btn-pass ${ans.status === 'Pass' ? 'active' : ''}`}
                      onClick={() => onAnswer(i, { status: 'Pass', note: null, flagCategory: null })}
                    >&#10003;</button>
                    <button
                      className={`q-btn q-btn-fail ${ans.status === 'Fail' ? 'active' : ''}`}
                      onClick={() => onAnswer(i, { status: 'Fail', flagCategory: 'General' })}
                    >&#10005;</button>
                  </div>
                </div>
                {isFailed && (
                  <div className="pub-flag-detail">
                    <textarea
                      className="pub-flag-note"
                      value={ans.note || ''}
                      onChange={(e) => onAnswer(i, { ...ans, note: e.target.value })}
                      placeholder="Tell us more..."
                      rows={2}
                    />
                    {ans.photoUrl && (
                      <div className="photo-thumb" style={{ marginTop: '0.5rem' }}>
                        <img src={ans.photoUrl} alt="" />
                      </div>
                    )}
                    <input
                      ref={(el) => { fileRefs.current[i] = el; }}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onAnswer(i, { ...ans, photoFile: file, photoUrl: URL.createObjectURL(file) });
                      }}
                      style={{ display: 'none' }}
                    />
                    <button className="pub-add-photo-btn" onClick={() => fileRefs.current[i]?.click()}>
                      {ans.photoUrl ? 'Change photo' : 'Add photo'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="pub-footer">
        <button className="pub-back" onClick={onBack}>&larr; Back</button>
        <button className="pub-submit" onClick={onSubmit} disabled={!allAnswered || submitting}>
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────

export default function PublicInspection() {
  const { slug } = useParams();
  const path = window.location.pathname;
  const isMoveIn = path.startsWith('/movein');

  // Org-slug mode: street search → property → rooms. Legacy mode: slug is a property slug directly.
  const [orgMode, setOrgMode] = useState(false);
  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Property search (org-slug mode)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Landing state
  const [residentName, setResidentName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [started, setStarted] = useState(false);

  // Photo state
  const photoTexts = isMoveIn ? [...MOVEIN_PHOTOS] : [...SELFCHECK_PHOTOS];
  const [photoIndex, setPhotoIndex] = useState(0);
  const [photos, setPhotos] = useState([]); // array of { url, file }
  const [uploading, setUploading] = useState(false);
  const [photosDone, setPhotosDone] = useState(false);

  // Questions state
  const questions = isMoveIn ? MOVEIN_QUESTIONS : SELFCHECK_QUESTIONS;
  const [answers, setAnswers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Add ensuite bathroom photo for move-in
  useEffect(() => {
    if (isMoveIn && property && roomId) {
      const room = property.rooms.find((r) => r.id === roomId);
      if (room?.features?.includes('Ensuite Bathroom')) {
        const text = 'Take a photo of the bathroom';
        if (!photoTexts.includes(text)) photoTexts.push(text);
      }
    }
  }, [roomId, property]);

  // On mount: try org-slug first, fall back to legacy per-property slug
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const orgRes = await fetch(`/api/public/org/${slug}`);
        if (!cancelled && orgRes.ok) {
          setOrgMode(true);
          setLoading(false);
          return;
        }
        const propRes = await fetch(`/api/public/property/${slug}`);
        const data = await propRes.json();
        if (cancelled) return;
        if (!propRes.ok) throw new Error(data.error || 'Not found');
        setProperty(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Debounced property search
  useEffect(() => {
    if (!orgMode) return;
    const q = searchQuery.trim();
    if (q.length < 3) { setSearchResults([]); return; }
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
  }, [searchQuery, orgMode, slug]);

  const selectProperty = async (propertyId) => {
    try {
      const r = await fetch(`/api/public/org/${slug}/property/${propertyId}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setProperty({
        propertyId: data.propertyId,
        propertyName: data.address,
        rooms: data.rooms,
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleTakePhoto = async (file) => {
    setUploading(true);
    const url = URL.createObjectURL(file);
    const newPhotos = [...photos];
    newPhotos[photoIndex] = { url, file };
    setPhotos(newPhotos);
    setUploading(false);
  };

  const handleAnswer = (idx, data) => {
    const newAnswers = [...answers];
    newAnswers[idx] = { ...newAnswers[idx], ...data };
    setAnswers(newAnswers);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const endpoint = isMoveIn ? 'movein' : 'selfcheck';

      // Build items from photos + questions
      const items = [];
      for (let i = 0; i < photoTexts.length; i++) {
        items.push({
          zone: 'Photos',
          text: photoTexts[i],
          options: ['photo'],
          status: photos[i] ? 'Done' : '',
        });
      }
      for (let i = 0; i < questions.length; i++) {
        const ans = answers[i] || {};
        items.push({
          zone: 'Questions',
          text: questions[i].text,
          options: ['Pass', 'Fail'],
          status: ans.status || '',
          note: ans.note || null,
          flagCategory: ans.status === 'Fail' ? 'General' : null,
          isMaintenance: ans.status === 'Fail',
        });
      }

      const body = orgMode
        ? { residentName, roomId, propertyId: property.propertyId, items }
        : { residentName, roomId, items };
      const res = await fetch(`/api/public/${endpoint}/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Upload photos — best effort after inspection is created
      for (let i = 0; i < photos.length; i++) {
        if (!photos[i]?.file) continue;
        try {
          const form = new FormData();
          form.append('photo', photos[i].file);
          form.append('organizationId', property.propertyId);
          form.append('propertyId', property.propertyId);
          await fetch('/api/public/photo', { method: 'POST', body: form });
        } catch { /* best effort */ }
      }

      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="pub-loading">Loading...</div>;
  if (error && !property && !orgMode) return <div className="pub-error-page"><div className="auth-error">{error}</div></div>;

  // ─── PROPERTY SEARCH (org-slug mode, no property selected yet) ──
  if (orgMode && !property) {
    return (
      <div className="pub-landing">
        <div className="pub-landing-card">
          <h1 className="pub-logo">RoomReport</h1>
          <h2 className="pub-landing-title">
            {isMoveIn ? 'Move-In Room Inspection' : 'Monthly Room Check'}
          </h2>
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
            {!searching && searchQuery.trim().length >= 3 && searchResults.length === 0 && (
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

  // ─── CONFIRMATION ──────────────────────────────────────
  if (done) {
    return (
      <div className="pub-done">
        <div className="pub-done-card">
          <div className="pub-done-emoji">{'\u{1F3E0}'}</div>
          <h1>{isMoveIn ? 'Welcome to your new home!' : 'Thanks!'}</h1>
          <p>{isMoveIn ? 'Your move-in inspection is saved.' : 'Your room check is submitted.'} {'\u2713'}</p>
        </div>
      </div>
    );
  }

  // ─── LANDING ───────────────────────────────────────────
  if (!started) {
    return (
      <div className="pub-landing">
        <div className="pub-landing-card">
          <h1 className="pub-logo">RoomReport</h1>
          <h2 className="pub-landing-title">
            {isMoveIn ? 'Move-In Room Inspection' : 'Monthly Room Check'}
          </h2>
          <p className="pub-landing-desc">
            Take a few photos of your room, answer a couple quick questions, and let us know if there&apos;s any issues. Takes less than 3 minutes.
          </p>

          {property?.propertyName && (
            <p className="pub-property-name">{property.propertyName}</p>
          )}

          {error && <div className="auth-error">{error}</div>}

          <label className="pub-field">
            Your name
            <input
              type="text"
              value={residentName}
              onChange={(e) => setResidentName(e.target.value)}
              placeholder="Jane Doe"
              className="pub-input"
            />
          </label>

          <label className="pub-field">
            Select your room
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="pub-select">
              <option value="">Choose your room...</option>
              {(property?.rooms || []).map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>

          <button
            className="pub-start-btn"
            onClick={() => setStarted(true)}
            disabled={!residentName.trim() || !roomId}
          >
            Let&apos;s go
          </button>
        </div>
      </div>
    );
  }

  // ─── QUESTIONS ─────────────────────────────────────────
  if (photosDone) {
    return (
      <QuestionsScreen
        questions={questions}
        answers={answers}
        onAnswer={handleAnswer}
        onSubmit={handleSubmit}
        submitting={submitting}
        onBack={() => { setPhotosDone(false); setPhotoIndex(photoTexts.length - 1); }}
        isMoveIn={isMoveIn}
      />
    );
  }

  // ─── PHOTOS ────────────────────────────────────────────
  const totalScreens = photoTexts.length + 1; // +1 for questions
  return (
    <PhotoScreen
      text={photoTexts[photoIndex]}
      photo={photos[photoIndex]?.url}
      onTakePhoto={handleTakePhoto}
      uploading={uploading}
      progress={photoIndex + 1}
      total={totalScreens}
      canGoBack={photoIndex > 0}
      onBack={() => setPhotoIndex(photoIndex - 1)}
      onNext={() => {
        if (photoIndex < photoTexts.length - 1) {
          setPhotoIndex(photoIndex + 1);
        } else {
          setPhotosDone(true);
        }
      }}
    />
  );
}
