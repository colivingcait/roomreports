import { useState, useEffect } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell,
} from 'recharts';

const api = (path) =>
  fetch(path, { credentials: 'include' }).then(async (r) => {
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  });

function fmtMoney(n) {
  if (n == null) return '—';
  return `$${Math.round(n).toLocaleString()}`;
}
function fmtDays(n) {
  if (n == null) return '—';
  return `${n.toFixed(1)} days`;
}
function fmtHours(n) {
  if (n == null) return '—';
  if (n >= 24) return `${(n / 24).toFixed(1)} days`;
  return `${n.toFixed(1)} hours`;
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function daysSince(d) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d)) / (24 * 60 * 60 * 1000));
}

function TrendArrow({ current, previous, lowerIsBetter = true }) {
  if (current == null || previous == null) return null;
  const delta = current - previous;
  if (Math.abs(delta) < 0.01) return null;
  const isBetter = lowerIsBetter ? delta < 0 : delta > 0;
  const arrow = delta < 0 ? '↓' : '↑';
  return (
    <span className={`ph-trend ${isBetter ? 'ph-trend-good' : 'ph-trend-bad'}`}>
      {arrow} {Math.abs(delta).toFixed(1)}
    </span>
  );
}

function HBarChart({ data }) {
  if (!data || data.length === 0) return <p className="ph-empty">No tickets yet.</p>;
  const height = Math.max(180, data.length * 44);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 32, bottom: 8, left: 12 }}
      >
        <CartesianGrid stroke="#F0EDE8" horizontal={false} />
        <XAxis type="number" allowDecimals={false} stroke="#8A8580" />
        <YAxis
          type="category"
          dataKey="category"
          stroke="#8A8580"
          width={120}
          tick={{ fontSize: 12 }}
        />
        <Tooltip cursor={{ fill: '#F5F3F0' }} />
        <Bar dataKey="count" barSize={28} radius={[0, 4, 4, 0]}>
          {data.map((d) => (
            <Cell
              key={d.category}
              fill={d.count >= 3 ? '#C4703F' : '#6B8F71'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Aggregate per-property breakdowns across N month payloads. Sums all
// $ totals + counts; averages rates that don't sum (occupancyRate).
function aggregateBreakdowns(payloads) {
  const out = {};
  for (const p of payloads) {
    for (const r of (p.propertyBreakdown || [])) {
      if (!out[r.propertyId]) {
        out[r.propertyId] = {
          propertyId: r.propertyId,
          propertyName: r.propertyName,
          metroArea: r.metroArea,
          roomCount: r.rooms?.length || 0,
          gross: 0,
          hostEarnings: 0,
          maintenanceCost: 0,
          turnoversThisMonth: 0,
          occSum: 0,
          occCount: 0,
        };
      }
      const acc = out[r.propertyId];
      acc.gross += r.gross || 0;
      acc.hostEarnings += r.hostEarnings || 0;
      acc.maintenanceCost += r.maintenanceCost || 0;
      acc.turnoversThisMonth += r.turnoversThisMonth || 0;
      if (r.occupancyRate != null) {
        acc.occSum += r.occupancyRate;
        acc.occCount += 1;
      }
    }
  }
  return Object.values(out).map((acc) => ({
    ...acc,
    occupancyRate: acc.occCount > 0 ? acc.occSum / acc.occCount : null,
  }));
}

function ComparisonTable({ propertyId, metroArea, timelineMonths }) {
  const [scope, setScope] = useState(metroArea ? 'metro' : 'all');
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!metroArea && scope === 'metro') setScope('all');
  }, [metroArea]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fetchAggregate = async () => {
      // No timeline (all time) → single fetch.
      if (!timelineMonths || timelineMonths === 'all') {
        const d = await api('/api/financials/dashboard?month=all').catch(() => null);
        if (!cancelled) setRows(d?.propertyBreakdown || []);
        return;
      }
      // Specific month list → fetch each and aggregate.
      const payloads = await Promise.all(
        timelineMonths.map((m) => api(`/api/financials/dashboard?month=${m}`).catch(() => null)),
      );
      if (!cancelled) setRows(aggregateBreakdowns(payloads.filter(Boolean)));
    };
    fetchAggregate().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [timelineMonths]);

  if (loading) return <div className="ph-loading">Loading comparison...</div>;
  if (!rows || rows.length === 0) {
    return <p className="ph-empty">Upload financial data to compare properties.</p>;
  }

  const filtered = scope === 'metro' && metroArea
    ? rows.filter((r) => (r.metroArea || '') === metroArea)
    : rows;
  const decorated = filtered.map((r) => {
    const rooms = (r.roomCount || r.rooms?.length || 0) || 1;
    return {
      ...r,
      roomCount: r.roomCount ?? (r.rooms?.length || 0),
      avgEarningsPerRoom: (r.hostEarnings || 0) / rooms,
      maintPerRoom: (r.maintenanceCost || 0) / rooms,
      netPLPerRoom: ((r.hostEarnings || 0) - (r.maintenanceCost || 0)) / rooms,
    };
  });
  decorated.sort((a, b) => b.netPLPerRoom - a.netPLPerRoom);

  return (
    <div>
      <div className="ph-toggle-row">
        <button
          className={`ph-toggle ${scope === 'metro' ? 'ph-toggle-active' : ''}`}
          onClick={() => metroArea && setScope('metro')}
          disabled={!metroArea}
        >
          Within {metroArea || 'metro'}
        </button>
        <button
          className={`ph-toggle ${scope === 'all' ? 'ph-toggle-active' : ''}`}
          onClick={() => setScope('all')}
        >
          All metros
        </button>
      </div>
      {!metroArea && (
        <p className="ph-note">Set a metro area in property settings for metro comparisons.</p>
      )}
      <div className="ph-table-wrap">
        <table className="ph-table">
          <thead>
            <tr>
              <th>Property</th>
              <th>Rooms</th>
              <th>Occupancy</th>
              <th>Avg earnings/room</th>
              <th>Maint cost/room</th>
              <th>Turnovers</th>
              <th>Net P&amp;L/room</th>
            </tr>
          </thead>
          <tbody>
            {decorated.map((r) => (
              <tr key={r.propertyId} className={r.propertyId === propertyId ? 'ph-row-current' : ''}>
                <td>{r.propertyName}</td>
                <td>{r.roomCount}</td>
                <td>{r.occupancyRate != null ? `${r.occupancyRate.toFixed(1)}%` : '—'}</td>
                <td>{fmtMoney(r.avgEarningsPerRoom)}</td>
                <td>{fmtMoney(r.maintPerRoom)}</td>
                <td>{r.turnoversThisMonth || 0}</td>
                <td>{fmtMoney(r.netPLPerRoom)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Two-row 12-month calendar of inspection compliance.
// Row 1: room (QUARTERLY) — expected every 3 months from the first
//        inspection (or Jan/Apr/Jul/Oct as a baseline).
// Row 2: common area — expected every month.
//
// Cell states:
//   completed (has inspection that month)         → sage filled with ✓
//   expected & overdue (past month, not done)     → red outline with !
//   expected future (month not happened yet)      → gray outline
//   not expected & past month                     → muted dot
function ComplianceCalendar({ items }) {
  const year = new Date().getFullYear();
  const nowMonth = new Date().getMonth(); // 0-11

  const monthHas = (type, monthIdx) => {
    return (items || []).some((it) => {
      const d = new Date(it.date);
      return d.getFullYear() === year && d.getMonth() === monthIdx && it.type === type;
    });
  };

  // Find first quarterly month so the cadence anchors to actual practice.
  const firstQuarterly = (items || [])
    .filter((it) => it.type === 'QUARTERLY')
    .map((it) => new Date(it.date))
    .filter((d) => d.getFullYear() === year)
    .sort((a, b) => a - b)[0];
  const quarterlyAnchor = firstQuarterly ? firstQuarterly.getMonth() : 0;

  const renderRow = (label, type) => {
    const cells = [];
    for (let m = 0; m < 12; m++) {
      const past = m < nowMonth;
      const current = m === nowMonth;
      const monthDate = new Date(year, m, 1);
      const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'short' });
      const isExpected = type === 'COMMON_AREA'
        ? true
        : ((m - quarterlyAnchor) % 3 + 3) % 3 === 0;
      const has = monthHas(type, m);

      let state = 'future';
      let icon = '';
      if (has) { state = 'done'; icon = '✓'; }
      else if (isExpected && past) { state = 'overdue'; icon = '!'; }
      else if (isExpected && current) { state = 'due'; icon = '•'; }
      else if (!isExpected && past) { state = 'skip'; icon = ''; }
      else { state = 'future'; icon = ''; }

      cells.push(
        <div key={m} className="ph-cal-cell">
          <div className={`ph-cal-dot ph-cal-dot-${state}`}>
            {icon}
          </div>
          <div className="ph-cal-label">{monthLabel}</div>
        </div>
      );
    }
    return (
      <div className="ph-cal-row">
        <div className="ph-cal-row-label">{label}</div>
        <div className="ph-cal-cells">{cells}</div>
      </div>
    );
  };

  return (
    <div className="ph-cal">
      {renderRow('Room inspections', 'QUARTERLY')}
      {renderRow('Common area', 'COMMON_AREA')}
    </div>
  );
}

function InspectionTimeline({ items }) {
  // Legacy 6-month dot row — kept for fallback if items is empty.
  if (!items || items.length === 0) return <p className="ph-empty">No inspections in the last 6 months.</p>;
  const now = new Date();
  const cells = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const matches = items.filter((it) => {
      const id = new Date(it.date);
      return id.getFullYear() === d.getFullYear() && id.getMonth() === d.getMonth();
    });
    cells.push({
      key,
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      count: matches.length,
      hasRoom: matches.some((m) => m.type === 'QUARTERLY'),
      hasCommon: matches.some((m) => m.type === 'COMMON_AREA'),
    });
  }
  return (
    <div className="ph-timeline">
      {cells.map((c) => (
        <div key={c.key} className="ph-timeline-cell">
          <div className={`ph-timeline-dot ${c.count > 0 ? 'ph-timeline-dot-on' : ''}`}>
            {c.count > 0 ? c.count : ''}
          </div>
          <div className="ph-timeline-label">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function PropertyHealthTab({ propertyId, timelineMonths }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api(`/api/properties/${propertyId}/health`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [propertyId]);

  if (loading) return <div className="ph-loading">Loading property health...</div>;
  if (error) return <div className="auth-error">{error}</div>;
  if (!data) return null;

  const { maintenance, inspections, property } = data;
  const noData = maintenance.byCategory.length === 0
    && !inspections.lastRoomInspection
    && !inspections.lastCommonInspection;
  if (noData) {
    return <p className="ph-empty">Start inspecting this property to see health data.</p>;
  }

  const daysSinceRoom = daysSince(inspections.lastRoomInspection);
  const daysSinceCommon = daysSince(inspections.lastCommonInspection);
  const roomOverdue = daysSinceRoom != null && daysSinceRoom > 30;
  const commonOverdue = daysSinceCommon != null && daysSinceCommon > 14;

  const costClass = (() => {
    if (maintenance.metroAvgCostPerRoomPerMonth == null) return '';
    return maintenance.costPerRoomPerMonth > maintenance.metroAvgCostPerRoomPerMonth
      ? 'ph-cost-bad' : 'ph-cost-good';
  })();
  const passTrend = (() => {
    if (inspections.passRateOlder == null || inspections.passRateNewer == null) return null;
    const delta = inspections.passRateNewer - inspections.passRateOlder;
    return { delta, dir: delta < -2 ? 'down' : delta > 2 ? 'up' : 'flat' };
  })();

  return (
    <div className="ph-tab">
      {/* Maintenance analytics */}
      <h2 className="ph-section-title">Maintenance analytics</h2>

      <div className="ph-card-row">
        <div className="ph-card">
          <div className="ph-card-label">Avg response time</div>
          <div className="ph-card-value">
            {fmtHours(maintenance.avgResponseHours)}
            <TrendArrow
              current={maintenance.avgResponseHours}
              previous={maintenance.avgResponseHoursPrev}
            />
          </div>
        </div>
        <div className="ph-card">
          <div className="ph-card-label">Avg resolution time</div>
          <div className="ph-card-value">
            {fmtDays(maintenance.avgResolutionDays)}
            <TrendArrow
              current={maintenance.avgResolutionDays}
              previous={maintenance.avgResolutionDaysPrev}
            />
          </div>
        </div>
        <div className="ph-card">
          <div className="ph-card-label">Cost per room / month</div>
          <div className={`ph-card-value ${costClass}`}>
            {fmtMoney(maintenance.costPerRoomPerMonth)}
          </div>
          {maintenance.metroAvgCostPerRoomPerMonth != null && (
            <div className="ph-card-sub">
              Metro avg: {fmtMoney(maintenance.metroAvgCostPerRoomPerMonth)}
            </div>
          )}
        </div>
      </div>

      <div className="ph-grid-2">
        <div className="ph-section">
          <h3 className="ph-subtitle">Maintenance by category</h3>
          <HBarChart data={maintenance.byCategory} />
        </div>
        <div className="ph-section">
          <h3 className="ph-subtitle">Tickets by status</h3>
          <div className="ph-status-row">
            {Object.entries(maintenance.byStatus).map(([s, c]) => (
              <div key={s} className="ph-status-card">
                <div className="ph-status-count">{c}</div>
                <div className="ph-status-label">
                  {s === 'IN_PROGRESS' ? 'In progress' : s.charAt(0) + s.slice(1).toLowerCase()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ph-section">
        <h3 className="ph-subtitle">Recurring patterns</h3>
        {maintenance.recurringPatterns.length === 0 ? (
          <p className="ph-empty">No recurring issues yet.</p>
        ) : (
          <div className="ph-table-wrap">
            <table className="ph-table">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Category</th>
                  <th>Tickets</th>
                  <th>Total cost</th>
                  <th>Last occurrence</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {maintenance.recurringPatterns.map((p) => (
                  <tr key={`${p.roomId}-${p.category}`}>
                    <td>{p.roomLabel}</td>
                    <td>{p.category}</td>
                    <td>{p.count}</td>
                    <td>{fmtMoney(p.totalCost)}</td>
                    <td>{fmtDate(p.lastOccurrence)}</td>
                    <td>{p.count >= 3 && <span className="ph-badge-bad">Recurring issue</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Comparison */}
      <h2 className="ph-section-title">How this property compares</h2>
      <ComparisonTable
        propertyId={property.id}
        metroArea={property.metroArea}
        timelineMonths={timelineMonths}
      />

      {/* Inspection compliance */}
      <h2 className="ph-section-title">Inspection compliance</h2>
      <div className="ph-card-row">
        <div className="ph-card">
          <div className="ph-card-label">Last room inspection</div>
          <div className="ph-card-value">{fmtDate(inspections.lastRoomInspection)}</div>
          {daysSinceRoom != null && (
            <div className={`ph-card-sub ${roomOverdue ? 'ph-warn' : ''}`}>
              {daysSinceRoom} days ago
              {roomOverdue && ' — overdue'}
            </div>
          )}
        </div>
        <div className="ph-card">
          <div className="ph-card-label">Last common area</div>
          <div className="ph-card-value">{fmtDate(inspections.lastCommonInspection)}</div>
          {daysSinceCommon != null && (
            <div className={`ph-card-sub ${commonOverdue ? 'ph-warn' : ''}`}>
              {daysSinceCommon} days ago
              {commonOverdue && ' — overdue'}
            </div>
          )}
        </div>
        <div className="ph-card">
          <div className="ph-card-label">Pass rate (6 mo)</div>
          <div className="ph-card-value">
            {inspections.passRate != null ? `${inspections.passRate.toFixed(0)}%` : '—'}
            {passTrend && passTrend.dir !== 'flat' && (
              <span className={`ph-trend ${passTrend.dir === 'up' ? 'ph-trend-good' : 'ph-trend-bad'}`}>
                {passTrend.dir === 'up' ? '↑' : '↓'} {Math.abs(passTrend.delta).toFixed(0)}%
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="ph-section">
        <h3 className="ph-subtitle">Inspection compliance ({new Date().getFullYear()})</h3>
        <ComplianceCalendar items={inspections.timeline} />
      </div>
    </div>
  );
}
