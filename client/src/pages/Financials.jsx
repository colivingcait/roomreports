import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import Modal from '../components/Modal';

const SAGE = '#6B8F71';
const TERRACOTTA = '#C4703F';
const PALETTE = [
  '#6B8F71', '#C4703F', '#8AA8C9', '#BA7517', '#9C7DA8',
  '#5F8B7A', '#D49B6F', '#7196B5', '#A4805C', '#7A6F92',
];

const api = (path, opts = {}) =>
  fetch(path, {
    credentials: 'include',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  }).then(async (r) => {
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  });

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '$0.00';
  return Number(n).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtMonth(s) {
  if (!s) return '';
  const [y, m] = s.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Compact "Feb 25" / "Mar 25" / "Apr 26" for chart x-axis ticks.
function fmtMonthShort(s) {
  if (!s) return '';
  const [y, m] = s.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  const mon = d.toLocaleDateString('en-US', { month: 'short' });
  return `${mon} ${y.slice(2)}`;
}

// Chart metric configs: which dataKey to render, what kind of chart,
// how to format the Y-axis + tooltip, and which color category.
// `aggregate: true` collapses all properties into a single "Total"
// line so the chart shows portfolio-wide totals instead of per-property
// series.
const CHART_METRICS = {
  host:        { label: 'Host earnings',   key: 'host',        kind: 'line', yFmt: (v) => `$${(v / 1000).toFixed(0)}k`, valFmt: (v) => fmtMoney(v) },
  gross:       { label: 'Gross collected', key: 'gross',       kind: 'line', yFmt: (v) => `$${(v / 1000).toFixed(0)}k`, valFmt: (v) => fmtMoney(v) },
  fees:        { label: 'Platform fees',   key: 'fees',        kind: 'line', yFmt: (v) => `$${(v / 1000).toFixed(0)}k`, valFmt: (v) => fmtMoney(v) },
  total:       { label: 'Total earnings',  key: 'host',        kind: 'line', aggregate: true, yFmt: (v) => `$${(v / 1000).toFixed(0)}k`, valFmt: (v) => fmtMoney(v) },
  occupancy:   { label: 'Occupancy %',     key: 'occupancy',   kind: 'line', yFmt: (v) => `${v}%`, yDomain: [0, 100],     valFmt: (v) => `${v}%` },
  turnovers:   { label: 'Turnovers',       key: 'turnovers',   kind: 'bar',  yFmt: (v) => `${v}`, yAllowDecimals: false,  valFmt: (v) => `${v}` },
  daysToFill:  { label: 'Avg days to fill', key: 'daysToFill', kind: 'line', yFmt: (v) => `${v}d`, yAllowDecimals: false, valFmt: (v) => `${v} days` },
  maintenance: { label: 'Maintenance costs', key: 'maintenance', kind: 'line', yFmt: (v) => `$${(v / 1000).toFixed(0)}k`, valFmt: (v) => fmtMoney(v) },
};
const CHART_METRIC_ORDER = ['host', 'gross', 'fees', 'total', 'occupancy', 'turnovers', 'daysToFill', 'maintenance'];

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return isNaN(n) ? null : n;
}

// Detect file kind by header set, then parse rows into our normalized shape
function detectKind(headers) {
  const lc = headers.map((h) => h.trim().toLowerCase());
  const has = (k) => lc.includes(k.toLowerCase());
  if (has('Earnings Month') && has('PSID')) return 'summary';
  if (has('Bill ID') && has('Transaction Type')) return 'billed';
  if (has('row_type') && has('total_collections')) return 'earnings_table';
  if (has('Room Number') && has('Member ID') && has('Bill Type')) return 'collected';
  return 'unknown';
}

function rowGet(row, ...keys) {
  for (const k of keys) {
    for (const rk of Object.keys(row)) {
      if (rk.trim().toLowerCase() === k.trim().toLowerCase()) return row[rk];
    }
  }
  return undefined;
}

// PadSplit's collected.csv splits resident names across "First Name"
// and "Last Name" columns (some exports use "Member First Name" /
// "Member Last Name"). Falls through to single-column variants.
function rowMemberName(r) {
  const single = rowGet(r, 'Member Name', 'Resident Name', 'Member', 'Tenant Name', 'Name');
  if (single && String(single).trim()) return String(single).trim();
  const first = rowGet(r, 'First Name', 'Member First Name', 'Tenant First Name', 'Resident First Name');
  const last = rowGet(r, 'Last Name', 'Member Last Name', 'Tenant Last Name', 'Resident Last Name');
  const parts = [first, last].map((v) => (v == null ? '' : String(v).trim())).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

// PadSplit splits the property address across Street 1 / Street 2 in
// some exports; the SUMMARY file gives a single "Address". Always
// produce a non-empty address so the dashboard can aggregate by it.
function rowAddress(r) {
  const direct = rowGet(r, 'Address', 'Property Address');
  if (direct && String(direct).trim()) return String(direct).trim();
  const s1 = rowGet(r, 'Street 1', 'Street1', 'Address Line 1');
  const s2 = rowGet(r, 'Street 2', 'Street2', 'Address Line 2');
  const parts = [s1, s2].map((v) => (v == null ? '' : String(v).trim())).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

// Extract a YYYY-MM month string from an arbitrary date-ish cell.
// Handles "2026-04-01", "2026-04-01T00:00:00Z", "2026-04", "4/1/2026".
function toYearMonth(v) {
  if (!v) return null;
  const s = String(v).trim();
  // ISO-ish: YYYY-MM[-DD...]
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  // US slash: M/D/YYYY or MM/DD/YYYY
  const us = s.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})/);
  if (us) return `${us[2]}-${us[1].padStart(2, '0')}`;
  // Fallback: try Date parsing
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return null;
}

// Parse a date-ish cell into an ISO date string (YYYY-MM-DD).
// Returns null if unparseable. Used for per-row "Created" timestamps
// so the server can compute exact move-in / move-out days.
function toIsoDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  // Already-ISO YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS...
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // US slash: M/D/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    return `${us[3]}-${String(us[1]).padStart(2, '0')}-${String(us[2]).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  return null;
}

