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
const CHART_METRICS = {
  host:        { label: 'Host earnings',   key: 'host',        kind: 'line', yFmt: (v) => `$${(v / 1000).toFixed(0)}k`, valFmt: (v) => fmtMoney(v) },
  gross:       { label: 'Gross collected', key: 'gross',       kind: 'line', yFmt: (v) => `$${(v / 1000).toFixed(0)}k`, valFmt: (v) => fmtMoney(v) },
  fees:        { label: 'Platform fees',   key: 'fees',        kind: 'line', yFmt: (v) => `$${(v / 1000).toFixed(0)}k`, valFmt: (v) => fmtMoney(v) },
  occupancy:   { label: 'Occupancy %',     key: 'occupancy',   kind: 'line', yFmt: (v) => `${v}%`, yDomain: [0, 100],     valFmt: (v) => `${v}%` },
  turnovers:   { label: 'Turnovers',       key: 'turnovers',   kind: 'bar',  yFmt: (v) => `${v}`, yAllowDecimals: false,  valFmt: (v) => `${v}` },
  onboarded:   { label: 'Rooms onboarded', key: 'onboarded',   kind: 'line', yFmt: (v) => `${v}`, yAllowDecimals: false,  valFmt: (v) => `${v}` },
  maintenance: { label: 'Maintenance costs', key: 'maintenance', kind: 'line', yFmt: (v) => `$${(v / 1000).toFixed(0)}k`, valFmt: (v) => fmtMoney(v) },
};
const CHART_METRIC_ORDER = ['host', 'gross', 'fees', 'occupancy', 'turnovers', 'onboarded', 'maintenance'];

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
          <div className="fin-prop-stat-grid">
            <div className="fin-prop-stat"><label>Booking fees</label><span>{fmtMoney(p.bookingFee)}</span></div>
            <div className="fin-prop-stat"><label>Service fees (8%)</label><span>{fmtMoney(p.serviceFee)}</span></div>
            <div className="fin-prop-stat"><label>Transaction fees</label><span>{fmtMoney(p.transactionFee)}</span></div>
            <div className="fin-prop-stat"><label>Net host earnings</label><span>{fmtMoney(p.hostEarnings)}</span></div>
            <div className="fin-prop-stat">
              <label>Vacancy</label>
              <span>{fmtMoney(p.vacancy)}</span>
              <small className="fin-prop-stat-sub">
                {p.vacantDays} {p.vacantDays === 1 ? 'day' : 'days'} vacant
              </small>
            </div>
            <div className="fin-prop-stat"><label>Late fees collected</label><span>{fmtMoney(p.lateFees)}</span></div>
            <div className="fin-prop-stat"><label>Avg rent / room</label><span>{fmtMoney(p.avgRentPerRoom)}</span></div>
            <div className="fin-prop-stat"><label>Turnovers this month</label><span>{p.turnoversThisMonth}</span></div>
            <div className="fin-prop-stat"><label>Maintenance cost</label><span>{fmtMoney(p.maintenanceCost)}</span></div>
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
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [timeseries, setTimeseries] = useState(null);
  const [chartMetric, setChartMetric] = useState('host');
  const [hiddenSeries, setHiddenSeries] = useState(() => new Set());
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
      setMonths(monthList);
      setAllProperties(propsRes.properties || []);
      if (monthList.length > 0) {
        setSelectedMonth((m) => m || monthList[0]);
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

  const togglePropExpand = (id) => {
    setExpandedProps((s) => ({ ...s, [id]: !s[id] }));
  };

  const chartData = useMemo(() => {
    if (!timeseries || !timeseries.months || timeseries.months.length === 0) return [];
    const cfg = CHART_METRICS[chartMetric] || CHART_METRICS.host;
    return timeseries.months.map((m) => {
      const obj = { month: m };
      for (const s of timeseries.series) {
        const pt = s.points.find((p) => p.month === m);
        const val = pt ? pt[cfg.key] : null;
        obj[s.propertyName] = val == null ? 0 : val;
      }
      return obj;
    });
  }, [timeseries, chartMetric]);

  if (loading) return <div className="page-loading">Loading…</div>;

  const totals = dashboard?.totals;
  const trends = dashboard?.trends;

  return (
    <div className="page-container fin-page">
      <div className="page-header">
        <div>
          <h1>Financials</h1>
          <p className="page-subtitle">PadSplit monthly performance across your portfolio</p>
        </div>
      </div>

      {/* Upload section */}
      <section className="fin-section">
        <UploadZone onUpload={handleUpload} busy={uploadBusy} error={uploadError} />

        {uploadInfo && <div className="fin-info-banner">{uploadInfo}</div>}

        {uploads.length > 0 && (
          <div className="fin-uploads">
            <div className="fin-uploads-head">
              <h3 className="md-section-title">Upload history</h3>
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
                </li>
              ))}
            </ul>
          </div>
        )}

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
          {/* Month selector */}
          <div className="fin-month-row">
            <label htmlFor="fin-month">Earnings month</label>
            <select
              id="fin-month"
              className="filter-select"
              value={selectedMonth || ''}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {months.map((m) => (
                <option key={m} value={m}>{fmtMonth(m)}</option>
              ))}
              <option value="all">All time</option>
            </select>
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
            <div className="fin-chart">
              {chartData.length === 0 ? (
                <div className="fin-empty">No data to chart yet.</div>
              ) : (() => {
                const cfg = CHART_METRICS[chartMetric] || CHART_METRICS.host;
                const ChartCmp = cfg.kind === 'bar' ? BarChart : LineChart;
                const allSeries = timeseries?.series || [];

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
                    {allSeries.map((s, idx) => {
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
                      {allSeries.map((s, idx) => {
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
              {(dashboard?.propertyBreakdown || []).length === 0 ? (
                <div className="fin-empty">No matched properties for this month.</div>
              ) : (
                (dashboard?.propertyBreakdown || []).map((p) => (
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
  if (!rows || rows.length === 0) {
    return <div className="fin-empty fin-tt-empty">No turnover data yet.</div>;
  }

  // Group by property; sort properties alphabetically; within each
  // property sort rooms by annualized turnover rate (desc) then room
  // number for stable ordering.
  const groups = {};
  for (const r of rows) {
    const name = r.propertyName || '—';
    if (!groups[name]) groups[name] = [];
    groups[name].push(r);
  }
  for (const name of Object.keys(groups)) {
    groups[name].sort((a, b) => {
      const dr = (b.annualizedTurnovers || 0) - (a.annualizedTurnovers || 0);
      if (dr !== 0) return dr;
      const an = String(a.roomNumber || '');
      const bn = String(b.roomNumber || '');
      const numCmp = parseInt(an, 10) - parseInt(bn, 10);
      if (!isNaN(numCmp) && numCmp !== 0) return numCmp;
      return an.localeCompare(bn);
    });
  }
  const propertyNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));

  return (
    <div className="fin-tt">
      {propertyNames.map((name) => {
        const propertyRows = groups[name];
        const totalTurnovers = propertyRows.reduce((s, r) => s + (r.turnovers || 0), 0);
        // Use the property's longest-running room as the property's data span.
        const propertyMonthsOfData = propertyRows.reduce(
          (m, r) => Math.max(m, r.monthsOfData || 0), 0,
        );
        const limitedData = propertyMonthsOfData < MIN_MONTHS_FOR_PROBLEM;
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
                      <th>Annualized rate</th>
                      <th>Avg tenure (months)</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {propertyRows.map((r) => {
                      const annualized = r.annualizedTurnovers || 0;
                      // Only flag Problem when the annualized rate is
                      // actually meaningful — at least 6 months of data.
                      const isProblem = !limitedData && annualized >= PROBLEM_TURNOVER_RATE;
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
