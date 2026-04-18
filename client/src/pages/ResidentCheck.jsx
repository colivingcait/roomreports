import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { queuePhoto } from '../lib/offlineStore';

// Questions where "Yes" indicates a problem (expand notes + photo)
const YES_IS_PROBLEM = new Set([
  'Any pest issues?',
  'Any mold or mildew?',
  'Any water leaks?',
  'Any broken furniture?',
  'Any other concerns?',
  'Any existing damage to note?',
]);

// Questions where "Yes" is the good answer (expand notes only if No)
// Default for all other yes/no items

// Questions that require a photo when the "problem" answer is selected
const REQUIRE_PHOTO_ON_PROBLEM = new Set([
  'Any pest issues?',
  'Any mold or mildew?',
  'Any water leaks?',
  'Any broken furniture?',
  'Any other concerns?',
  'Any existing damage to note?',
  'All furniture present and in good condition?',
]);

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function isPhotoScreen(item) {
  return item.zone === 'Photos' || item.text.startsWith('Take a photo');
}

function getProblemAnswer(text) {
  return YES_IS_PROBLEM.has(text) ? 'Yes' : 'No';
}

export default function ResidentCheck() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState(null);
  const [items, setItems] = useState([]);
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const fetchInspection = useCallback(async () => {
    try {
      const data = await api(`/api/inspections/${id}`);
      setInspection(data.inspection);
      const visible = (data.inspection.items || []).filter((i) => !i.zone.startsWith('_'));
      setItems(visible);
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => { fetchInspection(); }, [fetchInspection]);

  const currentItem = items[index];
  useEffect(() => { setNote(currentItem?.note || ''); }, [currentItem?.id]);

  if (!inspection) return <div className="resident-loading">Loading...</div>;
  if (!currentItem) return null;

  const total = items.length;
  const isLast = index === total - 1;
  const isPhoto = isPhotoScreen(currentItem);
  const problemAnswer = getProblemAnswer(currentItem.text);
  const isProblem = currentItem.status === problemAnswer;
  const requiresPhotoOnProblem = REQUIRE_PHOTO_ON_PROBLEM.has(currentItem.text);

  // Can advance conditions
  let canAdvance = false;
  if (isPhoto) {
    canAdvance = (currentItem.photos?.length || 0) > 0;
  } else {
    canAdvance = !!currentItem.status && (
      !isProblem ||
      !requiresPhotoOnProblem ||
      (currentItem.photos?.length || 0) > 0
    );
  }

  const updateItem = async (changes) => {
    const updated = { ...currentItem, ...changes };
    setItems((prev) => prev.map((i) => (i.id === currentItem.id ? updated : i)));
    try {
      await api(`/api/inspections/${id}/items/${currentItem.id}`, {
        method: 'PUT',
        body: JSON.stringify(changes),
      });
    } catch { /* ignore */ }
  };

  const handleAnswer = async (option) => {
    const problem = option === problemAnswer;
    const changes = {
      status: option,
      flagCategory: problem ? 'General' : null,
      isMaintenance: problem,
    };
    await updateItem(changes);
  };

  const handleNoteBlur = async () => {
    if (note !== currentItem.note) {
      await updateItem({ note: note || null });
    }
  };

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      if (!navigator.onLine) {
        await queuePhoto(id, currentItem.id, file, file.name);
        const localUrl = URL.createObjectURL(file);
        const updated = {
          ...currentItem,
          status: isPhoto ? 'Done' : currentItem.status,
          photos: [...(currentItem.photos || []), { id: `local-${Date.now()}`, url: localUrl, local: true }],
        };
        setItems((prev) => prev.map((i) => (i.id === currentItem.id ? updated : i)));
        if (isPhoto) {
          await api(`/api/inspections/${id}/items/${currentItem.id}`, {
            method: 'PUT', body: JSON.stringify({ status: 'Done' }),
          });
        }
      } else {
        const form = new FormData();
        form.append('photo', file);
        const res = await fetch(`/api/inspections/${id}/items/${currentItem.id}/photos`, {
          method: 'POST',
          credentials: 'include',
          body: form,
        });
        if (res.ok) {
          const data = await res.json();
          const updated = {
            ...currentItem,
            photos: [...(currentItem.photos || []), data.photo],
          };
          setItems((prev) => prev.map((i) => (i.id === currentItem.id ? updated : i)));
          // For photo-only screens, set status to Done so completion logic works
          if (isPhoto) await updateItem({ status: 'Done' });
        }
      }
    } catch { /* ignore */ } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleNext = () => {
    if (!canAdvance) return;
    if (isLast) return handleSubmit();
    setIndex(index + 1);
  };

  const handleBack = () => {
    if (index > 0) setIndex(index - 1);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await api(`/api/inspections/${id}/submit`, { method: 'POST' });
      navigate(`/resident/done/${id}`, {
        state: { type: inspection.type },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const typeLabel = inspection.type === 'MOVE_IN_OUT' ? 'Move-In' : 'Monthly Check';

  return (
    <div className="resident-check">
      {/* Progress dots */}
      <div className="resident-progress">
        {items.map((item, i) => {
          const done = i < index || (i === index && item.status);
          return (
            <span
              key={i}
              className={`progress-dot ${i === index ? 'current' : ''} ${done ? 'done' : ''}`}
            />
          );
        })}
      </div>

      <div className="resident-step-count">{index + 1} of {total}</div>

      <div className="resident-step">
        <h2 className="resident-question">{currentItem.text}</h2>

        {error && <div className="auth-error">{error}</div>}

        {isPhoto ? (
          <>
            {currentItem.photos?.length > 0 && (
              <div className="resident-photo-preview">
                <img src={currentItem.photos[currentItem.photos.length - 1].url} alt="" />
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
            <button
              type="button"
              className="resident-camera-btn"
              onClick={() => fileRef.current.click()}
              disabled={uploading}
            >
              <span className="resident-camera-icon">{'\uD83D\uDCF7'}</span>
              <span>
                {uploading
                  ? 'Uploading...'
                  : currentItem.photos?.length > 0
                    ? 'Retake photo'
                    : 'Take photo'}
              </span>
            </button>
            {!currentItem.photos?.length && (
              <p className="resident-photo-hint">A photo is required to continue</p>
            )}
          </>
        ) : (
          <>
            <div className="resident-yesno">
              <button
                className={`resident-yesno-btn resident-yesno-yes ${currentItem.status === 'Yes' ? 'selected' : ''}`}
                onClick={() => handleAnswer('Yes')}
              >
                Yes
              </button>
              <button
                className={`resident-yesno-btn resident-yesno-no ${currentItem.status === 'No' ? 'selected' : ''}`}
                onClick={() => handleAnswer('No')}
              >
                No
              </button>
            </div>

            {isProblem && (
              <div className="resident-detail">
                <label className="resident-note-label">
                  Tell us more
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={handleNoteBlur}
                    placeholder="What's happening?"
                    className="resident-note"
                    rows={3}
                  />
                </label>

                {currentItem.photos?.length > 0 && (
                  <div className="photo-grid" style={{ marginBottom: '0.75rem' }}>
                    {currentItem.photos.map((p) => (
                      <div key={p.id} className="photo-thumb">
                        <img src={p.url} alt="" />
                      </div>
                    ))}
                  </div>
                )}

                <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
                <button
                  type="button"
                  className="resident-photo-btn"
                  onClick={() => fileRef.current.click()}
                  disabled={uploading}
                >
                  {uploading
                    ? 'Uploading...'
                    : currentItem.photos?.length > 0
                      ? 'Add another photo'
                      : requiresPhotoOnProblem
                        ? 'Add photo (required)'
                        : 'Add photo'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="resident-footer">
        <button className="resident-back" onClick={handleBack} disabled={index === 0}>
          &larr; Back
        </button>
        <span className="resident-footer-label">{typeLabel}</span>
        <button
          className="resident-next"
          onClick={handleNext}
          disabled={!canAdvance || submitting}
        >
          {isLast ? (submitting ? 'Submitting...' : 'Finish') : 'Next \u2192'}
        </button>
      </div>
    </div>
  );
}