function parseRows(kind, rows) {
  const out = [];
  if (kind === 'summary') {
    for (const r of rows) {
      const month = toYearMonth(rowGet(r, 'Earnings Month'));
      if (!month) continue;
      out.push({
        recordType: 'SUMMARY',
        earningsMonth: month,
        propertyPSID: rowGet(r, 'PSID'),
        propertyAddress: rowGet(r, 'Address'),
        grossAmount: num(rowGet(r, 'Gross Collected')),
        bookingFee: num(rowGet(r, 'Booking Fees Amount', 'Booking Fee Amount', 'Booking Fee', 'Booking Fees')),
        hostEarnings: num(rowGet(r, 'Host Earnings')),
        serviceFee: num(rowGet(r, 'Service Fees', 'Service Fee', 'Service Fee Amount', 'Service Fees Amount')),
        transactionFee: num(rowGet(r, 'Txn Fees', 'Txn Fee', 'Transaction Fees', 'Transaction Fee', 'Transaction Fee Amount', 'Transaction Fees Amount')),
      });
    }
  } else if (kind === 'collected') {
    for (const r of rows) {
      const month = toYearMonth(
        rowGet(r, 'Payout Month', 'Earnings Month', 'Created', 'Payout Date'),
      );
      if (!month) continue;
      const recordDate = toIsoDate(rowGet(r, 'Created', 'Payout Date'));
      out.push({
        recordType: 'COLLECTED',
        earningsMonth: month,
        recordDate,
        roomNumber: rowGet(r, 'Room Number'),
        roomId: rowGet(r, 'Room ID'),
        memberId: rowGet(r, 'Member ID'),
        memberName: rowMemberName(r),
        billType: rowGet(r, 'Bill Type'),
        propertyAddress: rowAddress(r),
        propertyPSID: rowGet(r, 'PSID', 'Property ID'),
        grossAmount: num(rowGet(r, 'Gross Collected')),
        bookingFee: num(rowGet(r, 'Booking Fee Amount', 'Booking Fees Amount', 'Booking Fee', 'Booking Fees')),
        serviceFee: num(rowGet(r, 'Service Fees', 'Service Fee', 'Service Fee Amount', 'Service Fees Amount')),
        transactionFee: num(rowGet(r, 'Txn Fees', 'Txn Fee', 'Transaction Fees', 'Transaction Fee', 'Transaction Fee Amount', 'Transaction Fees Amount')),
        hostEarnings: num(rowGet(r, 'Host Earnings')),
        category: rowGet(r, 'Category'),
      });
    }
  } else if (kind === 'billed') {
    for (const r of rows) {
      const month = toYearMonth(
        rowGet(r, 'Payout Month', 'Earnings Month', 'Created', 'Created Date', 'Bill Date'),
      );
      if (!month) continue;
      const recordDate = toIsoDate(rowGet(r, 'Created', 'Created Date', 'Bill Date'));
      out.push({
        recordType: 'BILLED',
        earningsMonth: month,
        recordDate,
        billId: rowGet(r, 'Bill ID'),
        transactionType: rowGet(r, 'Transaction Type'),
        transactionReason: rowGet(r, 'Transaction Reason'),
        billType: rowGet(r, 'Bill Type'),
        roomNumber: rowGet(r, 'Room Number'),
        roomId: rowGet(r, 'Room ID'),
        memberId: rowGet(r, 'Member ID'),
        memberName: rowMemberName(r),
        propertyAddress: rowAddress(r),
        propertyPSID: rowGet(r, 'PSID', 'Property ID'),
        grossAmount: num(rowGet(r, 'Amount')),
      });
    }
  } else if (kind === 'earnings_table') {
    for (const r of rows) {
      const month = toYearMonth(rowGet(r, 'month', 'Earnings Month'));
      if (!month) continue;
      out.push({
        recordType: 'EARNINGS_TABLE',
        rowType: rowGet(r, 'row_type'),
        earningsMonth: month,
        totalCollections: num(rowGet(r, 'total_collections')),
        totalExpenses: num(rowGet(r, 'total_expenses')),
        totalPayout: num(rowGet(r, 'total_payout')),
      });
    }
  }
  return out;
}

// Clean a header cell: strip UTF-8 BOM and trailing whitespace.
function cleanHeader(h) {
  let s = String(h == null ? '' : h);
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s.replace(/^[\s ]+|[\s ]+$/g, '');
}

function parseFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      // Strip UTF-8 BOM and trim whitespace from every header so column
      // matching is reliable even when PadSplit ships exports with a BOM.
      transformHeader: cleanHeader,
      complete: (result) => {
        const headers = result.meta.fields || [];
        const kind = detectKind(headers);
        if (kind === 'unknown') {
          reject(new Error(`Could not identify ${file.name}. Headers: ${headers.slice(0, 8).join(', ')}`));
          return;
        }
        // One-time visibility into the CSV's actual column names.
        // Helps debug "where's the resident name?" without a round trip.
        // eslint-disable-next-line no-console
        console.log(`[financials] ${file.name} (${kind}) headers:`, headers);
        const rows = parseRows(kind, result.data);
        const totalRaw = result.data.length;
        const dropped = totalRaw - rows.length;
        const months = new Set(rows.map((r) => r.earningsMonth));
        resolve({
          kind,
          fileName: file.name,
          rows,
          headers,
          totalRaw,
          dropped,
          monthCount: months.size,
        });
      },
      error: (err) => reject(err),
    });
  });
}

function uniqueMonths(parsedSets) {
  const set = new Set();
  for (const ps of parsedSets) {
    for (const r of ps.rows) {
      if (r.earningsMonth) set.add(r.earningsMonth);
    }
  }
  return [...set].sort();
}

// ─── Trend arrow ────────────────────────────────────────

