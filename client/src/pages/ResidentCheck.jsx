import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// Items where we strongly prompt for a photo
const PHOTO_PROMPTS = new Set([
  'How does your room look overall?',
  'Any issues under your sink?',
  'How\u2019s your bathroom?',
  'Check your closet area',
]);

// Answers that indicate a problem (auto-flag for maintenance)
const PROBLEM_ANSWERS = new Set([
  'Needs Help',
  'Could Use Attention',
  'I See a Problem',
  'Needs Cleaning',
  'Something\u2019s Broken',
  'Issue to Report',
  'Wear or Damage',
  'Marks or Damage',
  'Yes',
  'Yes \u2014 Let me tell you',
]);

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

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
      setItems(data.inspection.items || []);
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => { fetchInspection(); }, [fetchInspection]);

  const currentItem = items[index];

  // Reset note when item changes
  useEffect(() => {
    setNote(currentItem?.note || '');
  }, [currentItem?.id]);

  if (!inspection) return <div className="resident-loading">Loading...</div>;

  const total = items.length;
  const isLast = index === total - 1;
  const canGoNext = !!currentItem?.status;
  const isProblem = PROBLEM_ANSWERS.has(currentItem?.status);
  const needsPhoto = PHOTO_PROMPTS.has(currentItem?.text) && isProblem;

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
    const problem = PROBLEM_ANSWERS.has(option);
    const changes = {
      status: option,
      flagCategory: problem ? 'Other' : null,
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
      const form = new FormData();
      form.append('photo', file);
      const res = await fetch(`/api/inspections/${id}/items/${currentItem.id}/photos`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (res.ok) {
        const data = await res.json();
        const updated = { ...currentItem, photos: [...(currentItem.photos || []), data.photo] };
        setItems((prev) => prev.map((i) => (i.id === currentItem.id ? updated : i)));
      }
    } catch { /* ignore */ } finally {
      setUploading(false);
      fileRef.current.value = '';
    }
  };

  const handleNext = () => {
    if (!canGoNext) return;
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
      // If any items are still blank, set their status to auto-fill
      const blankItems = items.filter((i) => !i.status);
      for (const item of blankItems) {
        await api(`/api/inspections/${id}/items/${item.id}`, {
          method: 'PUT',
          body: JSON.stringify({ status: item.options?.[0] || 'Yes' }),
        });
      }
      await api(`/api/inspections/${id}/submit`, { method: 'POST' });
      navigate(`/resident/done/${id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!currentItem) return null;

  return (
    <div className="resident-check">
      {/* Progress dots */}
      <div className="resident-progress">
        {items.map((_, i) => (
          <span
            key={i}
            className={`progress-dot ${i === index ? 'current' : ''} ${i < index || items[i].status ? 'done' : ''}`}
          />
        ))}
      </div>

      <div className="resident-step">
        <h2 className="resident-question">{currentItem.text}</h2>

        {error && <div className="auth-error">{error}</div>}

        <div className="resident-answers">
          {currentItem.options?.map((opt) => {
            const isSelected = currentItem.status === opt;
            const isProblemOpt = PROBLEM_ANSWERS.has(opt);
            return (
              <button
                key={opt}
                className={`resident-answer ${isSelected ? 'selected' : ''} ${isProblemOpt ? 'problem' : 'good'}`}
                onClick={() => handleAnswer(opt)}
              >
                {opt}
              </button>
            );
          })}
        </div>

        {/* Photo prompt and note for problem answers */}
        {isProblem && (
          <div className="resident-detail">
            {(currentItem.photos?.length > 0) && (
              <div className="photo-grid" style={{ marginBottom: '0.75rem' }}>
                {currentItem.photos.map((p) => (
                  <div key={p.id} className="photo-thumb">
                    <img src={p.url} alt="" />
                  </div>
                ))}
              </div>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhoto}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="resident-photo-btn"
              onClick={() => fileRef.current.click()}
              disabled={uploading}
            >
              {uploading ? 'Uploading...' : (currentItem.photos?.length > 0 ? 'Add Another Photo' : needsPhoto ? 'Add Photo (recommended)' : 'Add Photo')}
            </button>

            <label className="resident-note-label">
              Any details to share?
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={handleNoteBlur}
                placeholder="Tell us more..."
                className="resident-note"
                rows={3}
              />
            </label>
          </div>
        )}
      </div>

      <div className="resident-footer">
        <button
          className="resident-back"
          onClick={handleBack}
          disabled={index === 0}
        >
          &larr; Back
        </button>

        <span className="resident-step-count">{index + 1} of {total}</span>

        <button
          className="resident-next"
          onClick={handleNext}
          disabled={!canGoNext || submitting}
        >
          {isLast ? (submitting ? 'Submitting...' : 'Finish') : 'Next \u2192'}
        </button>
      </div>
    </div>
  );
}
