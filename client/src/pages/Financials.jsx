import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import {
  ResponsiveContainer,
  LineChart,
  Line,
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

function parseRows(kind, rows) {
  const out = [];
  if (kind === 'summary') {
    for (const r of rows) {
      const month = rowGet(r, 'Earnings Month');
      out.push({
        recordType: 'SUMMARY',
        earningsMonth: month,
        propertyPSID: rowGet(r, 'PSID'),
        propertyAddress: rowGet(r, 'Address'),
        grossAmount: num(rowGet(r, 'Gross Collected')),
        bookingFee: num(rowGet(r, 'Booking Fees Amount', 'Booking Fee Amount')),
        hostEarnings: num(rowGet(r, 'Host Earnings')),
        serviceFee: num(rowGet(r, 'Service Fee Amount', 'Service Fees Amount')),
        transactionFee: num(rowGet(r, 'Transaction Fee Amount', 'Transaction Fees Amount')),
      });
    }
  } else if (kind === 'collected') {
    for (const r of rows) {
      out.push({
        recordType: 'COLLECTED',
        roomNumber: rowGet(r, 'Room Number'),
        roomId: rowGet(r, 'Room ID'),
        memberId: rowGet(r, 'Member ID'),
        memberName: rowGet(r, 'Member Name', 'Resident Name', 'Member'),
        billType: rowGet(r, 'Bill Type'),
        propertyAddress: rowGet(r, 'Address', 'Property Address'),
        propertyPSID: rowGet(r, 'PSID'),
        grossAmount: num(rowGet(r, 'Gross Collected')),
        bookingFee: num(rowGet(r, 'Booking Fee Amount', 'Booking Fees Amount')),
        serviceFee: num(rowGet(r, 'Service Fee Amount', 'Service Fees Amount')),
        transactionFee: num(rowGet(r, 'Transaction Fee Amount', 'Transaction Fees Amount')),
        hostEarnings: num(rowGet(r, 'Host Earnings')),
        category: rowGet(r, 'Category'),
      });
    }
  } else if (kind === 'billed') {
    for (const r of rows) {
      out.push({
        recordType: 'BILLED',
        billId: rowGet(r, 'Bill ID'),
        transactionType: rowGet(r, 'Transaction Type'),
        transactionReason: rowGet(r, 'Transaction Reason'),
        billType: rowGet(r, 'Bill Type'),
        roomNumber: rowGet(r, 'Room Number'),
        roomId: rowGet(r, 'Room ID'),
        memberId: rowGet(r, 'Member ID'),
        memberName: rowGet(r, 'Member Name'),
        propertyAddress: rowGet(r, 'Address', 'Property Address'),
        propertyPSID: rowGet(r, 'PSID'),
        grossAmount: num(rowGet(r, 'Amount')),
      });
    }
  } else if (kind === 'earnings_table') {
    for (const r of rows) {
      out.push({
        recordType: 'EARNINGS_TABLE',
        rowType: rowGet(r, 'row_type'),
        earningsMonth: rowGet(r, 'month'),
        totalCollections: num(rowGet(r, 'total_collections')),
        totalExpenses: num(rowGet(r, 'total_expenses')),
        totalPayout: num(rowGet(r, 'total_payout')),
      });
    }
  }
  return out;
}

function parseFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const headers = result.meta.fields || [];
        const kind = detectKind(headers);
        if (kind === 'unknown') {
          reject(new Error(`Could not identify ${file.name}. Headers: ${headers.slice(0, 5).join(', ')}`));
          return;
        }
        resolve({ kind, fileName: file.name, rows: parseRows(kind, result.data) });
      },
      error: (err) => reject(err),
    });
  });
}

