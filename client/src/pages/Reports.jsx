import { useState, useEffect, useCallback, useMemo } from 'react';
import { FLAG_CATEGORIES, PRIORITIES } from '../../../shared/index.js';

const PRESETS = [
  { value: 'this_month', label: 'This Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'ytd', label: 'YTD' },
  { value: 'annual', label: 'Annual (trailing 12m)' },
  { value: 'custom', label: 'Custom range' },
];

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function fmtCurrency(n) {
  if (!n) return '$0';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function fmtHours(ms) {
  if (ms == null) return '—';
  const hrs = ms / 3_600_000;
  if (hrs < 1) return `${Math.round(ms / 60000)}m`;
  if (hrs < 48) return `${hrs.toFixed(1)}h`;
  return `${(hrs / 24).toFixed(1)}d`;
}

function Bar({ value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="report-bar">
      <div className="report-bar-fill" style={{ width: `${pct}%`, background: color || '#6B8F71' }} />
    </div>
  );
}

function Breakdown({ title, rows, formatter }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="report-card">
      <h3 className="md-section-title">{title}</h3>
      {rows.length === 0 ? (
        <p className="empty-text">No data in this range.</p>
      ) : (
        <div className="report-breakdown">
          {rows.slice(0, 10).map((r) => (
            <div key={r.key} className="report-row">
              <span className="report-row-label" title={r.label}>{r.label || r.key}</span>
              <Bar value={r.total} max={max} />
              <span className="report-row-value">{formatter(r)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  const [preset, setPreset] = useState('ytd');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [flagCategory, setFlagCategory] = useState('');
  const [assignedVendorId, setAssignedVendorId] = useState('');
  const [priority, setPriority] = useState('');

  const [data, setData] = useState(null);
  const [properties, setProperties] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([api('/api/properties'), api('/api/vendors')])
      .then(([p, v]) => {
        setProperties(p.properties || []);
        setVendors(v.vendors || []);
      })
      .catch(() => {});
  }, []);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set('preset', preset);
    if (preset === 'custom') {
      if (startDate) p.set('start', startDate);
      if (endDate) p.set('end', endDate);
    }
    if (propertyId) p.set('propertyId', propertyId);
    if (flagCategory) p.set('flagCategory', flagCategory);
    if (assignedVendorId) p.set('assignedVendorId', assignedVendorId);
    if (priority) p.set('priority', priority);
    return p;
  }, [preset, startDate, endDate, propertyId, flagCategory, assignedVendorId, priority]);

  const load = useCallback(() => {
    setLoading(true);
    api(`/api/reports?${params}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params]);

  useEffect(() => { load(); }, [load]);

  const downloadCsv = () => {
    window.open(`/api/reports/csv?${params}`, '_blank');
  };

  const trend = data?.trend || [];
  const trendMax = Math.max(1, ...trend.map((t) => t.total));

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="page-subtitle">
            {data?.totalTickets != null ? `${data.totalTickets} ticket${data.totalTickets === 1 ? '' : 's'} in selected range` : '—'}
          </p>
        </div>
        <button className="btn-primary-sm" onClick={downloadCsv}>Export CSV</button>
      </div>

      {/* Filters */}
      <div className="maint-filters" style={{ flexWrap: 'wrap' }}>
        <select className="filter-select" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        {preset === 'custom' && (
          <>
            <input type="date" className="filter-select" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <input type="date" className="filter-select" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </>
        )}
        <select className="filter-select" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
          <option value="">All Properties</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="filter-select" value={flagCategory} onChange={(e) => setFlagCategory(e.target.value)}>
          <option value="">All Categories</option>
          {FLAG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="filter-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">All Priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="filter-select" value={assignedVendorId} onChange={(e) => setAssignedVendorId(e.target.value)}>
          <option value="">All Vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>

      {loading && <div className="page-loading">Loading reports...</div>}
      {data && (
        <>
          {/* Top-line stats */}
          <div className="db-stat-grid" style={{ margin: '1rem 0 1.5rem' }}>
            <div className="db-stat db-stat-open" style={{ cursor: 'default' }}>
              <span className="db-stat-num">{data.statusTotals.OPEN}</span>
              <span className="db-stat-label">OPEN</span>
            </div>
            <div className="db-stat db-stat-assigned" style={{ cursor: 'default' }}>
              <span className="db-stat-num">{data.statusTotals.ASSIGNED}</span>
              <span className="db-stat-label">ASSIGNED</span>
            </div>
            <div className="db-stat db-stat-progress" style={{ cursor: 'default' }}>
              <span className="db-stat-num">{data.statusTotals.IN_PROGRESS}</span>
              <span className="db-stat-label">IN PROGRESS</span>
            </div>
            <div className="db-stat db-stat-resolved" style={{ cursor: 'default' }}>
              <span className="db-stat-num">{data.statusTotals.RESOLVED}</span>
              <span className="db-stat-label">RESOLVED</span>
            </div>
          </div>

          <div className="report-kpis">
            <div className="report-kpi">
              <div className="report-kpi-label">Avg response time</div>
              <div className="report-kpi-value">{fmtHours(data.avgResponseMs)}</div>
            </div>
            <div className="report-kpi">
              <div className="report-kpi-label">Avg resolution time</div>
              <div className="report-kpi-value">{fmtHours(data.avgResolutionMs)}</div>
            </div>
            <div className="report-kpi">
              <div className="report-kpi-label">Total spend</div>
              <div className="report-kpi-value">
                {fmtCurrency(data.costByCategory.reduce((s, r) => s + r.total, 0))}
              </div>
            </div>
          </div>

          {/* Trend */}
          <div className="report-card">
            <h3 className="md-section-title">Monthly cost trend</h3>
            {trend.length === 0 ? (
              <p className="empty-text">No data in this range.</p>
            ) : (
              <div className="report-trend">
                {trend.map((t) => (
                  <div key={t.key} className="report-trend-col">
                    <div
                      className="report-trend-bar"
                      style={{ height: `${(t.total / trendMax) * 100}%` }}
                      title={`${fmtCurrency(t.total)} · ${t.count} tickets`}
                    />
                    <span className="report-trend-label">{t.key.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Breakdown title="Cost by category" rows={data.costByCategory} formatter={(r) => fmtCurrency(r.total)} />
          <Breakdown title="Cost by property" rows={data.costByProperty} formatter={(r) => fmtCurrency(r.total)} />
          <Breakdown title="Cost by room" rows={data.costByRoom} formatter={(r) => fmtCurrency(r.total)} />
          <Breakdown title="Cost by vendor" rows={data.costByVendor} formatter={(r) => fmtCurrency(r.total)} />
          <Breakdown title="Most common categories (count)" rows={data.commonCategories} formatter={(r) => `${r.count}`} />
          <Breakdown title="Most common rooms (count)" rows={data.commonRooms} formatter={(r) => `${r.count}`} />
        </>
      )}
    </div>
  );
}