function TrendArrow({ delta, invert = false }) {
  if (delta == null) return null;
  if (delta === 0) {
    return <span className="fin-trend fin-trend-flat">±0%</span>;
  }
  const positive = delta > 0;
  // For "fees" + "vacancy", down = good. For revenue, up = good.
  const good = invert ? !positive : positive;
  return (
    <span className={`fin-trend ${good ? 'fin-trend-good' : 'fin-trend-bad'}`}>
      {positive ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

// ─── Upload zone ────────────────────────────────────────

function UploadZone({ onUpload, busy, error }) {
  const inputRef = useRef(null);
  const [hover, setHover] = useState(false);

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    onUpload([...files]);
  };

  return (
    <div
      className={`fin-drop ${hover ? 'fin-drop-hover' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setHover(true); }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !busy && inputRef.current?.click()}
    >
      <div className="fin-drop-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <div className="fin-drop-title">
        {busy ? 'Uploading…' : 'Upload PadSplit monthly report'}
      </div>
      <div className="fin-drop-sub">
        Drag & drop summary.csv, collected.csv, billed.csv, earnings_table.csv — or click to browse
      </div>
      {error && <div className="fin-drop-error">{error}</div>}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}

// ─── Property breakdown card ────────────────────────────

function PropertyCard({ p, expanded, onToggle, onRoomClick }) {
  const [sortBy, setSortBy] = useState('roomNumber');
  const [sortDir, setSortDir] = useState('asc');

  const rooms = useMemo(() => {
    // Derive platformFees so it's sortable like a real column.
    const enriched = p.rooms.map((r) => ({
      ...r,
      platformFees: (r.bookingFee || 0) + (r.serviceFee || 0) + (r.transactionFee || 0),
    }));
    enriched.sort((a, b) => {
      const av = a[sortBy] ?? '';
      const bv = b[sortBy] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const r = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? r : -r;
    });
    return enriched;
  }, [p.rooms, sortBy, sortDir]);

  const toggleSort = (key) => {
    if (sortBy === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('asc'); }
  };

  const headerCell = (key, label) => (
    <th
      className={`fin-th ${sortBy === key ? 'fin-th-sorted' : ''}`}
      onClick={() => toggleSort(key)}
      style={{ cursor: 'pointer' }}
    >
      {label} {sortBy === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div className={`fin-prop-card ${expanded ? 'fin-prop-card-expanded' : ''}`}>
      <button type="button" className="fin-prop-head" onClick={onToggle}>
        <div className="fin-prop-head-left">
          <span className="fin-prop-name">{p.propertyName}</span>
          <span className="fin-prop-subtitle">{p.padsplitAddress}</span>
        </div>
        <div className="fin-prop-head-stats">
          <span><strong>{fmtMoney(p.gross)}</strong><br /><small>Collected</small></span>
          <span><strong>{fmtMoney(p.hostEarnings)}</strong><br /><small>Host earn</small></span>
          <span>
            <strong>{p.occupancyRate != null ? `${p.occupancyRate.toFixed(1)}%` : '—'}</strong>
            <br /><small>Occupied</small>
          </span>
          <span className="fin-prop-chev">{expanded ? '▾' : '▸'}</span>
        </div>
      </button>

      {expanded && (
        <div className="fin-prop-body">
          {/* Line 1 — financial metrics (7 cards) */}
          <div className="fin-prop-stat-grid fin-prop-stat-grid-7">
            <div className="fin-prop-stat"><label>Total collected</label><span>{fmtMoney(p.gross)}</span></div>
            <div className="fin-prop-stat">
              <label>Booking/txn fees</label>
              <span>{fmtMoney((p.bookingFee || 0) + (p.transactionFee || 0))}</span>
            </div>
            <div className="fin-prop-stat"><label>Service fees (8%)</label><span>{fmtMoney(p.serviceFee)}</span></div>
            <div className="fin-prop-stat"><label>Net earnings</label><span>{fmtMoney(p.hostEarnings)}</span></div>
            <div className="fin-prop-stat">
              <label>Vacancy</label>
              <span>{fmtMoney(p.vacancy)}</span>
              <small className="fin-prop-stat-sub">
                {p.vacantDays} {p.vacantDays === 1 ? 'day' : 'days'} vacant
              </small>
            </div>
            <div className="fin-prop-stat"><label>Turnovers</label><span>{p.turnoversThisMonth}</span></div>
            <div className="fin-prop-stat"><label>Maintenance cost</label><span>{fmtMoney(p.maintenanceCost)}</span></div>
          </div>

          {/* Line 2 — room insight metrics */}
          <div className="fin-prop-stat-grid fin-prop-stat-grid-4">
            {p.hasFeatureData ? (
              <>
                <div className="fin-prop-stat">
                  <label>Avg private bath</label>
                  <span>{p.avgPrivateBathRent != null ? fmtMoney(p.avgPrivateBathRent) : '—'}</span>
                </div>
                <div className="fin-prop-stat">
                  <label>Avg shared bath</label>
                  <span>{p.avgSharedBathRent != null ? fmtMoney(p.avgSharedBathRent) : '—'}</span>
                </div>
              </>
            ) : (
              <div className="fin-prop-stat">
                <label>Avg rent / room</label>
                <span>{fmtMoney(p.avgRentPerRoom)}</span>
              </div>
            )}
            <div className="fin-prop-stat">
              <label>Avg tenure</label>
              <span>{p.avgTenureMonths != null ? `${p.avgTenureMonths} months` : '—'}</span>
            </div>
            <div className="fin-prop-stat">
              <label>Avg days to fill</label>
              <span>{p.avgDaysToFill != null ? `${p.avgDaysToFill} days` : '—'}</span>
            </div>
          </div>

          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  {headerCell('roomNumber', 'Room')}
                  {headerCell('residentName', 'Resident')}
                  {headerCell('gross', 'Collected')}
                  {headerCell('lateFees', 'Late fees')}
                  {headerCell('platformFees', 'Platform fees')}
                  {headerCell('hostEarnings', 'Host earn')}
                  {headerCell('vacantDays', 'Vacant days')}
                  {headerCell('vacancy', 'Vacancy')}
                  {headerCell('turnover', 'Turn?')}
                  {headerCell('maintenanceCost', 'Maint')}
                  {headerCell('netPL', 'Net P&L')}
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => {
                  const tone = r.netPL > 50 ? 'good' : r.netPL < -10 ? 'bad' : 'warn';
                  return (
                    <tr key={`${r.roomNumber}-${r.roomId || ''}`}
                        className="fin-row-clickable"
                        onClick={() => onRoomClick(r)}>
                      <td>{r.roomNumber || '—'}</td>
                      <td>{r.residentName || <span className="fin-muted">vacant</span>}</td>
                      <td>{fmtMoney(r.gross)}</td>
                      <td>{fmtMoney(r.lateFees)}</td>
                      <td>{fmtMoney(r.platformFees)}</td>
                      <td>{fmtMoney(r.hostEarnings)}</td>
                      <td>{r.vacantDays || 0}</td>
                      <td>{fmtMoney(r.vacancy)}</td>
                      <td>{r.turnover ? <span className="fin-turn-yes">Yes</span> : '—'}</td>
                      <td>{fmtMoney(r.maintenanceCost)}</td>
                      <td className={`fin-pl fin-pl-${tone}`}>{fmtMoney(r.netPL)}</td>
                    </tr>
                  );
                })}
                {rooms.length === 0 && (
                  <tr><td colSpan="11" className="fin-empty">No room data for this month.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────

export default function Financials() {
  const [uploads, setUploads] = useState([]);
  const [months, setMonths] = useState([]);
  const [collectedByMonth, setCollectedByMonth] = useState({});
  const [selectedMonth, setSelectedMonth] = useState(null);
  // When the user (or default logic) lands on a thin month, store
  // what they tried to view here so we can render a banner.
  const [thinMonthBanner, setThinMonthBanner] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [timeseries, setTimeseries] = useState(null);
  const [chartMetric, setChartMetric] = useState('host');
  const [hiddenSeries, setHiddenSeries] = useState(() => new Set());
  const [chartTimeline, setChartTimeline] = useState('all');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [metroFilter, setMetroFilter] = useState('all');
  const [expandedProps, setExpandedProps] = useState({});
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadInfo, setUploadInfo] = useState('');
  const [resetting, setResetting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [roomDetail, setRoomDetail] = useState(null);
  const [mappings, setMappings] = useState({ mappings: [], unmatched: [] });
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [allProperties, setAllProperties] = useState([]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [uploadsRes, monthsRes, propsRes] = await Promise.all([
        api('/api/financials/uploads'),
        api('/api/financials/months'),
        api('/api/properties'),
      ]);
      setUploads(uploadsRes.uploads || []);
      const monthList = monthsRes.months || [];
      const collected = monthsRes.collectedByMonth || {};
      setMonths(monthList);
      setCollectedByMonth(collected);
      setAllProperties(propsRes.properties || []);
      if (monthList.length > 0) {
        // Default to the most recent month with at least $1,000 in
        // collections — current calendar month often has $0 because the
        // upload hasn't happened yet, and showing zeros would mislead.
        const defaultMonth = monthList.find((m) => (collected[m] || 0) >= 1000) || monthList[0];
        const latestMonth = monthList[0];
        if (defaultMonth !== latestMonth && (collected[latestMonth] || 0) < 1000) {
          setThinMonthBanner({ requested: latestMonth, fallback: defaultMonth });
        }
        setSelectedMonth((m) => m || defaultMonth);
      } else {
        setSelectedMonth(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadDashboard = useCallback(async () => {
    if (selectedMonth === null) {
      setDashboard(null);
      return;
    }
    try {
      const [dash, ts, maps] = await Promise.all([
        api(`/api/financials/dashboard?month=${encodeURIComponent(selectedMonth)}`),
        api('/api/financials/timeseries'),
        api('/api/financials/mappings'),
      ]);
      setDashboard(dash);
      setTimeseries(ts);
      setMappings(maps);
    } catch (err) {
      console.error(err);
    }
  }, [selectedMonth]);

  useEffect(() => {
    if (months.length > 0 && selectedMonth) loadDashboard();
  }, [selectedMonth, months.length, loadDashboard]);

  const handleUpload = async (files) => {
    setUploadBusy(true);
    setUploadError('');
    setUploadInfo('');
    try {
      const parsedSets = [];
      for (const f of files) {
        const parsed = await parseFile(f);
        parsedSets.push(parsed);
      }
      // Per-file parse summary so it's obvious if something is wrong.
      const perFile = parsedSets
        .map((s) => `${s.fileName}: ${s.rows.length}/${s.totalRaw} rows, ${s.monthCount} months${s.dropped ? `, ${s.dropped} dropped` : ''}`)
        .join(' · ');
      // Cross-file address resolution: SUMMARY rows always carry the
      // street address + PSID. COLLECTED/BILLED sometimes only carry the
      // Property ID (= PSID) with Street 1 / Street 2 columns. Build a
      // PSID -> address map from any row that has both, then backfill
      // missing addresses on the rest.
      const psidToAddress = {};
      for (const set of parsedSets) {
        for (const row of set.rows) {
          if (row.propertyPSID && row.propertyAddress && !psidToAddress[row.propertyPSID]) {
            psidToAddress[row.propertyPSID] = row.propertyAddress;
          }
        }
      }
      const records = [];
      for (const set of parsedSets) {
        for (const row of set.rows) {
          if (!row.earningsMonth) continue;
          if (!row.propertyAddress && row.propertyPSID && psidToAddress[row.propertyPSID]) {
            row.propertyAddress = psidToAddress[row.propertyPSID];
          }
          records.push(row);
        }
      }
      if (records.length === 0) {
        throw new Error(`No rows could be assigned to an earnings month. ${perFile}`);
      }
      const monthsInUpload = uniqueMonths(parsedSets);
      const res = await api('/api/financials/upload', {
        method: 'POST',
        body: JSON.stringify({
          fileNames: parsedSets.map((s) => s.fileName),
          records,
        }),
      });
      await loadAll();
      if (monthsInUpload.length > 0) {
        setSelectedMonth(monthsInUpload[monthsInUpload.length - 1]);
      }
      const monthList = (res?.months || []).join(', ');
      setUploadInfo(
        `Uploaded ${res.recordsInserted} rows across ${res.monthsAffected} month${res.monthsAffected === 1 ? '' : 's'}` +
        (res.droppedRows ? ` (${res.droppedRows} dropped)` : '') +
        ` — ${monthList}`,
      );
    } catch (err) {
      setUploadError(err.message || 'Upload failed');
    } finally {
      setUploadBusy(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Wipe all financial data for this organization? This cannot be undone.')) return;
    setResetting(true);
    setUploadError('');
    setUploadInfo('');
    try {
      const res = await api('/api/financials/reset', { method: 'POST' });
      setSelectedMonth(null);
      await loadAll();
      setUploadInfo(`Wiped ${res.recordsDeleted} records across ${res.uploadsDeleted} uploads.`);
    } catch (err) {
      setUploadError(err.message || 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  const handleDeleteMonth = async (month) => {
    if (!confirm(`Remove ${fmtMonth(month)} data? This cannot be undone.`)) return;
    setUploadError('');
    setUploadInfo('');
    try {
      const res = await api(`/api/financials/uploads/${encodeURIComponent(month)}`, { method: 'DELETE' });
      // If we were viewing the month we just removed, fall back to the
      // next valid month.
      if (selectedMonth === month) setSelectedMonth(null);
      await loadAll();
      setUploadInfo(`Removed ${res.recordsDeleted} records for ${fmtMonth(month)}.`);
    } catch (err) {
      setUploadError(err.message || 'Delete failed');
    }
  };

  const togglePropExpand = (id) => {
    setExpandedProps((s) => ({ ...s, [id]: !s[id] }));
  };

  // Filter the months array by the active timeline pill.
  const filteredMonths = useMemo(() => {
    if (!timeseries || !timeseries.months || timeseries.months.length === 0) return [];
    const all = timeseries.months;
    if (chartTimeline === 'all') return all;
    if (chartTimeline === 'custom') {
      const { from, to } = customRange;
      if (!from && !to) return all;
      return all.filter((m) => (!from || m >= from) && (!to || m <= to));
    }
    const now = new Date();
    const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const curMonth = ym(now);
    if (chartTimeline === 'ytd') {
      const start = `${now.getUTCFullYear()}-01`;
      return all.filter((m) => m >= start && m <= curMonth);
    }
    const window = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }[chartTimeline] || 12;
    const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (window - 1), 1));
    const startMonth = ym(cutoff);
    return all.filter((m) => m >= startMonth && m <= curMonth);
  }, [timeseries, chartTimeline, customRange]);

  const chartData = useMemo(() => {
    if (!timeseries || filteredMonths.length === 0) return [];
    const cfg = CHART_METRICS[chartMetric] || CHART_METRICS.host;
    // Aggregate mode: sum the metric across every (visible) property
    // into a single "Total" series for each month.
    if (cfg.aggregate) {
      const visible = (timeseries.series || []).filter(
        (s) => metroFilter === 'all' || (s.metroArea || '') === metroFilter,
      );
      return filteredMonths.map((m) => {
        let total = 0;
        for (const s of visible) {
          const pt = s.points.find((p) => p.month === m);
          if (pt && pt[cfg.key] != null) total += pt[cfg.key];
        }
        return { month: m, Total: total };
      });
    }
    return filteredMonths.map((m) => {
      const obj = { month: m };
      for (const s of timeseries.series) {
        const pt = s.points.find((p) => p.month === m);
        const val = pt ? pt[cfg.key] : null;
        obj[s.propertyName] = val == null ? 0 : val;
      }
      return obj;
    });
  }, [timeseries, filteredMonths, chartMetric, metroFilter]);

  if (loading) return <div className="page-loading">Loading…</div>;

  // Metros surfaced in the data — used to populate the filter dropdown.
  // Only metros that have at least one property attached get a slot.
  const metroOptions = (() => {
    const set = new Set();
    for (const p of (dashboard?.propertyBreakdown || [])) {
      if (p.metroArea) set.add(p.metroArea);
    }
    return [...set].sort();
  })();

  const propertyBreakdownAll = dashboard?.propertyBreakdown || [];
  const propertyBreakdown = metroFilter === 'all'
    ? propertyBreakdownAll
    : propertyBreakdownAll.filter((p) => (p.metroArea || '') === metroFilter);

  // Recompute portfolio totals client-side when filtering by metro.
  // For "all" we keep the server totals (preserve trend deltas).
  const totalsRaw = dashboard?.totals || {};
  const trends = metroFilter === 'all' ? (dashboard?.trends || {}) : {};
  const totals = metroFilter === 'all'
    ? totalsRaw
    : (() => {
        let host = 0; let gross = 0; let fees = 0;
        let occRoomDays = 0; let occVacantDays = 0;
        let turnovers = 0; let maint = 0;
        for (const p of propertyBreakdown) {
          host += p.hostEarnings || 0;
          gross += p.gross || 0;
          fees += (p.bookingFee || 0) + (p.serviceFee || 0) + (p.transactionFee || 0);
          occRoomDays += p.roomDays || 0;
          occVacantDays += p.vacantDays || 0;
          turnovers += p.turnoversThisMonth || 0;
          maint += p.maintenanceCost || 0;
        }
        const occupancy = occRoomDays > 0
          ? ((occRoomDays - occVacantDays) / occRoomDays) * 100
          : null;
        return {
          ...totalsRaw,
          hostEarnings: host,
          gross,
          fees,
          occupancy,
          turnovers,
          maintenance: maint,
        };
      })();

  return (
    <div className="page-container fin-page">
      <div className="page-header">
        <div>
          <h1>Financials</h1>
          <p className="page-subtitle">PadSplit monthly performance across your portfolio</p>
        </div>
      </div>

      {/* Upload section — stays at top of the page */}
      <section className="fin-section">
        <UploadZone onUpload={handleUpload} busy={uploadBusy} error={uploadError} />
        {uploads.length > 0 && (() => {
          const last = uploads[0];
          return (
            <div className="fin-last-synced">
              Last synced: {new Date(last.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {' · '}
              {fmtMonth(last.earningsMonth)} data
            </div>
          );
        })()}

        {uploadInfo && <div className="fin-info-banner">{uploadInfo}</div>}

        {mappings.unmatched && mappings.unmatched.length > 0 && (
          <div className="fin-warning-banner">
            <strong>{mappings.unmatched.length} address{mappings.unmatched.length === 1 ? '' : 'es'} not matched</strong>
            <span> to a RoomReport property.</span>
            <button
              className="btn-link"
              onClick={() => setShowMappingModal(true)}
            >
              Match manually →
            </button>
          </div>
        )}
      </section>

      {months.length === 0 ? (
        <div className="fin-empty-state">
          <p>Upload your first PadSplit monthly report to see your financial dashboard.</p>
        </div>
      ) : (
        <>
          {thinMonthBanner && (
            <div className="fin-thin-banner">
              {fmtMonth(thinMonthBanner.requested)} doesn't have enough data yet — showing {fmtMonth(thinMonthBanner.fallback)} instead. This month will update automatically once collections reach $1,000.
            </div>
          )}
          {/* Month selector */}
          <div className="fin-month-row">
            <label htmlFor="fin-month">Earnings month</label>
            <select
              id="fin-month"
              className="filter-select"
              value={selectedMonth || ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'all' || (collectedByMonth[v] || 0) >= 1000) {
                  setThinMonthBanner(null);
                  setSelectedMonth(v);
                  return;
                }
                // User picked a thin month — show banner and fall back
                // to the most recent month with enough data.
                const fallback = months.find((m) => (collectedByMonth[m] || 0) >= 1000);
                if (fallback) {
                  setThinMonthBanner({ requested: v, fallback });
                  setSelectedMonth(fallback);
                } else {
                  setSelectedMonth(v);
                }
              }}
            >
              {months.map((m) => (
                <option key={m} value={m}>{fmtMonth(m)}</option>
              ))}
              <option value="all">All time</option>
            </select>
            <label htmlFor="fin-metro" style={{ marginLeft: '0.75rem' }}>Metro</label>
            <select
              id="fin-metro"
              className="filter-select"
              value={metroFilter}
              onChange={(e) => setMetroFilter(e.target.value)}
            >
              <option value="all">All metros</option>
              {metroOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button
              type="button"
              className="btn-secondary-sm fin-download-btn"
              onClick={() => setShowDownloadModal(true)}
            >
              Download monthly report
            </button>
          </div>

          {/* Portfolio overview — 4 cards: Host earnings, Platform fees,
              Portfolio occupancy, Turnovers. */}
          <section className="fin-section">
            <div className="fin-metric-row fin-metric-row-4">
              <div className="fin-metric-card">
                <div className="fin-metric-label">Host earnings</div>
                <div className="fin-metric-value fin-metric-value-sage">{fmtMoney(totals?.hostEarnings)}</div>
                <TrendArrow delta={trends?.hostEarnings} />
              </div>
              <div className="fin-metric-card">
                <div className="fin-metric-label">Platform fees</div>
                <div className="fin-metric-value">{fmtMoney(totals?.platformFees)}</div>
                <TrendArrow delta={trends?.fees} invert />
              </div>
              <div className="fin-metric-card">
                <div className="fin-metric-label">Portfolio occupancy</div>
                <div className="fin-metric-value">
                  {totals?.occupancy != null ? `${totals.occupancy.toFixed(1)}%` : '—'}
                </div>
                {totals?.vacantDays != null && (
                  <div className="fin-metric-sub">
                    {totals.vacantDays} {totals.vacantDays === 1 ? 'day' : 'days'} vacant
                  </div>
                )}
                <TrendArrow delta={trends?.occupancy} />
              </div>
              <div className="fin-metric-card">
                <div className="fin-metric-label">Turnovers</div>
                <div className="fin-metric-value">{totals?.turnovers ?? 0}</div>
                <TrendArrow delta={trends?.turnovers} invert />
              </div>
            </div>
          </section>

          {/* Portfolio chart */}
          <section className="fin-section">
            <div className="fin-section-head">
              <h2 className="fin-section-title">Portfolio over time</h2>
              <div className="fin-toggle-row">
                {CHART_METRIC_ORDER.map((key) => (
                  <button
                    key={key}
                    className={`fin-toggle ${chartMetric === key ? 'fin-toggle-active' : ''}`}
                    onClick={() => setChartMetric(key)}
                  >{CHART_METRICS[key].label}</button>
                ))}
              </div>
            </div>
            <div className="fin-timeline-row">
              {[
                { v: '1m', l: '1M' },
                { v: '3m', l: '3M' },
                { v: '6m', l: '6M' },
                { v: '12m', l: '12M' },
                { v: 'ytd', l: 'YTD' },
                { v: 'all', l: 'All time' },
                { v: 'custom', l: 'Custom' },
              ].map((opt) => (
                <button
                  key={opt.v}
                  className={`fin-timeline-pill ${chartTimeline === opt.v ? 'fin-timeline-active' : ''}`}
                  onClick={() => setChartTimeline(opt.v)}
                  type="button"
                >{opt.l}</button>
              ))}
              {chartTimeline === 'custom' && (
                <span className="fin-timeline-custom">
                  <input
                    type="month"
                    className="fin-timeline-input"
                    value={customRange.from}
                    onChange={(e) => setCustomRange((r) => ({ ...r, from: e.target.value }))}
                    placeholder="From"
                  />
                  <span className="fin-timeline-dash">–</span>
                  <input
                    type="month"
                    className="fin-timeline-input"
                    value={customRange.to}
                    onChange={(e) => setCustomRange((r) => ({ ...r, to: e.target.value }))}
                    placeholder="To"
                  />
                </span>
              )}
            </div>
            <div className="fin-chart">
              {chartData.length === 0 ? (
                <div className="fin-empty">No data to chart yet.</div>
              ) : (() => {
                const cfg = CHART_METRICS[chartMetric] || CHART_METRICS.host;
                const ChartCmp = cfg.kind === 'bar' ? BarChart : LineChart;
                const allSeries = (timeseries?.series || []).filter(
                  (s) => metroFilter === 'all' || (s.metroArea || '') === metroFilter,
                );

                // Click handler — toggle a series; never let the user
                // hide the last visible one.
                const toggleSeries = (name) => {
                  setHiddenSeries((prev) => {
                    const next = new Set(prev);
                    if (next.has(name)) {
                      next.delete(name);
                    } else {
                      const visibleCount = allSeries.length - next.size;
                      if (visibleCount <= 1) return prev; // would hide last
                      next.add(name);
                    }
                    return next;
                  });
                };

                const renderLegend = () => (
                  <ul className="fin-chart-legend">
                    {cfg.aggregate ? (
                      <li className="fin-chart-legend-item">
                        <span className="fin-chart-legend-dot" style={{ background: '#6B8F71' }} />
                        <span>Total</span>
                      </li>
                    ) : allSeries.map((s, idx) => {
                      const color = PALETTE[idx % PALETTE.length];
                      const hidden = hiddenSeries.has(s.propertyName);
                      return (
                        <li
                          key={s.propertyId || s.propertyName}
                          className={`fin-chart-legend-item ${hidden ? 'fin-chart-legend-hidden' : ''}`}
                          onClick={() => toggleSeries(s.propertyName)}
                          title={hidden ? 'Click to show' : 'Click to hide'}
                        >
                          <span className="fin-chart-legend-dot" style={{ background: color }} />
                          <span>{s.propertyName}</span>
                        </li>
                      );
                    })}
                  </ul>
                );

                return (
                  <ResponsiveContainer width="100%" height={320}>
                    <ChartCmp data={chartData} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
                      <CartesianGrid stroke="#F0EDE8" />
                      <XAxis
                        dataKey="month"
                        tickFormatter={fmtMonthShort}
                        stroke="#8A8580"
                      />
                      <YAxis
                        tickFormatter={cfg.yFmt}
                        domain={cfg.yDomain || [0, 'auto']}
                        allowDecimals={cfg.yAllowDecimals !== false}
                        stroke="#8A8580"
                      />
                      <Tooltip
                        formatter={(val) => cfg.valFmt(val)}
                        labelFormatter={(m) => fmtMonth(m)}
                        contentStyle={{ background: '#fff', border: '1px solid #F0EDE8', borderRadius: 8 }}
                      />
                      <Legend content={renderLegend} />
                      {cfg.aggregate ? (
                        <Line
                          key="Total"
                          type="monotone"
                          dataKey="Total"
                          stroke="#6B8F71"
                          strokeWidth={2}
                          dot={{ r: 3, fill: '#6B8F71' }}
                          activeDot={{ r: 5 }}
                          connectNulls
                        />
                      ) : allSeries.map((s, idx) => {
                        if (hiddenSeries.has(s.propertyName)) return null;
                        const color = PALETTE[idx % PALETTE.length];
                        return cfg.kind === 'bar' ? (
                          <Bar key={s.propertyId || s.propertyName} dataKey={s.propertyName} fill={color} />
                        ) : (
                          <Line
                            key={s.propertyId || s.propertyName}
                            type="monotone"
                            dataKey={s.propertyName}
                            stroke={color}
                            strokeWidth={idx === 0 ? 3 : 2}
                            dot={{ r: 3 }}
                            activeDot={{ r: 5 }}
                            connectNulls
                          />
                        );
                      })}
                    </ChartCmp>
                  </ResponsiveContainer>
                );
              })()}
            </div>
          </section>

          {/* Property breakdown */}
          <section className="fin-section">
            <h2 className="fin-section-title">Property breakdown</h2>
            <div className="fin-prop-list">
              {propertyBreakdown.length === 0 ? (
                <div className="fin-empty">No matched properties for this month.</div>
              ) : (
                propertyBreakdown.map((p) => (
                  <PropertyCard
                    key={p.propertyId}
                    p={p}
                    expanded={!!expandedProps[p.propertyId]}
                    onToggle={() => togglePropExpand(p.propertyId)}
                    onRoomClick={(room) => setRoomDetail({ property: p, room })}
                  />
                ))
              )}
            </div>
          </section>

          {/* Turnover tracker */}
          <section className="fin-section">
            <h2 className="fin-section-title">Turnover tracker</h2>
            <TurnoverTracker rows={dashboard?.turnoverTracker || []} />
          </section>

          {/* Upload history — bottom of page */}
          {uploads.length > 0 && (
            <section className="fin-section">
              <div className="fin-uploads-head">
                <h2 className="fin-section-title">Upload history</h2>
                <button
                  type="button"
                  className="btn-text-sm fin-reset-btn"
                  onClick={handleReset}
                  disabled={resetting}
                >
                  {resetting ? 'Resetting…' : 'Reset all financial data'}
                </button>
              </div>
              <ul className="fin-upload-list">
                {uploads.map((u) => (
                  <li key={u.id} className="fin-upload-row">
                    <span className="fin-upload-month">{fmtMonth(u.earningsMonth)}</span>
                    <span className="fin-upload-meta">
                      {u._count?.records || 0} rows · uploaded {new Date(u.uploadedAt).toLocaleDateString()}
                    </span>
                    <button
                      type="button"
                      className="fin-remove-btn"
                      onClick={() => handleDeleteMonth(u.earningsMonth)}
                      title={`Remove ${fmtMonth(u.earningsMonth)} data`}
                    >Remove</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* Room month-over-month modal */}
      <Modal
        open={!!roomDetail}
        onClose={() => setRoomDetail(null)}
        title={roomDetail
          ? `Room ${roomDetail.room.roomNumber} — ${roomDetail.property.propertyName}`
          : ''}
      >
        {roomDetail && (
          <RoomHistory
            propertyId={roomDetail.property.propertyId}
            roomNumber={roomDetail.room.roomNumber}
            timeseries={timeseries}
            months={months}
          />
        )}
      </Modal>

      {/* Manual mapping modal */}
      <Modal
        open={showMappingModal}
        onClose={() => setShowMappingModal(false)}
        title="Match PadSplit addresses"
      >
        <MappingForm
          unmatched={mappings.unmatched || []}
          properties={allProperties}
          onSaved={async () => {
            const m = await api('/api/financials/mappings');
            setMappings(m);
            await loadDashboard();
          }}
          onClose={() => setShowMappingModal(false)}
        />
      </Modal>

      <Modal
        open={showDownloadModal}
        onClose={() => setShowDownloadModal(false)}
        title="Download monthly report"
      >
        <DownloadReportBody
          months={months}
          properties={dashboard?.propertyBreakdown || []}
          defaultMonth={selectedMonth}
          onClose={() => setShowDownloadModal(false)}
        />
      </Modal>
    </div>
  );
}

// Annualized turnover threshold: 4+ per year flags as a "Problem" room.
const PROBLEM_TURNOVER_RATE = 4;
// Minimum months of data required to trust an annualized rate. Below
// this, we still display the rate but mark it "(limited data)" and
// don't apply the Problem badge — extrapolating 1 turnover over 2
// months as 6/yr is alarming but meaningless.
const MIN_MONTHS_FOR_PROBLEM = 6;

function TurnoverTracker({ rows }) {
  const [showAll, setShowAll] = useState(false);
  if (!rows || rows.length === 0) {
    return <div className="fin-empty fin-tt-empty">No turnover data yet.</div>;
  }
  // Total problem rooms across the portfolio — used to decide whether
  // the collapsed view should show "No problem rooms" instead of a
  // bunch of empty property tables.
  const totalProblemRooms = rows.filter(
    (r) => (r.annualizedTurnovers || 0) >= PROBLEM_TURNOVER_RATE && r.monthsOfData >= MIN_MONTHS_FOR_PROBLEM,
  ).length;

  // Group by property; sort properties by problem-room count desc
  // (then alphabetically). Within each property, rooms with turnovers
  // sort by annualized rate desc, and 0-turnover rooms sink to the
  // bottom sorted by room number.
  const groups = {};
  for (const r of rows) {
    const name = r.propertyName || '—';
    if (!groups[name]) groups[name] = [];
    groups[name].push(r);
  }
  const propertyMonthsByName = {};
  const problemCountByName = {};
  for (const name of Object.keys(groups)) {
    const propertyRows = groups[name];
    const propertyMonthsOfData = propertyRows.reduce(
      (m, r) => Math.max(m, r.monthsOfData || 0), 0,
    );
    propertyMonthsByName[name] = propertyMonthsOfData;
    const limitedData = propertyMonthsOfData < MIN_MONTHS_FOR_PROBLEM;
    let problemCount = 0;
    if (!limitedData) {
      for (const r of propertyRows) {
        if ((r.annualizedTurnovers || 0) >= PROBLEM_TURNOVER_RATE) problemCount += 1;
      }
    }
    problemCountByName[name] = problemCount;

    propertyRows.sort((a, b) => {
      const aZero = (a.turnovers || 0) === 0;
      const bZero = (b.turnovers || 0) === 0;
      if (aZero !== bZero) return aZero ? 1 : -1; // 0-turnover rooms sink
      if (!aZero) {
        const dr = (b.annualizedTurnovers || 0) - (a.annualizedTurnovers || 0);
        if (dr !== 0) return dr;
      }
      const an = String(a.roomNumber || '');
      const bn = String(b.roomNumber || '');
      const numCmp = parseInt(an, 10) - parseInt(bn, 10);
      if (!isNaN(numCmp) && numCmp !== 0) return numCmp;
      return an.localeCompare(bn);
    });
  }
  const propertyNames = Object.keys(groups).sort((a, b) => {
    const pc = (problemCountByName[b] || 0) - (problemCountByName[a] || 0);
    if (pc !== 0) return pc;
    return a.localeCompare(b);
  });

  return (
    <div className="fin-tt">
      {propertyNames.map((name) => {
        const propertyRows = groups[name];
        const totalTurnovers = propertyRows.reduce((s, r) => s + (r.turnovers || 0), 0);
        const limitedData = (propertyMonthsByName[name] || 0) < MIN_MONTHS_FOR_PROBLEM;
        const hasProblemRows = propertyRows.some(
          (r) => (r.annualizedTurnovers || 0) >= PROBLEM_TURNOVER_RATE && !limitedData,
        );
        // In collapsed mode, hide property cards that have no problem
        // rooms so the page doesn't stack a bunch of empty tables.
        if (!showAll && !hasProblemRows) return null;
        return (
          <div key={name} className="fin-tt-group">
            <h3 className="fin-tt-property">{name}</h3>
            {totalTurnovers === 0 ? (
              <div className="fin-tt-none">No turnovers</div>
            ) : (
              <div className="fin-table-wrap">
                <table className="fin-table fin-tt-table">
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Turnovers</th>
                      <th>
                        <span className="hide-mobile">Annualized rate</span>
                        <span className="show-mobile">Ann. rate</span>
                      </th>
                      <th>
                        <span className="hide-mobile">Avg tenure (months)</span>
                        <span className="show-mobile">Avg ten.</span>
                      </th>
                      <th>Turnover cost</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {propertyRows.map((r) => {
                      const annualized = r.annualizedTurnovers || 0;
                      const isProblem = !limitedData && annualized >= PROBLEM_TURNOVER_RATE;
                      // Default view shows only problem rooms; toggle
                      // expands to every room in the property.
                      if (!showAll && !isProblem) return null;
                      const annCost = r.annualizedTurnoverCost || 0;
                      const costClass = annCost > 1000
                        ? 'fin-tt-cost-bad'
                        : annCost >= 500
                          ? 'fin-tt-cost-warn'
                          : 'fin-tt-cost-good';
                      return (
                        <tr key={`${name}-${r.roomNumber}`}
                            className={isProblem ? 'fin-tt-problem' : ''}>
                          <td>{r.roomNumber || '—'}</td>
                          <td>{r.turnovers}</td>
                          <td className={limitedData ? 'fin-tt-limited' : ''}>
                            {annualized.toFixed(1)} / yr
                            {limitedData && <span className="fin-tt-limited-tag"> (limited data)</span>}
                          </td>
                          <td>{(r.avgTenureMonths || 0).toFixed(1)}</td>
                          <td className={r.turnovers > 0 ? costClass : ''}>
                            {r.turnovers > 0 ? (
                              <>
                                <div>{fmtMoney(r.turnoverCostTotal)}</div>
                                <small className="fin-tt-cost-sub">{fmtMoney(annCost)} / yr</small>
                              </>
                            ) : '—'}
                          </td>
                          <td>{isProblem ? <span className="fin-pill-bad">Problem</span> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      {/* Collapsed-mode helper — green note when no problem rooms, plus
          the show-all / hide-non-problem toggle. */}
      {!showAll && totalProblemRooms === 0 && (
        <div className="fin-tt-good">No problem rooms — all turnover rates are healthy</div>
      )}
      <div className="fin-tt-toggle-row">
        <button
          type="button"
          className="btn-text-sm"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Hide non-problem rooms ▴' : 'Show all rooms ▾'}
        </button>
      </div>
    </div>
  );
}

function DownloadReportBody({ months, properties, defaultMonth, onClose }) {
  const [month, setMonth] = useState(defaultMonth || (months[0] || ''));
  const [allChecked, setAllChecked] = useState(true);
  const [propIds, setPropIds] = useState(() => new Set(properties.map((p) => p.propertyId).filter(Boolean)));

  const togglePid = (id) => {
    setAllChecked(false);
    setPropIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    if (allChecked) {
      setAllChecked(false);
      setPropIds(new Set());
    } else {
      setAllChecked(true);
      setPropIds(new Set(properties.map((p) => p.propertyId).filter(Boolean)));
    }
  };

  const handleDownload = () => {
    const params = new URLSearchParams();
    if (month && month !== 'all') {
      params.set('from', month);
      params.set('to', month);
    }
    if (!allChecked && propIds.size > 0) {
      params.set('propertyIds', [...propIds].join(','));
    }
    const url = `/api/financials/report.pdf?${params.toString()}`;
    window.open(url, '_blank');
    onClose();
  };

  return (
    <div className="modal-form" style={{ padding: '1rem 1.25rem 1.25rem' }}>
      <label className="form-label">
        Month
        <select
          className="filter-select"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ width: '100%', marginTop: '0.25rem' }}
        >
          {months.map((m) => (<option key={m} value={m}>{fmtMonth(m)}</option>))}
          <option value="all">All time</option>
        </select>
      </label>
      <div style={{ marginTop: '1rem' }}>
        <strong>Properties</strong>
        <div className="dl-prop-list">
          <label className="dl-prop-item">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            <span>All properties</span>
          </label>
          {properties.map((p) => (
            <label key={p.propertyId || p.padsplitAddress} className="dl-prop-item">
              <input
                type="checkbox"
                checked={allChecked || propIds.has(p.propertyId)}
                onChange={() => p.propertyId && togglePid(p.propertyId)}
                disabled={!p.propertyId}
              />
              <span>{p.propertyName || p.padsplitAddress}</span>
            </label>
          ))}
        </div>
      </div>
      <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button
          className="btn-primary"
          onClick={handleDownload}
          disabled={!allChecked && propIds.size === 0}
        >
          Download
        </button>
      </div>
    </div>
  );
}

function MappingForm({ unmatched, properties, onSaved, onClose }) {
  const [picks, setPicks] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setErr('');
    try {
      for (const u of unmatched) {
        const propertyId = picks[u.normalized];
        if (!propertyId) continue;
        await api('/api/financials/mappings', {
          method: 'POST',
          body: JSON.stringify({ padsplitAddress: u.normalized, propertyId }),
        });
      }
      await onSaved();
      onClose();
    } catch (e) {
      setErr(e.message || 'Failed to save mappings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-form">
      <p className="page-subtitle">
        Pick which RoomReport property each PadSplit address belongs to.
      </p>
      {unmatched.map((u) => (
        <label key={u.normalized}>
          {u.raw}
          <select
            className="maint-input"
            value={picks[u.normalized] || ''}
            onChange={(e) => setPicks({ ...picks, [u.normalized]: e.target.value })}
          >
            <option value="">Choose property…</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      ))}
      {err && <div className="auth-error">{err}</div>}
      <div className="modal-actions">
        <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save mappings'}
        </button>
      </div>
    </div>
  );
}

function RoomHistory({ propertyId, roomNumber, timeseries, months }) {
  // Pull this room's monthly history out of records via the dashboard API
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const allRows = [];
      for (const m of months) {
        try {
          const dash = await api(`/api/financials/dashboard?month=${encodeURIComponent(m)}`);
          const prop = dash.propertyBreakdown.find((x) => x.propertyId === propertyId);
          if (!prop) continue;
          const room = prop.rooms.find((r) => r.roomNumber === roomNumber);
          if (!room) continue;
          allRows.push({ month: m, ...room });
        } catch { /* ignore */ }
      }
      if (!cancelled) setRows(allRows);
    })();
    return () => { cancelled = true; };
  }, [propertyId, roomNumber, months]);

  if (!rows) return <p>Loading history…</p>;
  if (rows.length === 0) return <p>No history for this room yet.</p>;
  return (
    <div className="fin-table-wrap">
      <table className="fin-table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Resident</th>
            <th>Collected</th>
            <th>Host earn</th>
            <th>Maint</th>
            <th>Net P&L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <td>{fmtMonth(r.month)}</td>
              <td>{r.residentName || '—'}</td>
              <td>{fmtMoney(r.gross)}</td>
              <td>{fmtMoney(r.hostEarnings)}</td>
              <td>{fmtMoney(r.maintenanceCost)}</td>
              <td className={r.netPL >= 0 ? 'fin-pl fin-pl-good' : 'fin-pl fin-pl-bad'}>
                {fmtMoney(r.netPL)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
