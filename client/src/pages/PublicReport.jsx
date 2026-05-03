import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  CATEGORIES,
  COMMON_AREAS,
  triageStepsFor,
  PM_PHONE_TOKEN,
} from '../lib/residentReportConfig.js';

// ─── Helpers ───────────────────────────────────────────────

function fmtPhone(phone) {
  if (!phone) return null;
  const d = String(phone).replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return phone;
}

function renderPopupHtml(html, phone) {
  const formatted = fmtPhone(phone);
  const replacement = phone
    ? `Call your property manager: <a href="tel:${phone.replace(/\D/g, '')}" style="color:#3B6D8A;text-decoration:underline;">${formatted}</a>`
    : `<span style="color:#8A8583;">Contact your property manager.</span>`;
  return html.replace(PM_PHONE_TOKEN, replacement);
}

// Compress an image client-side to keep uploads fast on cellular.
async function compressImage(file, maxDim = 1920, quality = 0.82) {
  if (!file.type.startsWith('image/')) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    let { width, height } = img;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ─── Top-level component ───────────────────────────────────

export default function PublicReport() {
  const { slug } = useParams();

  const [bootLoading, setBootLoading] = useState(true);
  const [bootError, setBootError] = useState('');
  const [orgPhone, setOrgPhone] = useState(null);

  const [step, setStep] = useState(1);
  const [property, setProperty] = useState(null);

  // Step 1/2 — search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Step 3 — your info
  const [reporterName, setReporterName] = useState('');
  const [reporterEmail, setReporterEmail] = useState('');
  const [roomId, setRoomId] = useState(''); // either a room.id, or "common:kitchen", etc.

  // Step 4 — issue
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [triage, setTriage] = useState({}); // { stepId: value }

  // Step 5 — photos
  const [photos, setPhotos] = useState([]); // { file, previewUrl }
  const fileRef = useRef();
  const [photoError, setPhotoError] = useState('');

  // Wizard meta
  const [draftId, setDraftId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(false);
  const [trackingUrl, setTrackingUrl] = useState('');
  const [trackingToken, setTrackingToken] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [activePopup, setActivePopup] = useState(null);

  // Boot — verify org slug + pull contact phone.
  useEffect(() => {
    Promise.all([
      fetch(`/api/public/org/${slug}`).then((r) => r.ok ? r.json() : Promise.reject(new Error('Organization not found'))),
      fetch(`/api/public/org/${slug}/contact`).then((r) => r.ok ? r.json() : { phone: null }).catch(() => ({ phone: null })),
    ])
      .then(([, contact]) => {
        setOrgPhone(contact?.phone || null);
      })
      .catch((err) => setBootError(err.message))
      .finally(() => setBootLoading(false));
  }, [slug]);

  // Search debounce
  useEffect(() => {
    if (step !== 1 && step !== 2) return;
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
  }, [searchQuery, slug, step]);

  // Abandonment — sendBeacon when the resident closes the tab without
  // submitting or cancelling. Best-effort; failures are ignored.
  useEffect(() => {
    const handler = () => {
      if (!draftId || done || cancelled) return;
      try {
        const url = `/api/public/draft/${slug}/${draftId}/abandon`;
        if (navigator.sendBeacon) navigator.sendBeacon(url);
        else fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
      } catch { /* ignore */ }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [draftId, done, cancelled, slug]);

  const selectProperty = async (propertyId) => {
    try {
      const r = await fetch(`/api/public/org/${slug}/property/${propertyId}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setProperty(data);
      setStep(3);
    } catch (err) {
      setBootError(err.message);
    }
  };

  // Save the draft when transitioning out of Step 3.
  const finishStep3 = async () => {
    if (!reporterName.trim() || !roomId) return;
    if (!draftId) {
      try {
        const isCommon = roomId.startsWith('common:');
        const body = {
          propertyId: property.propertyId,
          roomId: isCommon ? null : roomId,
          reporterName: reporterName.trim(),
          reporterEmail: reporterEmail.trim() || null,
          reporterNotifyOptIn: !!reporterEmail.trim(),
          lastStepCompleted: 3,
        };
        // Capture the common-area choice in the description so the PM
        // sees it even though it isn't a real room row.
        if (isCommon) {
          const ca = COMMON_AREAS.find((c) => `common:${c.id}` === roomId);
          if (ca) body.note = `Reported area: ${ca.label}`;
        }
        const res = await fetch(`/api/public/draft/${slug}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setDraftId(data.draftId);
        setTrackingToken(data.trackingToken);
      } catch (err) {
        setSubmitError(err.message);
        return;
      }
    }
    setStep(4);
  };

  // Patch the draft when transitioning out of Step 4.
  const finishStep4 = async () => {
    if (!category || !description.trim() || !draftId) return;
    const cat = CATEGORIES.find((c) => c.value === category);
    try {
      const isCommon = roomId.startsWith('common:');
      const ca = isCommon ? COMMON_AREAS.find((c) => `common:${c.id}` === roomId) : null;
      const noteParts = [];
      if (ca) noteParts.push(`Reported area: ${ca.label}`);
      const triageEntries = Object.entries(triage).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0));
      if (triageEntries.length) {
        noteParts.push(triageEntries.map(([, v]) => Array.isArray(v) ? v.join(', ') : v).join(' · '));
      }
      const res = await fetch(`/api/public/draft/${slug}/${draftId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flagCategory: cat?.flagCategory || 'General',
          description: description.trim(),
          note: noteParts.join(' · ') || null,
          triageAnswers: triage,
          lastStepCompleted: 4,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setStep(5);
    } catch (err) {
      setSubmitError(err.message);
    }
  };

  const handleSubmit = async () => {
    if (!draftId) return;
    const cat = CATEGORIES.find((c) => c.value === category);
    if (cat?.photos === 'required' && photos.length === 0) {
      setPhotoError('Please add at least one photo so we can assess the issue.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      // Upload photos first (best-effort) so they're attached on submit.
      for (const p of photos) {
        try {
          const compressed = await compressImage(p.file);
          const form = new FormData();
          form.append('photo', compressed);
          form.append('maintenanceItemId', draftId);
          form.append('propertyId', property.propertyId);
          await fetch('/api/public/photo', { method: 'POST', body: form });
        } catch { /* keep going */ }
      }
      const res = await fetch(`/api/public/draft/${slug}/${draftId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTrackingUrl(data.trackingUrl);
      setDone(true);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setShowCancelConfirm(false);
    if (draftId) {
      try {
        await fetch(`/api/public/draft/${slug}/${draftId}/cancel`, { method: 'POST' });
      } catch { /* ignore */ }
    }
    setCancelled(true);
  };

  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const totalSteps = 5;

  // ─── Render ──────────────────────────────────────────────

  if (bootLoading) return <div className="rr-wiz-shell"><div className="rr-wiz-loading">Loading...</div></div>;
  if (bootError) {
    return (
      <div className="rr-wiz-shell">
        <div className="rr-wiz-card"><div className="auth-error">{bootError}</div></div>
      </div>
    );
  }

  if (cancelled) {
    return (
      <div className="rr-wiz-shell">
        <div className="rr-wiz-card rr-wiz-done">
          <h1>Report cancelled</h1>
          <p className="rr-wiz-sub">If you need help, contact your property manager.</p>
          {orgPhone && (
            <p style={{ marginTop: 12 }}>
              <a className="rr-wiz-btn rr-wiz-btn-secondary" href={`tel:${orgPhone.replace(/\D/g, '')}`}>
                Call {fmtPhone(orgPhone)}
              </a>
            </p>
          )}
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="rr-wiz-shell">
        <div className="rr-wiz-card rr-wiz-done">
          <div className="rr-wiz-check">✓</div>
          <h1>Your report has been submitted!</h1>
          <p className="rr-wiz-sub">Your property manager has been notified and will follow up.</p>
          {reporterEmail.trim() && (
            <p className="rr-wiz-sub">We&apos;ll send updates to {reporterEmail.trim()}</p>
          )}
          {trackingToken && (
            <p className="rr-wiz-sub" style={{ marginTop: 12 }}>
              <strong>Reference ID:</strong> <code>{trackingToken.slice(0, 8).toUpperCase()}</code>
            </p>
          )}
          {trackingUrl && (
            <p style={{ marginTop: 16 }}>
              <a className="rr-wiz-btn rr-wiz-btn-secondary" href={trackingUrl}>Track this report</a>
            </p>
          )}
          <p style={{ marginTop: 16 }}>
            <button
              type="button"
              className="rr-wiz-link"
              onClick={() => window.location.reload()}
            >
              Submit another issue
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rr-wiz-shell">
      <div className="rr-wiz-card">
        <ProgressDots step={step} total={totalSteps} />

        {step > 1 && (
          <button
            type="button"
            className="rr-wiz-back"
            onClick={() => (step <= 2 ? setStep(1) : goBack())}
            aria-label="Back"
          >
            ←
          </button>
        )}

        {step === 1 || step === 2 ? (
          <StepFindProperty
            searchQuery={searchQuery}
            setSearchQuery={(q) => { setSearchQuery(q); setStep(q.trim().length >= 3 ? 2 : 1); }}
            searchResults={searchResults}
            searching={searching}
            onSelect={selectProperty}
          />
        ) : null}

        {step === 3 && (
          <StepYourInfo
            property={property}
            reporterName={reporterName}
            setReporterName={setReporterName}
            reporterEmail={reporterEmail}
            setReporterEmail={setReporterEmail}
            roomId={roomId}
            setRoomId={setRoomId}
            onNext={finishStep3}
          />
        )}

        {step === 4 && (
          <StepDescribe
            category={category}
            setCategory={setCategory}
            description={description}
            setDescription={setDescription}
            triage={triage}
            setTriage={setTriage}
            onPopup={setActivePopup}
            onNext={finishStep4}
          />
        )}

        {step === 5 && (
          <StepPhotos
            category={category}
            photos={photos}
            setPhotos={setPhotos}
            fileRef={fileRef}
            photoError={photoError}
            setPhotoError={setPhotoError}
            submitting={submitting}
            submitError={submitError}
            onSubmit={handleSubmit}
          />
        )}

        {step >= 3 && (
          <button
            type="button"
            className="rr-wiz-cancel"
            onClick={() => setShowCancelConfirm(true)}
          >
            Cancel
          </button>
        )}
      </div>

      {showCancelConfirm && (
        <div className="rr-wiz-modal-backdrop" onClick={() => setShowCancelConfirm(false)}>
          <div className="rr-wiz-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Are you sure?</h3>
            <p>Your property manager won&apos;t see this report if you cancel.</p>
            <div className="rr-wiz-modal-actions">
              <button type="button" className="rr-wiz-btn rr-wiz-btn-secondary" onClick={() => setShowCancelConfirm(false)}>
                Go back
              </button>
              <button type="button" className="rr-wiz-btn rr-wiz-btn-danger" onClick={handleCancel}>
                Cancel report
              </button>
            </div>
          </div>
        </div>
      )}

      {activePopup && (
        <PopupModal popup={activePopup} phone={orgPhone} onClose={() => setActivePopup(null)} />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────

function ProgressDots({ step, total }) {
  return (
    <div className="rr-wiz-progress">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`rr-wiz-dot ${i + 1 < step ? 'rr-wiz-dot-done' : ''} ${i + 1 === step ? 'rr-wiz-dot-active' : ''}`}
        />
      ))}
    </div>
  );
}

function StepFindProperty({ searchQuery, setSearchQuery, searchResults, searching, onSelect }) {
  return (
    <>
      <h1 className="rr-wiz-title">Find your property</h1>
      <p className="rr-wiz-sub">Enter your street name to find your place.</p>
      <label className="rr-wiz-field">
        Street name
        <input
          type="text"
          className="rr-wiz-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="e.g. Main St"
          autoFocus
        />
      </label>
      <div className="rr-wiz-results">
        {searching && <p className="rr-wiz-hint">Searching...</p>}
        {!searching && searchQuery.trim().length >= 3 && searchResults.length === 0 && (
          <p className="rr-wiz-hint">No matches. Try a different street name.</p>
        )}
        {searchResults.map((p) => (
          <button
            key={p.id}
            type="button"
            className="rr-wiz-result"
            onClick={() => onSelect(p.id)}
          >
            <div className="rr-wiz-result-addr">{p.address}</div>
          </button>
        ))}
      </div>
    </>
  );
}

function StepYourInfo({ property, reporterName, setReporterName, reporterEmail, setReporterEmail, roomId, setRoomId, onNext }) {
  const numberedRooms = (property?.rooms || []).filter((r) => /\d/.test(r.label));
  const valid = reporterName.trim() && roomId;
  return (
    <>
      <h1 className="rr-wiz-title">Report an Issue</h1>
      <p className="rr-wiz-sub">{property?.address}</p>

      <label className="rr-wiz-field">
        Your name
        <input
          type="text"
          className="rr-wiz-input"
          value={reporterName}
          onChange={(e) => setReporterName(e.target.value)}
          placeholder="Jane Doe"
          required
        />
      </label>

      <label className="rr-wiz-field">
        Email
        <input
          type="email"
          className="rr-wiz-input"
          value={reporterEmail}
          onChange={(e) => setReporterEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <span className="rr-wiz-hint">Optional — we&apos;ll send you updates when the issue is resolved.</span>
      </label>

      <label className="rr-wiz-field">
        Room
        <select
          className="rr-wiz-input"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          required
        >
          <option value="">— Select your room or area —</option>
          {numberedRooms.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
          {numberedRooms.length > 0 && <option disabled>──────────</option>}
          {COMMON_AREAS.map((c) => (
            <option key={c.id} value={`common:${c.id}`}>{c.label}</option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="rr-wiz-btn rr-wiz-btn-primary"
        onClick={onNext}
        disabled={!valid}
      >
        Next
      </button>
    </>
  );
}

function StepDescribe({ category, setCategory, description, setDescription, triage, setTriage, onPopup, onNext }) {
  const cat = CATEGORIES.find((c) => c.value === category);
  const triageSteps = useMemo(() => triageStepsFor(category), [category]);

  // Trigger popup callback. We delegate to parent so popups can survive
  // re-renders; the parent re-shows them only when the trigger fires.
  const fire = useCallback((popup) => {
    if (popup) onPopup(popup);
  }, [onPopup]);

  const setAnswer = (id, value, popup) => {
    setTriage((t) => ({ ...t, [id]: value }));
    if (popup) fire(popup);
  };

  const allTriageDone = triageSteps.every((t) => {
    if (t.dependsOn) {
      const dep = triage[t.dependsOn.id];
      if (dep !== t.dependsOn.value) return true;
    }
    const v = triage[t.id];
    if (t.kind === 'multi') return Array.isArray(v) && v.length > 0;
    return v !== undefined && v !== '';
  });

  const valid = category && description.trim() && allTriageDone;

  return (
    <>
      <h1 className="rr-wiz-title">Describe the issue</h1>

      <div className="rr-wiz-banner">
        <span className="rr-wiz-banner-icon">📞</span>
        <span>If this is a life-threatening emergency, call <a href="tel:911">911</a> immediately.</span>
      </div>

      <div className="rr-wiz-cat-grid">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            className={`rr-wiz-cat ${category === c.value ? 'rr-wiz-cat-selected' : ''}`}
            onClick={() => setCategory(c.value)}
          >
            <span className="rr-wiz-cat-emoji">{c.emoji}</span>
            <span className="rr-wiz-cat-label">{c.label}</span>
          </button>
        ))}
      </div>

      {cat && (
        <>
          {triageSteps.map((t) => {
            if (t.dependsOn) {
              const dep = triage[t.dependsOn.id];
              if (dep !== t.dependsOn.value) return null;
            }
            return (
              <TriageQuestion
                key={t.id}
                step={t}
                value={triage[t.id]}
                onChange={(value, popup) => setAnswer(t.id, value, popup)}
              />
            );
          })}

          <label className="rr-wiz-field">
            Briefly describe the issue
            <textarea
              className="rr-wiz-input rr-wiz-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Kitchen sink is leaking under the cabinet"
              rows={3}
              required
            />
          </label>
        </>
      )}

      <button
        type="button"
        className="rr-wiz-btn rr-wiz-btn-primary"
        onClick={onNext}
        disabled={!valid}
      >
        Next
      </button>
    </>
  );
}

function TriageQuestion({ step, value, onChange }) {
  if (step.kind === 'yesno') {
    return (
      <div className="rr-wiz-field">
        <div className="rr-wiz-field-label">{step.question}</div>
        <div className="rr-wiz-choice-row">
          {['Yes', 'No'].map((opt) => (
            <button
              key={opt}
              type="button"
              className={`rr-wiz-choice ${value === opt ? 'rr-wiz-choice-selected' : ''}`}
              onClick={() => onChange(opt, opt === 'Yes' ? step.onYes : step.onNo)}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (step.kind === 'choice') {
    return (
      <div className="rr-wiz-field">
        <div className="rr-wiz-field-label">{step.question}</div>
        <div className="rr-wiz-choice-grid">
          {step.options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`rr-wiz-choice ${value === opt ? 'rr-wiz-choice-selected' : ''}`}
              onClick={() => onChange(opt, step.popupsByOption?.[opt])}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (step.kind === 'multi') {
    const arr = Array.isArray(value) ? value : [];
    const toggle = (opt) => {
      const next = arr.includes(opt) ? arr.filter((x) => x !== opt) : [...arr, opt];
      onChange(next, !arr.includes(opt) ? step.popupsByOption?.[opt] : undefined);
    };
    return (
      <div className="rr-wiz-field">
        <div className="rr-wiz-field-label">{step.question}</div>
        <div className="rr-wiz-choice-grid">
          {step.options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`rr-wiz-choice ${arr.includes(opt) ? 'rr-wiz-choice-selected' : ''}`}
              onClick={() => toggle(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

function StepPhotos({ category, photos, setPhotos, fileRef, photoError, setPhotoError, submitting, submitError, onSubmit }) {
  const cat = CATEGORIES.find((c) => c.value === category);
  const policy = cat?.photos || 'optional';

  const handlePick = (e) => {
    const files = Array.from(e.target.files || []).slice(0, 5 - photos.length);
    const next = files
      .filter((f) => f.type.startsWith('image/'))
      .map((f) => ({ file: f, previewUrl: URL.createObjectURL(f) }));
    setPhotos((prev) => [...prev, ...next]);
    setPhotoError('');
    e.target.value = '';
  };

  const removePhoto = (idx) => setPhotos((prev) => prev.filter((_, i) => i !== idx));

  return (
    <>
      <h1 className="rr-wiz-title">Photos</h1>
      {policy === 'required' && (
        <p className="rr-wiz-sub" style={{ color: '#A02420' }}>At least 1 photo required</p>
      )}
      {policy === 'encouraged' && (
        <p className="rr-wiz-sub">Photos help us fix this faster.</p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handlePick}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        className="rr-wiz-photo-pick"
        onClick={() => fileRef.current?.click()}
        disabled={photos.length >= 5}
      >
        <span className="rr-wiz-photo-icon">📸</span>
        <span>{photos.length === 0 ? 'Take a photo or choose from gallery' : '+ Add another'}</span>
      </button>

      {photos.length > 0 && (
        <div className="rr-wiz-photos">
          {photos.map((p, i) => (
            <div key={i} className="rr-wiz-photo">
              <img src={p.previewUrl} alt="" />
              <button
                type="button"
                className="rr-wiz-photo-x"
                onClick={() => removePhoto(i)}
                aria-label="Remove photo"
              >&times;</button>
            </div>
          ))}
        </div>
      )}

      {photoError && <div className="auth-error" style={{ marginTop: 12 }}>{photoError}</div>}
      {submitError && <div className="auth-error" style={{ marginTop: 12 }}>{submitError}</div>}

      <button
        type="button"
        className="rr-wiz-btn rr-wiz-btn-primary"
        onClick={onSubmit}
        disabled={submitting}
      >
        {submitting ? 'Submitting...' : 'Submit Report'}
      </button>
    </>
  );
}

function PopupModal({ popup, phone, onClose }) {
  const html = renderPopupHtml(popup.html, phone);
  return (
    <div className="rr-wiz-modal-backdrop" onClick={onClose}>
      <div className="rr-wiz-modal" onClick={(e) => e.stopPropagation()}>
        <div className={`rr-wiz-modal-head ${popup.tone === 'emergency' ? 'rr-wiz-modal-head-emergency' : 'rr-wiz-modal-head-advisory'}`}>
          <span style={{ fontSize: 18, marginRight: 6 }}>
            {popup.tone === 'emergency' ? '⚠' : 'ⓘ'}
          </span>
          {popup.title}
        </div>
        <div className="rr-wiz-modal-body" dangerouslySetInnerHTML={{ __html: html }} />
        <div className="rr-wiz-modal-actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="rr-wiz-btn rr-wiz-btn-primary" onClick={onClose}>
            {popup.dismissLabel || 'Got it — continue to report'}
          </button>
        </div>
      </div>
    </div>
  );
}
