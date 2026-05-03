import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  CATEGORIES,
  DEFAULT_COMMON_AREAS,
  getCategory,
  popupForSub,
  photoPolicyFor,
  makeTicketTitle,
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

// Cheap blur heuristic: downsample to a thumb, run a Sobel-ish gradient,
// estimate edge variance. Higher = sharper. Below threshold = warn.
async function looksBlurry(file) {
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    URL.revokeObjectURL(url);
    const W = 96;
    const H = Math.max(1, Math.round((img.height / img.width) * W));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    // Convert to luminance and run a simple Laplacian.
    const lum = new Float32Array(W * H);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      lum[j] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    let mean = 0;
    const lap = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const idx = y * W + x;
        const v = -4 * lum[idx]
          + lum[idx - 1] + lum[idx + 1]
          + lum[idx - W] + lum[idx + W];
        lap[idx] = v;
        mean += v;
      }
    }
    const N = (W - 2) * (H - 2);
    mean /= N;
    let variance = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const v = lap[y * W + x] - mean;
        variance += v * v;
      }
    }
    variance /= N;
    return variance < 80; // empirical cutoff
  } catch {
    return false;
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
  const [roomId, setRoomId] = useState('');

  // Step 4 — category
  const [category, setCategory] = useState('');

  // Step 5 — subs + description
  const [subs, setSubs] = useState([]);
  const [followUps, setFollowUps] = useState({}); // { stoveType: 'Gas' }
  const [description, setDescription] = useState('');

  // Step 6 — photos
  const [photos, setPhotos] = useState([]); // { file, previewUrl, blurry }
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

  // Boot
  useEffect(() => {
    Promise.all([
      fetch(`/api/public/org/${slug}`).then((r) => r.ok ? r.json() : Promise.reject(new Error('Organization not found'))),
      fetch(`/api/public/org/${slug}/contact`).then((r) => r.ok ? r.json() : { phone: null }).catch(() => ({ phone: null })),
    ])
      .then(([, contact]) => setOrgPhone(contact?.phone || null))
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

  // Abandonment via beforeunload
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

  // Save draft after Step 3
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

  // Patch draft when leaving Step 5 (after subs + description)
  const finishStep5 = async () => {
    if (!category || !description.trim() || !draftId) return;
    const cat = getCategory(category);
    try {
      const isCommon = roomId.startsWith('common:');
      const commonLabel = isCommon ? roomId.replace(/^common:/, '') : null;
      const noteParts = [];
      if (commonLabel) noteParts.push(`Reported area: ${commonLabel}`);
      if (subs.length) noteParts.push(`Selected: ${subs.join(', ')}`);
      const followLines = Object.entries(followUps).filter(([, v]) => v);
      for (const [k, v] of followLines) noteParts.push(`${k}: ${v}`);

      const ticketTitle = makeTicketTitle(description.trim());
      const res = await fetch(`/api/public/draft/${slug}/${draftId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flagCategory: cat?.flagCategory || 'General',
          description: ticketTitle, // becomes ticket title
          note: [description.trim(), noteParts.join(' · ')].filter(Boolean).join('\n\n'),
          triageAnswers: { subcategories: subs, followUps, residentCategory: category },
          lastStepCompleted: 5,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setStep(6);
    } catch (err) {
      setSubmitError(err.message);
    }
  };

  const handleSubmit = async () => {
    if (!draftId) return;
    const cat = getCategory(category);
    const policy = photoPolicyFor(cat, subs);
    if (policy === 'required' && photos.length === 0) {
      setPhotoError('Please add at least one photo so we can assess the issue.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
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
      const res = await fetch(`/api/public/draft/${slug}/${draftId}/submit`, { method: 'POST' });
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
      try { await fetch(`/api/public/draft/${slug}/${draftId}/cancel`, { method: 'POST' }); } catch { /* ignore */ }
    }
    setCancelled(true);
  };

  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const totalSteps = 6;

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
            <button type="button" className="rr-wiz-link" onClick={() => window.location.reload()}>
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
            onBack={goBack}
            onNext={finishStep3}
          />
        )}

        {step === 4 && (
          <StepCategory
            category={category}
            onPick={(value) => { setCategory(value); setSubs([]); setFollowUps({}); setStep(5); }}
            onBack={goBack}
          />
        )}

        {step === 5 && (
          <StepDetails
            category={category}
            subs={subs}
            setSubs={setSubs}
            followUps={followUps}
            setFollowUps={setFollowUps}
            description={description}
            setDescription={setDescription}
            onPopup={setActivePopup}
            onBack={() => { setStep(4); setSubs([]); setFollowUps({}); }}
            onNext={finishStep5}
          />
        )}

        {step === 6 && (
          <StepPhotos
            category={category}
            subs={subs}
            photos={photos}
            setPhotos={setPhotos}
            fileRef={fileRef}
            photoError={photoError}
            setPhotoError={setPhotoError}
            submitting={submitting}
            submitError={submitError}
            onBack={goBack}
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

function StepYourInfo({ property, reporterName, setReporterName, reporterEmail, setReporterEmail, roomId, setRoomId, onBack, onNext }) {
  const numberedRooms = (property?.rooms || []).filter((r) => /\d/.test(r.label));
  const customCommon = property?.commonAreas?.length ? property.commonAreas : DEFAULT_COMMON_AREAS;
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
          <option value="" disabled>— Select your room or area —</option>
          {numberedRooms.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
          {numberedRooms.length > 0 && <option disabled>──────────</option>}
          {customCommon.map((label) => (
            <option key={label} value={`common:${label}`}>{label}</option>
          ))}
        </select>
      </label>

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!valid} nextLabel="Next" />
    </>
  );
}

function StepCategory({ category, onPick, onBack }) {
  return (
    <>
      <h1 className="rr-wiz-title">What&apos;s the problem with?</h1>

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
            onClick={() => onPick(c.value)}
          >
            <span className="rr-wiz-cat-label">{c.label}</span>
          </button>
        ))}
      </div>

      <NavButtons onBack={onBack} onNext={null} backOnly />
    </>
  );
}

function StepDetails({ category, subs, setSubs, followUps, setFollowUps, description, setDescription, onPopup, onBack, onNext }) {
  const cat = getCategory(category);
  const hasSubs = (cat?.subcategories || []).length > 0;

  const toggleSub = (sub) => {
    const isOn = subs.includes(sub);
    if (isOn) {
      setSubs(subs.filter((s) => s !== sub));
      // Clear inline follow-up if its trigger was deselected.
      if (cat?.inlineFollowUp?.[sub]) {
        const fid = cat.inlineFollowUp[sub].id;
        setFollowUps((prev) => { const next = { ...prev }; delete next[fid]; return next; });
      }
      return;
    }
    if (subs.length >= 3) return; // cap at 3
    setSubs([...subs, sub]);
    const popup = popupForSub(cat, sub);
    if (popup) onPopup(popup);
  };

  const setFollowUp = (key, value, popup) => {
    setFollowUps((prev) => ({ ...prev, [key]: value }));
    if (popup) onPopup(popup);
  };

  // Inline follow-ups whose trigger sub is currently selected.
  const activeFollowUps = useMemo(() => {
    if (!cat?.inlineFollowUp) return [];
    return Object.entries(cat.inlineFollowUp)
      .filter(([sub]) => subs.includes(sub))
      .map(([, def]) => def);
  }, [cat, subs]);

  const valid = description.trim() && (!hasSubs || subs.length > 0)
    && activeFollowUps.every((f) => followUps[f.id]);

  return (
    <>
      <h1 className="rr-wiz-title">{cat?.label}</h1>

      {hasSubs && (
        <>
          <div className="rr-wiz-field-label" style={{ marginTop: 4 }}>What&apos;s going on? <span className="rr-wiz-hint">(pick up to 3)</span></div>
          <div className="rr-wiz-chip-grid">
            {cat.subcategories.map((s) => (
              <button
                key={s}
                type="button"
                className={`rr-wiz-chip ${subs.includes(s) ? 'rr-wiz-chip-selected' : ''}`}
                onClick={() => toggleSub(s)}
                disabled={!subs.includes(s) && subs.length >= 3}
              >
                {s}
              </button>
            ))}
          </div>
        </>
      )}

      {activeFollowUps.map((f) => (
        <div className="rr-wiz-field" key={f.id}>
          <div className="rr-wiz-field-label">{f.question}</div>
          <div className="rr-wiz-choice-row">
            {f.options.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`rr-wiz-choice ${followUps[f.id] === opt ? 'rr-wiz-choice-selected' : ''}`}
                onClick={() => setFollowUp(f.id, opt, f.popupsByOption?.[opt])}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      ))}

      <label className="rr-wiz-field">
        Describe the issue
        <textarea
          className="rr-wiz-input rr-wiz-textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Kitchen sink is leaking under the cabinet"
          rows={3}
          required
        />
      </label>

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!valid} nextLabel="Next" />
    </>
  );
}

function StepPhotos({ category, subs, photos, setPhotos, fileRef, photoError, setPhotoError, submitting, submitError, onBack, onSubmit }) {
  const cat = getCategory(category);
  const policy = photoPolicyFor(cat, subs);

  const handlePick = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 5 - photos.length);
    const next = [];
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      // Check blur on the original; warn but don't block.
      const blurry = await looksBlurry(f);
      next.push({ file: f, previewUrl: URL.createObjectURL(f), blurry });
    }
    setPhotos((prev) => [...prev, ...next]);
    setPhotoError('');
    e.target.value = '';
  };

  const removePhoto = (idx) => setPhotos((prev) => prev.filter((_, i) => i !== idx));

  return (
    <>
      <h1 className="rr-wiz-title">Photos</h1>
      {policy === 'required' && (
        <p className="rr-wiz-sub" style={{ color: '#A02420' }}>At least 1 photo required.</p>
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
              {p.blurry && <span className="rr-wiz-photo-blur" title="This photo looks blurry — try taking another one.">⚠</span>}
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
      {photos.some((p) => p.blurry) && (
        <p className="rr-wiz-hint" style={{ color: '#BA7517' }}>This photo looks blurry — try taking another one.</p>
      )}

      {photoError && <div className="auth-error" style={{ marginTop: 12 }}>{photoError}</div>}
      {submitError && <div className="auth-error" style={{ marginTop: 12 }}>{submitError}</div>}

      <NavButtons
        onBack={onBack}
        onNext={onSubmit}
        nextDisabled={submitting}
        nextLabel={submitting ? 'Submitting...' : 'Submit Report'}
      />
    </>
  );
}

function NavButtons({ onBack, onNext, nextDisabled, nextLabel = 'Next', backOnly }) {
  return (
    <div className="rr-wiz-nav">
      <button type="button" className="rr-wiz-btn rr-wiz-btn-secondary" onClick={onBack}>
        Back
      </button>
      {!backOnly && (
        <button type="button" className="rr-wiz-btn rr-wiz-btn-primary" onClick={onNext} disabled={!!nextDisabled}>
          {nextLabel}
        </button>
      )}
    </div>
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