function deriveMonth(parsedSets) {
  for (const set of parsedSets) {
    for (const r of set.rows) {
      if (r.earningsMonth) {
        // accept "YYYY-MM-DD" or "YYYY-MM"
        const m = String(r.earningsMonth).match(/^(\d{4})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}`;
      }
    }
  }
  return null;
}

// ─── Trend arrow ────────────────────────────────────────

function TrendArrow({ delta, invert = false }) {
  if (delta == null) return null;
  if (delta === 0) {
    return <span className="fin-trend fin-trend-flat">±0%</span>;
  }
  const positive = delta > 0;
  // For "fees" + "uncollected", down = good. For revenue, up = good.
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
    const sorted = [...p.rooms];
    sorted.sort((a, b) => {
      const av = a[sortBy] ?? '';
      const bv = b[sortBy] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const r = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? r : -r;
    });
    return sorted;
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
            <strong>{p.collectionRate != null ? `${p.collectionRate.toFixed(1)}%` : '—'}</strong>
            <br /><small>Collection</small>
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
            <div className="fin-prop-stat"><label>Uncollected rent</label><span>{fmtMoney(p.uncollectedRent)}</span></div>
            <div className="fin-prop-stat"><label>Late fees collected</label><span>{fmtMoney(p.lateFees)}</span></div>
            <div className="fin-prop-stat"><label>Vacancy cost (est.)</label><span>{fmtMoney(p.vacancyCost)}</span></div>
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
                  {headerCell('bookingFee', 'Booking')}
                  {headerCell('serviceFee', 'Service')}
                  {headerCell('transactionFee', 'Txn fee')}
                  {headerCell('hostEarnings', 'Host earn')}
                  {headerCell('billed', 'Billed')}
                  {headerCell('uncollected', 'Uncollected')}
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
                      <td>{fmtMoney(r.bookingFee)}</td>
                      <td>{fmtMoney(r.serviceFee)}</td>
                      <td>{fmtMoney(r.transactionFee)}</td>
                      <td>{fmtMoney(r.hostEarnings)}</td>
                      <td>{fmtMoney(r.billed)}</td>
                      <td>{fmtMoney(r.uncollected)}</td>
                      <td>{r.turnover ? <span className="fin-turn-yes">Yes</span> : '—'}</td>
                      <td>{fmtMoney(r.maintenanceCost)}</td>
                      <td className={`fin-pl fin-pl-${tone}`}>{fmtMoney(r.netPL)}</td>
                    </tr>
                  );
                })}
                {rooms.length === 0 && (
                  <tr><td colSpan="13" className="fin-empty">No room data for this month.</td></tr>
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
  const [expandedProps, setExpandedProps] = useState({});
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');
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
    try {
      // Parse all files client-side
      const parsedSets = [];
      for (const f of files) {
        const parsed = await parseFile(f);
        parsedSets.push(parsed);
      }
      // Determine month from data (or fallback to current)
      let month = deriveMonth(parsedSets);
      if (!month) {
        const now = new Date();
        month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      }
      // Stamp each row with the month and flatten
      const records = [];
      for (const set of parsedSets) {
        for (const row of set.rows) {
          if (!row.earningsMonth) row.earningsMonth = month;
          records.push(row);
        }
      }
      await api('/api/financials/upload', {
        method: 'POST',
        body: JSON.stringify({
          earningsMonth: month,
          fileNames: parsedSets.map((s) => s.fileName),
          records,
        }),
      });
      await loadAll();
      setSelectedMonth(month);
    } catch (err) {
      setUploadError(err.message || 'Upload failed');
    } finally {
      setUploadBusy(false);
    }
  };

  const togglePropExpand = (id) => {
    setExpandedProps((s) => ({ ...s, [id]: !s[id] }));
  };

  const chartData = useMemo(() => {
    if (!timeseries || !timeseries.months || timeseries.months.length === 0) return [];
    return timeseries.months.map((m) => {
      const obj = { month: m };
      for (const s of timeseries.series) {
        obj[s.propertyName] = s.points.find((p) => p.month === m)?.[chartMetric] || 0;
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

        {uploads.length > 0 && (
          <div className="fin-uploads">
            <h3 className="md-section-title">Upload history</h3>
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

          {/* Portfolio overview */}
          <section className="fin-section">
            <div className="fin-metric-row">
              <div className="fin-metric-card">
                <div className="fin-metric-label">Total Collected</div>
                <div className="fin-metric-value">{fmtMoney(totals?.collected)}</div>
                <TrendArrow delta={trends?.collected} />
              </div>
              <div className="fin-metric-card">
                <div className="fin-metric-label">Platform Fees</div>
                <div className="fin-metric-value">{fmtMoney(totals?.platformFees)}</div>
                <TrendArrow delta={trends?.fees} invert />
              </div>
              <div className="fin-metric-card">
                <div className="fin-metric-label">Host Earnings</div>
                <div className="fin-metric-value fin-metric-value-sage">{fmtMoney(totals?.hostEarnings)}</div>
                <TrendArrow delta={trends?.hostEarnings} />
              </div>
              <div className="fin-metric-card">
                <div className="fin-metric-label">Uncollected Rent</div>
                <div className="fin-metric-value fin-metric-value-terra">{fmtMoney(totals?.uncollected)}</div>
                <TrendArrow delta={trends?.uncollected} invert />
              </div>
            </div>
          </section>

          {/* Portfolio chart */}
          <section className="fin-section">
            <div className="fin-section-head">
              <h2 className="fin-section-title">Portfolio over time</h2>
              <div className="fin-toggle-row">
                <button
                  className={`fin-toggle ${chartMetric === 'host' ? 'fin-toggle-active' : ''}`}
                  onClick={() => setChartMetric('host')}
                >Host Earnings</button>
                <button
                  className={`fin-toggle ${chartMetric === 'gross' ? 'fin-toggle-active' : ''}`}
                  onClick={() => setChartMetric('gross')}
                >Gross Collected</button>
                <button
                  className={`fin-toggle ${chartMetric === 'fees' ? 'fin-toggle-active' : ''}`}
                  onClick={() => setChartMetric('fees')}
                >Platform Fees</button>
              </div>
            </div>
            <div className="fin-chart">
              {chartData.length === 0 ? (
                <div className="fin-empty">No data to chart yet.</div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="#F0EDE8" />
                    <XAxis dataKey="month" tickFormatter={(m) => m.slice(5)} stroke="#8A8580" />
                    <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} stroke="#8A8580" />
                    <Tooltip
                      formatter={(val) => fmtMoney(val)}
                      labelFormatter={(m) => fmtMonth(m)}
                      contentStyle={{ background: '#fff', border: '1px solid #F0EDE8', borderRadius: 8 }}
                    />
                    <Legend />
                    {(timeseries?.series || []).map((s, idx) => (
                      <Line
                        key={s.propertyId}
                        type="monotone"
                        dataKey={s.propertyName}
                        stroke={PALETTE[idx % PALETTE.length]}
                        strokeWidth={idx === 0 ? 3 : 2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
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
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Room</th>
                    <th>Turnovers</th>
                    <th>Members seen</th>
                    <th>Avg tenure (months)</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard?.turnoverTracker || []).length === 0 ? (
                    <tr><td colSpan="5" className="fin-empty">No turnover data yet.</td></tr>
                  ) : (
                    (dashboard?.turnoverTracker || []).map((t, i) => (
                      <tr key={i} className={t.turnovers >= 3 ? 'fin-row-warn' : ''}>
                        <td>{t.propertyName || '—'}</td>
                        <td>{t.roomNumber || '—'}</td>
                        <td>
                          {t.turnovers}
                          {t.turnovers >= 3 && <span className="fin-pill-bad"> problem</span>}
                        </td>
                        <td>{t.memberCount}</td>
                        <td>{t.avgTenureMonths.toFixed(1)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
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
