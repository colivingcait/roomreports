import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import VendorForm from '../components/VendorForm';

const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'];
const STATUS_LABELS = { OPEN: 'Open', ASSIGNED: 'Assigned', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved' };

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function fmtCurrency(n) {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtDuration(ms) {
  if (ms == null) return '—';
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return `${Math.round(ms / 60000)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export default function VendorProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterProperty, setFilterProperty] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api(`/api/vendors/${id}`);
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.maintenance.filter((m) => {
      if (filterStatus && m.status !== filterStatus) return false;
      if (filterProperty && m.propertyId !== filterProperty) return false;
      if (startDate && new Date(m.createdAt) < new Date(startDate)) return false;
      if (endDate && new Date(m.createdAt) > new Date(endDate)) return false;
      return true;
    });
  }, [data, filterStatus, filterProperty, startDate, endDate]);

  const propertyOptions = useMemo(() => {
    if (!data) return [];
    const map = {};
    for (const m of data.maintenance) {
      if (m.property) map[m.property.id] = m.property;
    }
    return Object.values(map);
  }, [data]);

  const downloadWorkOrder = async () => {
    const res = await fetch('/api/maintenance/batch-pdf', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedVendorId: id }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vendor-work-order-${data.vendor.name}-${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="page-loading">Loading vendor...</div>;
  if (error || !data) return <div className="page-container"><div className="auth-error">{error || 'Not found'}</div></div>;

  const { vendor, stats } = data;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <button className="btn-text-sm" onClick={() => navigate('/team')}>&larr; Team</button>
          <h1 style={{ marginTop: '0.25rem' }}>{vendor.name}</h1>
          <p className="page-subtitle">
            {vendor.company}
            {vendor.phone && <> &middot; {vendor.phone}</>}
            {vendor.email && <> &middot; <a href={`mailto:${vendor.email}`}>{vendor.email}</a></>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" onClick={downloadWorkOrder}>Download work order</button>
          <button className="btn-primary-sm" onClick={() => setEditing(true)}>Edit</button>
        </div>
      </div>

      {vendor.specialties?.length > 0 && (
        <div className="team-props" style={{ marginBottom: '1rem' }}>
          {vendor.specialties.map((s) => <span key={s} className="team-prop-tag">{s}</span>)}
        </div>
      )}

      {vendor.notes && (
        <div className="review-item-note" style={{ marginBottom: '1rem' }}>
          <span className="review-note-label">Notes:</span> {vendor.notes}
        </div>
      )}

      <div className="db-stat-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="db-stat db-stat-open" style={{ cursor: 'default' }}>
          <span className="db-stat-num">{stats.total}</span>
          <span className="db-stat-label">TOTAL JOBS</span>
        </div>
        <div className="db-stat db-stat-assigned" style={{ cursor: 'default' }}>
          <span className="db-stat-num">{stats.open}</span>
          <span className="db-stat-label">OPEN</span>
        </div>
        <div className="db-stat db-stat-progress" style={{ cursor: 'default' }}>
          <span className="db-stat-num">{stats.completed}</span>
          <span className="db-stat-label">COMPLETED</span>
        </div>
        <div className="db-stat db-stat-resolved" style={{ cursor: 'default' }}>
          <span className="db-stat-num">{fmtCurrency(stats.totalSpend)}</span>
          <span className="db-stat-label">TOTAL SPEND</span>
        </div>
      </div>

      <p className="suggestion-help" style={{ marginBottom: '1rem' }}>
        Avg response time: <strong>{fmtDuration(stats.avgResponseMs)}</strong>
      </p>

      <h3 className="review-section-title">Jobs</h3>
      <div className="maint-filters">
        <select className="filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select className="filter-select" value={filterProperty} onChange={(e) => setFilterProperty(e.target.value)}>
          <option value="">All properties</option>
          {propertyOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" className="filter-select" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <input type="date" className="filter-select" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <p className="empty-text">No jobs match the filter.</p>
      ) : (
        <div className="insp-history-list">
          {filtered.map((m) => (
            <div key={m.id} className="insp-history-row" style={{ cursor: 'default' }}>
              <div className="insp-history-left">
                <span className="dash-type-badge">{STATUS_LABELS[m.status]}</span>
                <div className="insp-history-info">
                  <span className="insp-history-prop">{m.description}</span>
                  <span className="insp-history-inspector">
                    {m.property?.name}{m.room?.label ? ` · ${m.room.label}` : ''} · {new Date(m.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              </div>
              <div className="insp-history-right">
                {m.priority && <span className="maint-priority-tag">{m.priority}</span>}
                {(m.actualCost ?? m.estimatedCost) != null && (
                  <span className="maint-cost">{fmtCurrency(m.actualCost ?? m.estimatedCost)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <VendorForm
        open={editing}
        vendor={vendor}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); load(); }}
      />
    </div>
  );
}
