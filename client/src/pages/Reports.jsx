import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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

const INSPECTION_TYPE_LABELS = {
  QUARTERLY: 'Room Inspection',
  COMMON_AREA: 'Common Area',
  ROOM_TURN: 'Room Turn',
  MOVE_IN_OUT: 'Move-In',
  RESIDENT_SELF_CHECK: 'Self-Check',
  COMMON_AREA_QUICK: 'Common Area Quick',
};

function dateKeyOf(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

// Collapse quarterly rooms into a single row per batch (property + date).
// Everything else stays as its own row.
function groupForReports(inspections) {
  const out = [];
  const quarterlyBuckets = {};
  for (const i of inspections) {
    if (i.status === 'DRAFT') continue; // reports only show submitted/reviewed
    if (i.type === 'QUARTERLY') {
      const propId = i.property?.id || i.propertyId || '';
      const dk = dateKeyOf(i.createdAt);
      const key = `${propId}|${dk}|${i.status}`;
      if (!quarterlyBuckets[key]) {
        quarterlyBuckets[key] = {
          id: `qgroup:${key}`,
          isGroup: true,
          type: 'QUARTERLY',
          status: i.status,
          property: i.property,
          propertyId: propId,
          createdAt: i.createdAt,
          dateKey: dk,
          inspectorName: i.inspectorName,
          roomCount: 0,
          flagCount: 0,
          totalItems: 0,
        };
        out.push(quarterlyBuckets[key]);
      }
      const bucket = quarterlyBuckets[key];
      bucket.roomCount += 1;
      bucket.flagCount += i.flagCount || 0;
      bucket.totalItems += i._count?.items || 0;
      // Keep earliest created time so the row's date matches the batch
      if (new Date(i.createdAt) < new Date(bucket.createdAt)) {
        bucket.createdAt = i.createdAt;
      }
    } else {
      out.push({
        id: i.id,
        isGroup: false,
        type: i.type,
        status: i.status,
        property: i.property,
        propertyId: i.property?.id,
        room: i.room,
        createdAt: i.createdAt,
        inspectorName: i.inspectorName,
        roomCount: i.room ? 1 : 0,
        flagCount: i.flagCount || 0,
        totalItems: i._count?.items || 0,
      });
    }
  }
  return out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

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

  const rows = groupForReports(inspections).filter((r) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      r.property?.name?.toLowerCase().includes(s)
      || r.inspectorName?.toLowerCase().includes(s)
      || r.room?.label?.toLowerCase().includes(s)
    );
  });

  return (
    <>
      <div className="reports-tab-header">
        <span className="reports-tab-count">{rows.length} inspection{rows.length === 1 ? '' : 's'}</span>
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
          {Object.entries(INSPECTION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="REVIEWED">Reviewed</option>
        </select>
      </div>

      {loading ? <div className="page-loading">Loading...</div> : (
        <div className="insp-history-list">
          {rows.length === 0 ? (
            <div className="empty-state"><p>No inspections match these filters.</p></div>
          ) : (
            rows.map((r) => (
              <InspectionReportRow
                key={r.id}
                row={r}
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

function InspectionReportRow({ row, canPdf, onLockedPdf }) {
  const navigate = useNavigate();
  const typeLabel = INSPECTION_TYPE_LABELS[row.type] || row.type;

  const pdfUrl = row.isGroup
    ? `/api/inspections/quarterly-group/${row.propertyId}/${row.dateKey}/pdf`
    : `/api/inspections/${row.id}/pdf`;

  const openPdf = (e) => {
    e.stopPropagation();
    if (!canPdf) { onLockedPdf(); return; }
    window.open(pdfUrl, '_blank');
  };

  const openReview = () => {
    if (row.isGroup) {
      navigate(`/quarterly-review/${row.propertyId}/${row.dateKey}`);
    } else {
      navigate(`/inspections/${row.id}/review`);
    }
  };

  return (
    <div className="insp-history-row" onClick={openReview}>
      <div className="insp-history-left">
        <span className="dash-type-badge">{typeLabel}</span>
        <div className="insp-history-info">
          <span className="insp-history-prop">
            {row.property?.name}{!row.isGroup && row.room ? ` — ${row.room.label}` : ''}
          </span>
          <span className="insp-history-inspector">
            {row.inspectorName || '—'} &middot; {new Date(row.createdAt).toLocaleDateString()}
            {row.isGroup && (
              <> &middot; {row.roomCount} room{row.roomCount === 1 ? '' : 's'}</>
            )}
            {row.flagCount > 0 && (
              <> &middot; {row.flagCount} flag{row.flagCount === 1 ? '' : 's'}</>
            )}
          </span>
        </div>
      </div>
      <div className="insp-history-right">
        <span className="insp-status-badge">{row.status}</span>
        <button
          className={`btn-secondary-sm ${!canPdf ? 'btn-locked' : ''}`}
          onClick={openPdf}
          title={canPdf ? 'Download PDF' : 'PDF export requires Growth plan'}
        >
          Download PDF{!canPdf && <LockGlyph />}
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
    const rows = [['Property', 'Room', 'Resident', 'Violation Type', 'Escalation Level', 'Created', 'Status', 'Resolved', 'Resolution']];
    for (const v of filtered) {
      const typeLabel = v.violationType ? (VIOLATION_TYPE_LABELS[v.violationType] || v.violationType) : (v.category || '');
      const escalLabel = ESCALATION_LABELS[v.escalationLevel] || v.escalationLevel || 'Flagged';
      rows.push([
        v.property?.name || '',
        v.room?.label || '',
        v.residentName || '',
        typeLabel,
        escalLabel,
        v.createdAt ? new Date(v.createdAt).toISOString() : '',
        v.resolvedAt ? 'Resolved' : 'Active',
        v.resolvedAt ? new Date(v.resolvedAt).toISOString() : '',
        v.resolvedType ? v.resolvedType.replace(/_/g, ' ').toLowerCase() : '',
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

  const VIOLATION_TYPE_LABELS = {
    MESSY: 'Messy', BAD_ODOR: 'Bad odor', SMOKING: 'Smoking',
    UNAUTHORIZED_GUESTS: 'Unauthorized guests', PETS: 'Pets', OPEN_FOOD: 'Open food',
    PESTS: 'Pests/bugs', OPEN_FLAMES: 'Open flames/candles',
    OVERLOADED_OUTLETS: 'Overloaded outlets',
    KITCHEN_APPLIANCES: 'Kitchen appliances', LITHIUM_BATTERIES: 'Lithium batteries',
    MODIFICATIONS: 'Modifications', DRUG_PARAPHERNALIA: 'Drug paraphernalia',
    WEAPONS: 'Weapons', UNCLEAR_EGRESS: 'Unclear egress path',
    NOISE: 'Noise', OTHER: 'Other',
  };
  const ESCALATION_LABELS = { FLAGGED: 'Flagged', FIRST_WARNING: '1st Warning', SECOND_WARNING: '2nd Warning', FINAL_NOTICE: 'Final Notice' };
  const ESCALATION_STYLES = {
    FLAGGED: { bg: '#F3F0EC', color: '#8A8583' }, FIRST_WARNING: { bg: '#FEF3C7', color: '#B45309' },
    SECOND_WARNING: { bg: '#FFEDD5', color: '#C2410C' }, FINAL_NOTICE: { bg: '#FEE2E2', color: '#991B1B' },
    RESOLVED: { bg: '#DCFCE7', color: '#166534' },
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
          ) : filtered.map((v) => {
              const typeLabel = v.violationType ? (VIOLATION_TYPE_LABELS[v.violationType] || v.violationType) : (v.category || 'Violation');
              const escalKey = v.resolvedAt ? 'RESOLVED' : (v.escalationLevel || 'FLAGGED');
              const escalStyle = ESCALATION_STYLES[escalKey] || {};
              const escalLabel = v.resolvedAt ? 'Resolved' : (ESCALATION_LABELS[v.escalationLevel] || v.escalationLevel || 'Flagged');
              return (
                <div key={v.id} className="violation-card">
                  <div className="violation-card-head">
                    <div>
                      <div className="violation-card-title">{typeLabel}</div>
                      <div className="violation-card-meta">
                        {v.property?.name}{v.room ? ` — ${v.room.label}` : ''}
                        {v.residentName && <> &middot; {v.residentName}</>}
                        {' '}&middot; {new Date(v.createdAt).toLocaleDateString()}
                        {v.resolvedAt && <> &middot; Resolved {new Date(v.resolvedAt).toLocaleDateString()}</>}
                      </div>
                    </div>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                      background: escalStyle.bg, color: escalStyle.color,
                    }}>{escalLabel}</span>
                  </div>
                  {v.note && <div className="violation-card-note">{v.note}</div>}
                </div>
              );
            })
          }
        </div>
      )}
    </>
  );
}

// ─── Financial Reports tab ─────────────────────────────

const FIN_PRESETS = [
  { value: 'last3', label: 'Last 3 months' },
  { value: 'last6', label: 'Last 6 months' },
  { value: 'last12', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
];

function fmtFinMoney(n) {
  if (n == null || isNaN(n)) return '$0.00';
  return Number(n).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}
function fmtFinMonth(s) {
  if (!s) return '';
  const [y, m] = s.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function applyPreset(preset, allMonths) {
  if (!allMonths || allMonths.length === 0) return { from: '', to: '' };
  const sorted = [...allMonths].sort();
  const last = sorted[sorted.length - 1];
  const trimmed = (n) => sorted.slice(Math.max(0, sorted.length - n));
  if (preset === 'last3')  { const arr = trimmed(3);  return { from: arr[0], to: last }; }
  if (preset === 'last6')  { const arr = trimmed(6);  return { from: arr[0], to: last }; }
  if (preset === 'last12') { const arr = trimmed(12); return { from: arr[0], to: last }; }
  if (preset === 'all')    return { from: sorted[0], to: last };
  return { from: '', to: '' }; // custom
}

function downloadCsv(filename, rows) {
  const csv = rows.map((r) =>
    r.map((cell) => {
      const s = cell == null ? '' : String(cell);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','),
  ).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function FinancialReports() {
  const [pnl, setPnl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [propertyId, setPropertyId] = useState('all');
  const [preset, setPreset] = useState('last6');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [allMonths, setAllMonths] = useState([]);
  const [sortBy, setSortBy] = useState('month');
  const [sortDir, setSortDir] = useState('desc');

  // Bootstrap: fetch with no filter to learn allMonths.
  useEffect(() => {
    api('/api/financials/pnl')
      .then((d) => {
        setAllMonths(d.allMonths || []);
        if ((d.allMonths || []).length > 0 && !from && !to) {
          const r = applyPreset('last6', d.allMonths);
          setFrom(r.from); setTo(r.to);
        }
      })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const qs = new URLSearchParams();
    if (propertyId) qs.set('propertyId', propertyId);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    api(`/api/financials/pnl?${qs.toString()}`)
      .then(setPnl)
      .catch((err) => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [propertyId, from, to]);

  useEffect(() => {
    if (allMonths.length > 0 && from && to) load();
  }, [load, allMonths.length, from, to]);

  const onPresetChange = (val) => {
    setPreset(val);
    if (val !== 'custom') {
      const r = applyPreset(val, allMonths);
      setFrom(r.from); setTo(r.to);
    }
  };

  const sortedRows = useMemo(() => {
    if (!pnl?.byMonth) return [];
    const rows = [...pnl.byMonth];
    rows.sort((a, b) => {
      const av = a[sortBy], bv = b[sortBy];
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const r = String(av || '').localeCompare(String(bv || ''));
      return sortDir === 'asc' ? r : -r;
    });
    return rows;
  }, [pnl, sortBy, sortDir]);

  const totals = useMemo(() => {
    if (!pnl?.byMonth) return null;
    const t = pnl.byMonth.reduce((acc, m) => {
      acc.gross += m.gross; acc.bookingFees += m.bookingFees;
      acc.serviceFees += m.serviceFees; acc.transactionFees += m.transactionFees;
      acc.totalFees += m.totalFees; acc.host += m.hostEarnings;
      acc.maint += m.maintenance; acc.netPL += m.netPL;
      acc.turnovers += m.turnovers;
      return acc;
    }, { gross: 0, bookingFees: 0, serviceFees: 0, transactionFees: 0, totalFees: 0, host: 0, maint: 0, netPL: 0, turnovers: 0 });
    const valid = pnl.byMonth.filter((m) => m.occupancy != null);
    t.occupancy = valid.length > 0
      ? valid.reduce((s, m) => s + m.occupancy, 0) / valid.length
      : null;
    return t;
  }, [pnl]);

  const handleSort = (key) => {
    if (sortBy === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('desc'); }
  };

  const headerCell = (key, label, align = 'right') => (
    <th
      className={sortBy === key ? 'fin-th-sorted' : ''}
      onClick={() => handleSort(key)}
      style={{ cursor: 'pointer', textAlign: align }}
    >
      {label} {sortBy === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  const handleCsv = () => {
    const head = ['Month', 'Gross Collected', 'Booking Fees', 'Service Fees', 'Transaction Fees', 'Total Fees', 'Host Earnings', 'Maintenance', 'Net P&L', 'Occupancy %', 'Turnovers'];
    const rows = sortedRows.map((m) => [
      fmtFinMonth(m.month), m.gross, m.bookingFees, m.serviceFees, m.transactionFees,
      m.totalFees, m.hostEarnings, m.maintenance, m.netPL,
      m.occupancy != null ? m.occupancy.toFixed(1) : '', m.turnovers,
    ]);
    if (totals) {
      rows.push([
        'TOTAL', totals.gross, totals.bookingFees, totals.serviceFees, totals.transactionFees,
        totals.totalFees, totals.host, totals.maint, totals.netPL,
        totals.occupancy != null ? totals.occupancy.toFixed(1) : '', totals.turnovers,
      ]);
    }
    downloadCsv(`financial-pnl-${propertyId}-${Date.now()}.csv`, [head, ...rows]);
  };
  const handlePdf = () => {
    const qs = new URLSearchParams();
    if (propertyId) qs.set('propertyId', propertyId);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    window.open(`/api/financials/report.pdf?${qs.toString()}`, '_blank');
  };

  if (loading && !pnl) return <div className="page-loading">Loading…</div>;
  if (!loading && pnl && !pnl.hasData) {
    return (
      <div className="empty-state">
        <p>No financial data uploaded yet.</p>
        <a href="/financials" className="btn-primary-sm">Upload PadSplit reports</a>
      </div>
    );
  }

  return (
    <div className="reports-tab-content">
      {/* Filter bar */}
      <div className="report-filter-bar" style={{ flexWrap: 'wrap' }}>
        <select
          className="filter-select"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
        >
          <option value="all">All properties</option>
          {(pnl?.properties || []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          className="filter-select"
          value={preset}
          onChange={(e) => onPresetChange(e.target.value)}
        >
          {FIN_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {preset === 'custom' && (
          <>
            <select className="filter-select" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">From…</option>
              {allMonths.map((m) => (
                <option key={m} value={m}>{fmtFinMonth(m)}</option>
              ))}
            </select>
            <select className="filter-select" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">To…</option>
              {allMonths.map((m) => (
                <option key={m} value={m}>{fmtFinMonth(m)}</option>
              ))}
            </select>
          </>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary-sm" onClick={handleCsv}>Download CSV</button>
          <button className="btn-primary-sm" onClick={handlePdf}>Download PDF</button>
        </div>
      </div>

      {error && <div className="auth-error">{error}</div>}

      {/* Monthly P&L table */}
      <div className="reports-tab-header">
        <span className="reports-tab-count">
          {sortedRows.length} month{sortedRows.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="fin-table-wrap">
        <table className="fin-table">
          <thead>
            <tr>
              {headerCell('month', 'Month', 'left')}
              {headerCell('gross', 'Gross collected')}
              {headerCell('bookingFees', 'Booking fees')}
              {headerCell('serviceFees', 'Service fees')}
              {headerCell('transactionFees', 'Txn fees')}
              {headerCell('totalFees', 'Total fees')}
              {headerCell('hostEarnings', 'Host earnings')}
              {headerCell('maintenance', 'Maintenance')}
              {headerCell('netPL', 'Net P&L')}
              {headerCell('occupancy', 'Occupancy %')}
              {headerCell('turnovers', 'Turnovers')}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr><td colSpan="11" className="fin-empty">No months in range.</td></tr>
            ) : sortedRows.map((m) => {
              const tone = m.netPL > 0 ? 'good' : m.netPL < 0 ? 'bad' : 'warn';
              return (
                <tr key={m.month}>
                  <td>{fmtFinMonth(m.month)}</td>
                  <td>{fmtFinMoney(m.gross)}</td>
                  <td>{fmtFinMoney(m.bookingFees)}</td>
                  <td>{fmtFinMoney(m.serviceFees)}</td>
                  <td>{fmtFinMoney(m.transactionFees)}</td>
                  <td>{fmtFinMoney(m.totalFees)}</td>
                  <td>{fmtFinMoney(m.hostEarnings)}</td>
                  <td>{fmtFinMoney(m.maintenance)}</td>
                  <td className={`fin-pl fin-pl-${tone}`}>{fmtFinMoney(m.netPL)}</td>
                  <td>{m.occupancy != null ? `${m.occupancy.toFixed(1)}%` : '—'}</td>
                  <td>{m.turnovers}</td>
                </tr>
              );
            })}
            {totals && sortedRows.length > 0 && (
              <tr className="fin-totals-row">
                <td><strong>Total</strong></td>
                <td><strong>{fmtFinMoney(totals.gross)}</strong></td>
                <td><strong>{fmtFinMoney(totals.bookingFees)}</strong></td>
                <td><strong>{fmtFinMoney(totals.serviceFees)}</strong></td>
                <td><strong>{fmtFinMoney(totals.transactionFees)}</strong></td>
                <td><strong>{fmtFinMoney(totals.totalFees)}</strong></td>
                <td><strong>{fmtFinMoney(totals.host)}</strong></td>
                <td><strong>{fmtFinMoney(totals.maint)}</strong></td>
                <td><strong>{fmtFinMoney(totals.netPL)}</strong></td>
                <td><strong>{totals.occupancy != null ? `${totals.occupancy.toFixed(1)}%` : '—'}</strong></td>
                <td><strong>{totals.turnovers}</strong></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Per-property breakdown */}
      {propertyId === 'all' && pnl?.byProperty?.length > 0 && (
        <>
          <h2 className="md-section-title" style={{ marginTop: '1.5rem' }}>Per-property P&L</h2>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th style={{ textAlign: 'right' }}>Gross collected</th>
                  <th style={{ textAlign: 'right' }}>Total fees</th>
                  <th style={{ textAlign: 'right' }}>Host earnings</th>
                  <th style={{ textAlign: 'right' }}>Maintenance</th>
                  <th style={{ textAlign: 'right' }}>Net P&L</th>
                  <th style={{ textAlign: 'right' }}>Occupancy %</th>
                  <th style={{ textAlign: 'right' }}>Turnovers</th>
                </tr>
              </thead>
              <tbody>
                {pnl.byProperty.map((p) => {
                  const tone = p.netPL > 0 ? 'good' : p.netPL < 0 ? 'bad' : 'warn';
                  return (
                    <tr key={p.propertyId}>
                      <td>{p.propertyName}</td>
                      <td>{fmtFinMoney(p.gross)}</td>
                      <td>{fmtFinMoney(p.totalFees)}</td>
                      <td>{fmtFinMoney(p.hostEarnings)}</td>
                      <td>{fmtFinMoney(p.maintenance)}</td>
                      <td className={`fin-pl fin-pl-${tone}`}>{fmtFinMoney(p.netPL)}</td>
                      <td>{p.occupancy != null ? `${p.occupancy.toFixed(1)}%` : '—'}</td>
                      <td>{p.turnovers}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Per-room breakdown when a single property is selected */}
      {propertyId !== 'all' && pnl?.rooms?.length > 0 && (
        <>
          <h2 className="md-section-title" style={{ marginTop: '1.5rem' }}>Room-level P&L</h2>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Room</th>
                  <th style={{ textAlign: 'right' }}>Gross collected</th>
                  <th style={{ textAlign: 'right' }}>Total fees</th>
                  <th style={{ textAlign: 'right' }}>Host earnings</th>
                </tr>
              </thead>
              <tbody>
                {pnl.rooms.map((r) => (
                  <tr key={r.roomNumber}>
                    <td>{r.roomNumber}</td>
                    <td>{fmtFinMoney(r.gross)}</td>
                    <td>{fmtFinMoney(r.totalFees)}</td>
                    <td>{fmtFinMoney(r.hostEarnings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
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
        <button
          className={`reports-tab ${tab === 'financial' ? 'active' : ''}`}
          onClick={() => setTab('financial')}
        >
          Financial Reports
        </button>
      </div>
      {tab === 'inspections' && <InspectionReports />}
      {tab === 'maintenance' && <MaintenanceReports />}
      {tab === 'violations' && <ViolationReports />}
      {tab === 'financial' && <FinancialReports />}
    </div>
  );
}
