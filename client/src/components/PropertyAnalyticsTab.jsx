import { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, BarChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import PropertyHealthTab from './PropertyHealthTab';

const api = (path) =>
  fetch(path, { credentials: 'include' }).then(async (r) => {
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  });

const SAGE = '#6B8F71';
const TERRA = '#C4703F';

function fmtMoney(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}
function fmtMonthShort(m) {
  if (!m) return '';
  const [y, mn] = m.split('-');
  const d = new Date(Number(y), Number(mn) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short' }) + ` '${y.slice(2)}`;
}

const CHART_METRICS = [
  { key: 'host', label: 'Earnings', kind: 'line', color: SAGE, yFmt: fmtMoney },
  { key: 'collected', label: 'Collected', kind: 'line', color: SAGE, yFmt: fmtMoney },
  { key: 'avgRate', label: 'Avg room rate', kind: 'line', color: SAGE, yFmt: fmtMoney },
  { key: 'occupancy', label: 'Occupancy %', kind: 'line', color: SAGE, yFmt: (v) => `${v}%` },
  { key: 'turnovers', label: 'Turnovers', kind: 'bar', color: TERRA, yFmt: (v) => `${v}` },
  { key: 'maintenance', label: 'Maintenance cost', kind: 'line', color: TERRA, yFmt: fmtMoney },
];

// Window anchored on the LATEST month with data, not today's calendar
// month. If today is May 2026 and the most recent CSV upload covers
// April 2026, "1M" should show April; "3M" should show Feb–Apr.
function applyTimeline(months, timeline, custom) {
  if (!months || months.length === 0) return [];
  if (timeline === 'all') return months;
  if (timeline === 'custom') {
    const { from, to } = custom || {};
    if (!from && !to) return months;
    return months.filter((m) => (!from || m >= from) && (!to || m <= to));
  }
  const latest = months[months.length - 1];
  const [ly, lm] = latest.split('-').map(Number);
  if (timeline === 'ytd') {
    const start = `${ly}-01`;
    return months.filter((m) => m >= start && m <= latest);
  }
  const windowSize = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }[timeline] || 12;
  // Inclusive of the latest month: include (windowSize) months ending at latest.
  const startDate = new Date(Date.UTC(ly, lm - 1 - (windowSize - 1), 1));
  const startMonth = `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}`;
  return months.filter((m) => m >= startMonth && m <= latest);
}

export default function PropertyAnalyticsTab({ propertyId }) {
  const [series, setSeries] = useState(null);
  const [propFin, setPropFin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [timeline, setTimeline] = useState('all');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [chartMetric, setChartMetric] = useState('host');

  useEffect(() => {
    Promise.all([
      api('/api/financials/timeseries').catch(() => ({ months: [], series: [] })),
      api(`/api/financials/property/${propertyId}`).catch(() => ({ hasData: false })),
    ]).then(([ts, pf]) => {
      setSeries(ts);
      setPropFin(pf);
    }).finally(() => setLoading(false));
  }, [propertyId]);

  const propertySeries = useMemo(() => {
    if (!series?.series) return null;
    return series.series.find((s) => s.propertyId === propertyId) || null;
  }, [series, propertyId]);

  const filteredMonths = useMemo(
    () => applyTimeline(series?.months || [], timeline, customRange),
    [series, timeline, customRange],
  );

  const chartData = useMemo(() => {
    if (!propertySeries) return [];
    const cfg = CHART_METRICS.find((m) => m.key === chartMetric);
    return filteredMonths.map((m) => {
      const pt = propertySeries.points.find((p) => p.month === m);
      return { month: m, value: pt ? pt[cfg.key] || 0 : 0 };
    });
  }, [propertySeries, filteredMonths, chartMetric]);

  // Metric cards aggregated over the selected period.
  const periodTotals = useMemo(() => {
    if (!propertySeries) return null;
    const inRange = propertySeries.points.filter((p) => filteredMonths.includes(p.month));
    let collected = 0; let host = 0; let turnovers = 0;
    let occSum = 0; let occCount = 0;
    let rateSum = 0; let rateCount = 0;
    for (const p of inRange) {
      collected += p.collected || 0;
      host += p.host || 0;
      turnovers += p.turnovers || 0;
      if (p.occupancy != null) { occSum += p.occupancy; occCount += 1; }
      if (p.avgRate != null && p.avgRate > 0) { rateSum += p.avgRate; rateCount += 1; }
    }
    return {
      collected,
      host,
      turnovers,
      avgOccupancy: occCount > 0 ? occSum / occCount : null,
      avgRate: rateCount > 0 ? rateSum / rateCount : null,
    };
  }, [propertySeries, filteredMonths]);

  const cfg = CHART_METRICS.find((m) => m.key === chartMetric);
  const ChartCmp = cfg?.kind === 'bar' ? BarChart : LineChart;

  if (loading) return <div className="ph-loading">Loading analytics...</div>;

  return (
    <div className="ph-tab">
      {/* Timeline selector */}
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
            className={`fin-timeline-pill ${timeline === opt.v ? 'fin-timeline-active' : ''}`}
            onClick={() => setTimeline(opt.v)}
          >{opt.l}</button>
        ))}
        {timeline === 'custom' && (
          <span className="fin-timeline-custom">
            <input
              type="month"
              className="fin-timeline-input"
              value={customRange.from}
              onChange={(e) => setCustomRange((r) => ({ ...r, from: e.target.value }))}
            />
            <span className="fin-timeline-dash">–</span>
            <input
              type="month"
              className="fin-timeline-input"
              value={customRange.to}
              onChange={(e) => setCustomRange((r) => ({ ...r, to: e.target.value }))}
            />
          </span>
        )}
      </div>

      {/* Financial chart with metric toggle */}
      <h2 className="ph-section-title">Financial analytics</h2>
      <div className="ph-section">
        <div className="fin-toggle-row">
          {CHART_METRICS.map((m) => (
            <button
              key={m.key}
              className={`fin-toggle ${chartMetric === m.key ? 'fin-toggle-active' : ''}`}
              onClick={() => setChartMetric(m.key)}
            >{m.label}</button>
          ))}
        </div>
        {chartData.length === 0 ? (
          <p className="ph-empty">No financial data for this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ChartCmp data={chartData} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="#F0EDE8" />
              <XAxis dataKey="month" tickFormatter={fmtMonthShort} stroke="#8A8580" />
              <YAxis tickFormatter={cfg.yFmt} stroke="#8A8580" />
              <Tooltip formatter={(v) => cfg.yFmt(v)} labelFormatter={fmtMonthShort} />
              {cfg.kind === 'bar'
                ? <Bar dataKey="value" fill={cfg.color} barSize={40} radius={[4, 4, 0, 0]} />
                : <Line type="monotone" dataKey="value" stroke={cfg.color} strokeWidth={2} dot={{ r: 3 }} />}
            </ChartCmp>
          </ResponsiveContainer>
        )}
      </div>

      {/* Metric cards */}
      {periodTotals && (
        <div className="ph-card-row">
          <div className="ph-card">
            <div className="ph-card-label">Host earnings (period)</div>
            <div className="ph-card-value">{fmtMoney(periodTotals.host)}</div>
          </div>
          <div className="ph-card">
            <div className="ph-card-label">Avg occupancy</div>
            <div className="ph-card-value">
              {periodTotals.avgOccupancy != null ? `${periodTotals.avgOccupancy.toFixed(1)}%` : '—'}
            </div>
          </div>
          <div className="ph-card">
            <div className="ph-card-label">Avg room rate</div>
            <div className="ph-card-value">{fmtMoney(periodTotals.avgRate)}</div>
          </div>
          <div className="ph-card">
            <div className="ph-card-label">Total turnovers</div>
            <div className="ph-card-value">{periodTotals.turnovers}</div>
          </div>
        </div>
      )}

      {/* Maintenance + comparison + compliance sections */}
      <PropertyHealthTab
        propertyId={propertyId}
        timelineMonths={timeline === 'all' ? 'all' : filteredMonths}
      />
    </div>
  );
}
