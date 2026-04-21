import { useState, useEffect, useCallback, useMemo } from 'react';
import { FLAG_CATEGORIES, PRIORITIES } from '../../../shared/index.js';
import UpgradeModal from '../components/UpgradeModal';
import { useFeatureGate } from '../hooks/useFeatureGate';

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

function LockGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginLeft: '0.25rem' }}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  );
}

function Bar({ value, max, color }) {
  const v = Number(value) || 0;
  const m = Number(max) || 0;
  // Tiny non-zero values still need a visible sliver so the row doesn't
  // look like "no bar". Zero stays zero.
  let pct = 0;
  if (v > 0 && m > 0) {
    pct = Math.max(3, (v / m) * 100);
  }
  return (
    <div className="report-bar">
      <div className="report-bar-fill" style={{ width: `${pct}%`, background: color || '#6B8F71' }} />
    </div>
  );
}

function Breakdown({ title, rows, formatter, valueKey = 'total' }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
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
              <Bar value={r[valueKey]} max={max} />
              <span className="report-row-value">{formatter(r)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SVG line chart for monthly trends ─────────────────
// data = [{ key: '2026-04', total: 1234, count: 3 }, ...]
function LineChart({ data, valueKey = 'total', height = 180, label = '', formatter = (v) => v }) {
  if (!data || data.length === 0) {
    return <p className="empty-text">No data in this range.</p>;
  }

  const W = 640;
  const H = height;
  const PAD_L = 48;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const values = data.map((d) => Number(d[valueKey]) || 0);
  const maxV = Math.max(1, ...values);
  const n = data.length;
  const x = (i) => PAD_L + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => PAD_T + innerH - (v / maxV) * innerH;

  const points = data.map((d, i) => `${x(i)},${y(Number(d[valueKey]) || 0)}`).join(' ');
  const gridCount = 4;
  const gridVals = Array.from({ length: gridCount + 1 }, (_, i) => (maxV / gridCount) * i);

  return (
    <div className="chart-wrap">
      {label && <div className="chart-label">{label}</div>}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg"
        preserveAspectRatio="none"
        aria-label={label}
      >
        {/* Y-axis grid lines + labels */}
        {gridVals.map((g, i) => {
          const yy = y(g);
          return (
            <g key={i}>
              <line x1={PAD_L} x2={W - PAD_R} y1={yy} y2={yy} stroke="#F0EDEB" strokeWidth="1" />
              <text x={PAD_L - 6} y={yy + 3} textAnchor="end" fontSize="10" fill="#8A8583">
                {formatter(g)}
              </text>
            </g>
          );
        })}
        {/* X-axis baseline */}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + innerH} y2={PAD_T + innerH} stroke="#D4D0CE" strokeWidth="1" />
        {/* Fill under line */}
        <polygon
          points={`${PAD_L},${PAD_T + innerH} ${points} ${W - PAD_R},${PAD_T + innerH}`}
          fill="#6B8F71"
          fillOpacity="0.12"
        />
        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke="#6B8F71"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Points */}
        {data.map((d, i) => (
          <g key={d.key}>
            <circle
              cx={x(i)}
              cy={y(Number(d[valueKey]) || 0)}
              r="3.5"
              fill="#fff"
              stroke="#6B8F71"
              strokeWidth="2"
            />
            <title>{`${d.key}: ${formatter(Number(d[valueKey]) || 0)}`}</title>
          </g>
        ))}
        {/* X-axis labels */}
        {data.map((d, i) => {
          // Don't crowd mobile — show every other label if many points
          if (n > 8 && i % 2 !== 0) return null;
          return (
            <text
              key={`x-${d.key}`}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              fill="#8A8583"
            >
              {d.key.slice(5)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Maintenance Reports tab ───────────────────────────

function MaintenanceReports() {
  const { can, gate, promptUpgrade, dismiss } = useFeatureGate();
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
    if (!can('csvExport')) {
      promptUpgrade({ feature: 'csvExport' });
      return;
    }
    window.open(`/api/reports/csv?${params}`, '_blank');
  };

  const trend = data?.trend || [];

  return (
    <>
      <div className="reports-tab-header">
        <span className="reports-tab-count">
          {data?.totalTickets != null ? `${data.totalTickets} ticket${data.totalTickets === 1 ? '' : 's'} in selected range` : '—'}
        </span>
        <button
          className={`btn-primary-sm ${!can('csvExport') ? 'btn-locked' : ''}`}
          onClick={downloadCsv}
          title={can('csvExport') ? 'Download CSV' : 'CSV export requires Operator plan'}
        >
          Export CSV {!can('csvExport') && <LockGlyph />}
        </button>
      </div>
      <UpgradeModal
        open={gate.open}
        onClose={dismiss}
        feature={gate.feature}
        plan={gate.plan}
        title={gate.title}
        body={gate.body}
      />

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
            <LineChart
              data={trend}
              valueKey="total"
              formatter={(v) => fmtCurrency(v)}
            />
          </div>

          <div className="report-card">
            <h3 className="md-section-title">Monthly ticket volume</h3>
            <LineChart
              data={trend}
              valueKey="count"
              formatter={(v) => Math.round(v).toString()}
            />
          </div>

          <Breakdown title="Cost by category" rows={data.costByCategory} formatter={(r) => fmtCurrency(r.total)} />
          <Breakdown title="Cost by property" rows={data.costByProperty} formatter={(r) => fmtCurrency(r.total)} />
          <Breakdown title="Cost by room" rows={data.costByRoom} formatter={(r) => fmtCurrency(r.total)} />
          <Breakdown title="Cost by vendor" rows={data.costByVendor} formatter={(r) => fmtCurrency(r.total)} />
          <Breakdown title="Most common categories (count)" rows={data.commonCategories} formatter={(r) => `${r.count}`} valueKey="count" />
          <Breakdown title="Most common rooms (count)" rows={data.commonRooms} formatter={(r) => `${r.count}`} valueKey="count" />
        </>
      )}
    </>
  );
}

// ─── Inspection Reports tab ────────────────────────────

function InspectionReports() {
  const [inspections, setInspections] = useState([]);
  const [properties, setProperties] = useState([]);
  const [filterProperty, setFilterProperty] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { can, gate, promptUpgrade, dismiss } = useFeatureGate();

  useEffect(() => {
    api('/api/properties').then((d) => setProperties(d.properties || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const q = new URLSearchParams();
    if (filterProperty) q.set('propertyId', filterProperty);
    if (filterType) q.set('type', filterType);
    if (filterStatus) q.set('status', filterStatus);
    setLoading(true);
    api(`/api/inspections?${q}`)
      .then((d) => setInspections(d.inspections || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterProperty, filterType, filterStatus]);

  const TYPE_LABELS = {
    QUARTERLY: 'Room Inspection', COMMON_AREA: 'Common Area',
    ROOM_TURN: 'Room Turn', MOVE_IN_OUT: 'Move-In / Out', RESIDENT_SELF_CHECK: 'Self-Check',
    COMMON_AREA_QUICK: 'Common Area Quick',
  };

  const filtered = inspections.filter((i) => {
    if (!search) return i.status !== 'DRAFT';
    const s = search.toLowerCase();
    return i.status !== 'DRAFT' && (
      i.property?.name?.toLowerCase().includes(s) ||
      i.inspectorName?.toLowerCase().includes(s) ||
      i.room?.label?.toLowerCase().includes(s)
    );
  });

  return (
    <>
      <div className="reports-tab-header">
        <span className="reports-tab-count">{filtered.length} inspection{filtered.length === 1 ? '' : 's'}</span>
      </div>
      <div className="maint-filters" style={{ flexWrap: 'wrap' }}>
        <input
          type="search"
          className="filter-select"
          placeholder="Search property / inspector..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="filter-select" value={filterProperty} onChange={(e) => setFilterProperty(e.target.value)}>
          <option value="">All Properties</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="filter-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="REVIEWED">Reviewed</option>
        </select>
      </div>

      {loading ? <div className="page-loading">Loading...</div> : (
        <div className="insp-history-list">
          {filtered.length === 0 ? (
            <div className="empty-state"><p>No inspections match these filters.</p></div>
          ) : (
            filtered.map((i) => (
              <InspectionReportRow
                key={i.id}
                item={i}
                canPdf={can('fullReportsPDF')}
                onLockedPdf={() => promptUpgrade({ feature: 'fullReportsPDF' })}
              />
            ))
          )}
        </div>
      )}
      <UpgradeModal
        open={gate.open}
        onClose={dismiss}
        feature={gate.feature}
        plan={gate.plan}
        title={gate.title}
        body={gate.body}
      />
    </>
  );
}

function InspectionReportRow({ item, canPdf, onLockedPdf }) {
  const isQuarterly = item.type === 'QUARTERLY';
  const dateKey = new Date(item.createdAt).toISOString().slice(0, 10);

  const pdfUrl = (full) => isQuarterly
    ? `/api/inspections/quarterly-group/${item.property?.id || item.propertyId}/${dateKey}/pdf${full ? '?full=true' : ''}`
    : `/api/inspections/${item.id}/pdf${full ? '?full=true' : ''}`;

  const openPdf = (e, full) => {
    e.stopPropagation();
    if (!canPdf) { onLockedPdf(); return; }
    window.open(pdfUrl(full), '_blank');
  };

  return (
    <div
      className="insp-history-row"
      onClick={() => { window.location.href = `/inspections/${item.id}/review`; }}
    >
      <div className="insp-history-left">
        <span className="dash-type-badge">{item.type.replace(/_/g, ' ')}</span>
        <div className="insp-history-info">
          <span className="insp-history-prop">
            {item.property?.name}{item.room ? ` — ${item.room.label}` : ''}
          </span>
          <span className="insp-history-inspector">
            {item.inspectorName || '—'} &middot; {new Date(item.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
      <div className="insp-history-right">
        <span className="insp-history-items">
          {item._count?.items || 0} items
        </span>
        <span className="insp-status-badge">{item.status}</span>
        <button
          className={`btn-text-sm ${!canPdf ? 'btn-locked' : ''}`}
          onClick={(e) => openPdf(e, false)}
          title={canPdf ? 'Download summary PDF' : 'PDF export requires Growth plan'}
        >
          PDF {!canPdf && <LockGlyph />}
        </button>
        <button
          className={`btn-text-sm ${!canPdf ? 'btn-locked' : ''}`}
          onClick={(e) => openPdf(e, true)}
          title={canPdf ? 'Download full detail PDF' : 'PDF export requires Growth plan'}
        >
          Full PDF {!canPdf && <LockGlyph />}
        </button>
      </div>
    </div>
  );
}

// ─── Lease Violation Reports tab ───────────────────────

function ViolationReports() {
  const [violations, setViolations] = useState([]);
  const [properties, setProperties] = useState([]);
  const [filterProperty, setFilterProperty] = useState('');
  const [filterStatus, setFilterStatus] = useState('active');
  const [loading, setLoading] = useState(true);
  const { can, gate, promptUpgrade, dismiss } = useFeatureGate();

  useEffect(() => {
    api('/api/properties').then((d) => setProperties(d.properties || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const q = new URLSearchParams();
    if (filterStatus === 'active') q.set('active', 'true');
    if (filterProperty) q.set('propertyId', filterProperty);
    setLoading(true);
    api(`/api/violations?${q}`)
      .then((d) => setViolations(d.violations || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterStatus, filterProperty]);

  const filtered = filterProperty
    ? violations.filter((v) => v.propertyId === filterProperty)
    : violations;

  const downloadCsv = () => {
    if (!can('csvExport')) {
      promptUpgrade({ feature: 'csvExport' });
      return;
    }
    const rows = [['Property', 'Room', 'Category', 'Created', 'Resolved', 'Description']];
    for (const v of filtered) {
      rows.push([
        v.property?.name || '',
        v.room?.label || '',
        v.category || '',
        v.createdAt ? new Date(v.createdAt).toISOString() : '',
        v.resolvedAt ? new Date(v.resolvedAt).toISOString() : '',
        v.description || '',
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `violations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!can('leaseViolations')) {
    return (
      <div className="feature-gate-block">
        <div className="feature-gate-lock"><LockGlyph /></div>
        <h3>Lease violation tracking isn&apos;t on your plan</h3>
        <p>Track violations by resident, log follow-ups, and export PDFs. Available on the Growth plan.</p>
        <button className="btn-primary-sm" onClick={() => promptUpgrade({ feature: 'leaseViolations' })}>
          See upgrade options
        </button>
        <UpgradeModal
          open={gate.open}
          onClose={dismiss}
          feature={gate.feature}
          plan={gate.plan}
          title={gate.title}
          body={gate.body}
        />
      </div>
    );
  }

  return (
    <>
      <div className="reports-tab-header">
        <span className="reports-tab-count">{filtered.length} violation{filtered.length === 1 ? '' : 's'}</span>
        <button
          className={`btn-primary-sm ${!can('csvExport') ? 'btn-locked' : ''}`}
          onClick={downloadCsv}
          title={can('csvExport') ? 'Download CSV' : 'CSV export requires Operator plan'}
        >
          Export CSV {!can('csvExport') && <LockGlyph />}
        </button>
      </div>
      <UpgradeModal
        open={gate.open}
        onClose={dismiss}
        feature={gate.feature}
        plan={gate.plan}
        title={gate.title}
        body={gate.body}
      />
      <div className="maint-filters" style={{ flexWrap: 'wrap' }}>
        <select className="filter-select" value={filterProperty} onChange={(e) => setFilterProperty(e.target.value)}>
          <option value="">All Properties</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="active">Active only</option>
          <option value="all">All (active + resolved)</option>
        </select>
      </div>

      {loading ? <div className="page-loading">Loading...</div> : (
        <div className="violation-list">
          {filtered.length === 0 ? (
            <div className="empty-state"><p>No violations match these filters.</p></div>
          ) : (
            filtered.map((v) => (
              <div key={v.id} className="violation-card">
                <div className="violation-card-head">
                  <div>
                    <div className="violation-card-title">{v.category || 'Violation'}</div>
                    <div className="violation-card-meta">
                      {v.property?.name}{v.room ? ` — ${v.room.label}` : ''} &middot;{' '}
                      {new Date(v.createdAt).toLocaleDateString()}
                      {v.resolvedAt && <> &middot; Resolved {new Date(v.resolvedAt).toLocaleDateString()}</>}
                    </div>
                  </div>
                  <span className={`insp-status-badge ${v.resolvedAt ? 'resolved' : 'active'}`}>
                    {v.resolvedAt ? 'Resolved' : 'Open'}
                  </span>
                </div>
                {v.description && <div className="violation-card-desc">{v.description}</div>}
                {v.note && <div className="violation-card-note">{v.note}</div>}
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}

// ─── Main Reports page (tabs) ──────────────────────────

export default function Reports() {
  const [tab, setTab] = useState('inspections');
  const { can } = useFeatureGate();
  const canViolations = can('leaseViolations');
  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Reports</h1>
        </div>
      </div>
      <div className="reports-tabs">
        <button
          className={`reports-tab ${tab === 'inspections' ? 'active' : ''}`}
          onClick={() => setTab('inspections')}
        >
          Inspection Reports
        </button>
        <button
          className={`reports-tab ${tab === 'maintenance' ? 'active' : ''}`}
          onClick={() => setTab('maintenance')}
        >
          Maintenance Reports
        </button>
        <button
          className={`reports-tab ${tab === 'violations' ? 'active' : ''} ${!canViolations ? 'reports-tab-locked' : ''}`}
          onClick={() => setTab('violations')}
          title={canViolations ? '' : 'Lease violation tracking requires Growth plan'}
        >
          Lease Violations {!canViolations && <LockGlyph />}
        </button>
      </div>
      {tab === 'inspections' && <InspectionReports />}
      {tab === 'maintenance' && <MaintenanceReports />}
      {tab === 'violations' && <ViolationReports />}
    </div>
  );
}
