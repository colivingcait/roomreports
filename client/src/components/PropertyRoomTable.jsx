import { useState, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';

function fmtMoneyShort(n) {
  if (n == null || n === 0) return '$0';
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function timeAgo(d) {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function roomNumberFromLabel(label) {
  if (!label) return null;
  const m = String(label).match(/(\d+)/);
  return m ? m[1] : null;
}

function isEnsuite(features) {
  if (!Array.isArray(features)) return false;
  return features.some((f) => /ensuite|private bath/i.test(String(f)));
}

function Sparkline({ points }) {
  if (!points || points.length === 0) return null;
  const vals = points.map((p) => p.host || 0);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const W = 120;
  const H = 32;
  const step = points.length > 1 ? W / (points.length - 1) : W;
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = H - ((p.host - min) / range) * H;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={W} height={H} className="prt-spark">
      <path d={path} fill="none" stroke="#6B8F71" strokeWidth="1.5" />
      {points.map((p, i) => {
        const x = i * step;
        const y = H - ((p.host - min) / range) * H;
        const monthLabel = p.month
          ? new Date(`${p.month}-01`).toLocaleString('en-US', { month: 'short', year: '2-digit' })
          : '';
        const valLabel = `$${Math.round(p.host || 0).toLocaleString()}`;
        return (
          <circle key={i} cx={x} cy={y} r={3} fill="#6B8F71">
            <title>{monthLabel ? `${monthLabel}: ${valLabel}` : valLabel}</title>
          </circle>
        );
      })}
    </svg>
  );
}

// Maintenance ticket status colors — mirrors MaintenanceDetailModal so the
// expanded room badges match the rest of the app.
const MAINT_STATUS_LABELS = {
  OPEN: 'Open', ASSIGNED: 'Assigned', IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved', DEFERRED: 'Deferred',
};
const MAINT_STATUS_COLORS = {
  OPEN: '#C0392B', ASSIGNED: '#BA7517', IN_PROGRESS: '#3B6D8A',
  RESOLVED: '#2F7A48', DEFERRED: '#8A8580',
};

const VIOLATION_TYPE_LABELS = {
  MESSY: 'Messy', BAD_ODOR: 'Bad odor', SMOKING: 'Smoking',
  UNAUTHORIZED_GUESTS: 'Unauthorized guests', PETS: 'Pets',
  OPEN_FOOD: 'Open food', PESTS: 'Pests/bugs',
  OPEN_FLAMES: 'Open flames/candles', OVERLOADED_OUTLETS: 'Overloaded outlets',
  KITCHEN_APPLIANCES: 'Kitchen appliances', LITHIUM_BATTERIES: 'Lithium batteries',
  MODIFICATIONS: 'Modifications', DRUG_PARAPHERNALIA: 'Drug paraphernalia',
  WEAPONS: 'Weapons', UNCLEAR_EGRESS: 'Unclear egress', NOISE: 'Noise', OTHER: 'Other',
};
const ESCALATION_LABELS = {
  FLAGGED: 'Flagged', FIRST_WARNING: '1st Warning',
  SECOND_WARNING: '2nd Warning', FINAL_NOTICE: 'Final Notice',
};
const ESCALATION_COLORS = {
  FLAGGED:        '#8A8580',
  FIRST_WARNING:  '#BA7517',
  SECOND_WARNING: '#C0392B',
  FINAL_NOTICE:   '#A02420',
};

const COLUMNS = [
  { key: 'roomNumber', label: 'Room', sortable: true },
  { key: 'resident', label: 'Resident', sortable: false },
  { key: 'host', label: 'Earnings', sortable: true },
  { key: 'vacantDays', label: 'Vacancy', sortable: true },
  { key: 'tenureMonths', label: 'Tenure', sortable: true },
  { key: 'maintCount', label: 'Maint', sortable: true },
  { key: 'violationCount', label: 'Violations', sortable: true },
  { key: 'net', label: 'Net', sortable: true },
  { key: 'turn', label: '', sortable: false },
];

export default function PropertyRoomTable({
  propertyId,
  rooms,            // roomCards from overview
  financial,        // /api/financials/property/:id payload
  deferredByRoom,   // { roomId: [items] }
  maintItems,       // all maintenance items (from overview)
  violations,       // all violations (from overview)
  onTurn,           // (room) => void
  onViolationClick, // (violationId) => void
  onTicketClick,    // (ticketId) => void
  onLogViolation,   // (room) => void  — opens LogViolation pre-filled
}) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState('roomNumber');
  const [sortDir, setSortDir] = useState('asc');
  const [expandedId, setExpandedId] = useState(null);

  const rows = useMemo(() => rooms.map((room) => {
    const roomNum = roomNumberFromLabel(room.label);
    const finRoom = financial?.hasData && roomNum ? financial.rooms?.[roomNum] : null;
    const host = finRoom?.host || 0;
    const maintenanceCost = finRoom?.maintenanceCost || 0;
    const net = host - maintenanceCost;
    const maintCount = (room.openMaintenanceCount || 0);
    const violationCount = (room.activeViolationCount || 0);
    const vacantDays = finRoom?.vacantDays ?? null;
    const tenureMonths = finRoom?.tenureMonths ?? null;
    const residentName = finRoom?.residentName || null;
    const residentSince = finRoom?.residentSince || null;
    const ensuite = isEnsuite(room.features);
    return {
      id: room.id,
      raw: room,
      roomNumber: roomNum,
      label: room.label,
      residentName,
      residentSince,
      ensuite,
      host,
      vacantDays,
      tenureMonths,
      maintCount,
      violationCount,
      maintenanceCost,
      net,
      finRoom,
    };
  }), [rooms, financial]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === 'roomNumber') {
        const an = parseInt(av, 10);
        const bn = parseInt(bv, 10);
        if (!isNaN(an) && !isNaN(bn)) {
          return sortDir === 'asc' ? an - bn : bn - an;
        }
        av = String(av || '');
        bv = String(bv || '');
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (av == null) av = -Infinity;
      if (bv == null) bv = -Infinity;
      if (typeof av === 'string' || typeof bv === 'string') {
        return sortDir === 'asc'
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const handleRowClick = (id) => {
    setExpandedId((cur) => (cur === id ? null : id));
  };

  if (rows.length === 0) {
    return <p className="empty-text">No rooms yet.</p>;
  }

  return (
    <div className="prt-wrap">
      <table className="prt-table">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.label || c.key}
                className={`prt-th ${c.sortable ? 'prt-th-sortable' : ''} ${c.key === 'roomNumber' ? 'prt-th-sticky' : ''}`}
                onClick={() => c.sortable && toggleSort(c.key)}
              >
                {c.label}
                {c.sortable && sortKey === c.key && (
                  <span className="prt-sort-arrow">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            // Row tint: only when there's something actionable —
            // active maintenance or active violations. Vacancy alone
            // is a normal state (rooms turn between residents) and
            // earnings is never a "problem" signal on its own.
            const isProblem = r.maintCount > 0 || r.violationCount > 0;
            const isExpanded = expandedId === r.id;
            // Net P&L is the only money column that gets coloured —
            // sage when positive, terracotta when negative.
            const netClass = r.net > 0 ? 'prt-positive' : r.net < 0 ? 'prt-negative' : '';
            return (
              <Fragment key={r.id}>
                <tr
                  className={`prt-row ${isProblem ? 'prt-row-problem' : ''} ${isExpanded ? 'prt-row-expanded' : ''}`}
                  onClick={() => handleRowClick(r.id)}
                >
                  <td className="prt-td prt-td-sticky">
                    <strong>{r.label}</strong>
                  </td>
                  <td className="prt-td">
                    {r.residentName ? (
                      <>
                        <div>{r.residentName}</div>
                        <div className="prt-sub">
                          {r.residentSince ? `Since ${fmtDate(r.residentSince)}` : ''}
                          {r.residentSince && ' · '}
                          <span className={r.ensuite ? 'prt-tag-ensuite' : 'prt-tag-shared'}>
                            {r.ensuite ? 'Ensuite' : 'Shared'}
                          </span>
                        </div>
                      </>
                    ) : (
                      <span className="prt-dim">vacant</span>
                    )}
                  </td>
                  <td className="prt-td">{fmtMoneyShort(r.host)}</td>
                  <td className={`prt-td ${(r.vacantDays || 0) > 0 ? 'prt-bad' : ''}`}>
                    {r.vacantDays != null ? `${r.vacantDays}d` : '—'}
                  </td>
                  <td className="prt-td">
                    {r.tenureMonths != null ? `${r.tenureMonths.toFixed(1)} mo` : '—'}
                  </td>
                  <td className="prt-td">
                    {r.maintCount > 0
                      ? <span className="prt-badge-bad">{r.maintCount}</span>
                      : <span className="prt-dim">0</span>}
                  </td>
                  <td className="prt-td">
                    {r.violationCount > 0
                      ? <span className="prt-badge-bad">{r.violationCount}</span>
                      : <span className="prt-dim">0</span>}
                  </td>
                  <td className={`prt-td ${netClass}`}>{fmtMoneyShort(r.net)}</td>
                  <td className="prt-td">
                    <button
                      type="button"
                      className="prt-turn-btn"
                      onClick={(e) => { e.stopPropagation(); onTurn?.(r.raw); }}
                    >
                      Turn
                    </button>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="prt-detail-row">
                    <td colSpan={COLUMNS.length} className="prt-detail-cell">
                      <RoomDetail
                        room={r.raw}
                        finRoom={r.finRoom}
                        deferred={deferredByRoom?.[r.id] || []}
                        maintItems={(maintItems || []).filter((m) => (
                          m.roomId === r.id
                          // Match the badge count: active parents only,
                          // not children, not resolved, not deferred,
                          // not soft-deleted.
                          && !m.parentTicketId
                          && !m.deletedAt
                          && !m.archivedAt
                          && ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(m.status)
                        ))}
                        violations={(violations || []).filter((v) => (
                          // Quick-glance operational view — only show
                          // ACTIVE violations. Resolved/archived live in
                          // the violation history.
                          v.roomId === r.id
                          && !v.resolvedAt
                          && !v.archivedAt
                          && !v.deletedAt
                        ))}
                        onNavigate={navigate}
                        onViolationClick={onViolationClick}
                        onTicketClick={onTicketClick}
                        onLogViolation={onLogViolation}
                        propertyId={propertyId}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RoomDetail({ room, finRoom, deferred, maintItems, violations, onNavigate, onViolationClick, onTicketClick, onLogViolation, propertyId }) {
  // Stop expand/collapse from firing when the user clicks anywhere inside
  // the expanded panel — only the row header should toggle.
  const stop = (e) => e.stopPropagation();
  return (
    <div className="prt-detail" onClick={stop}>
      <div className="prt-detail-grid">
        <div>
          <div className="prt-detail-label">Features</div>
          <div className="prt-feature-tags">
            {room.features?.length > 0
              ? room.features.map((f) => <span key={f} className="prt-tag">{f}</span>)
              : <span className="prt-dim">None set</span>}
          </div>
          {room.lastTurnoverAt && (
            <div className="prt-detail-meta">Last turned {timeAgo(room.lastTurnoverAt)}</div>
          )}
          {room.lastInspection && (
            <div className="prt-detail-meta">Last inspected {timeAgo(room.lastInspection.date)}</div>
          )}
        </div>

        <div>
          <div className="prt-detail-label">Earnings (last 6 mo)</div>
          {finRoom?.sparkline?.length > 0
            ? <Sparkline points={finRoom.sparkline} />
            : <span className="prt-dim">No data</span>}
        </div>

        <div>
          <div className="prt-detail-label">Recent maintenance</div>
          {maintItems.length === 0 ? (
            <span className="prt-dim">None</span>
          ) : (
            <div className="prt-chip-list">
              {maintItems.slice(0, 5).map((m) => {
                const color = MAINT_STATUS_COLORS[m.status] || '#8A8580';
                const label = MAINT_STATUS_LABELS[m.status] || m.status;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="prt-maint-chip"
                    onClick={(e) => { e.stopPropagation(); onTicketClick?.(m.id); }}
                    title={`${m.description} · ${label}`}
                  >
                    <span className="prt-chip-title">{m.description}</span>
                    <span
                      className="prt-status-pill"
                      style={{ color, borderColor: color }}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="prt-detail-label">Active violations</div>
          {violations.length === 0 ? (
            <span className="prt-dim">None</span>
          ) : (
            <div className="prt-chip-list">
              {violations.slice(0, 5).map((v) => {
                const typeLabel = v.typeLabel
                  || VIOLATION_TYPE_LABELS[v.violationType]
                  || v.category
                  || 'Violation';
                const lvl = v.escalationLevel || 'FLAGGED';
                const lvlColor = ESCALATION_COLORS[lvl] || ESCALATION_COLORS.FLAGGED;
                const lvlLabel = ESCALATION_LABELS[lvl] || lvl;
                return (
                  <button
                    key={v.id}
                    type="button"
                    className="prt-violation-chip"
                    onClick={(e) => { e.stopPropagation(); onViolationClick?.(v.id); }}
                    title={`${typeLabel} · ${lvlLabel}`}
                  >
                    <span
                      className="prt-violation-dot"
                      style={{ background: lvlColor }}
                      aria-label={lvlLabel}
                    />
                    <span className="prt-chip-title">{typeLabel}</span>
                    <span className="prt-chip-meta">· {lvlLabel}</span>
                    <span className="prt-chip-meta">· {timeAgo(v.createdAt)}</span>
                  </button>
                );
              })}
            </div>
          )}
          {onLogViolation && (
            <button
              type="button"
              className="prt-add-link"
              onClick={(e) => { e.stopPropagation(); onLogViolation(room); }}
            >
              + Log Violation
            </button>
          )}
        </div>

        {deferred.length > 0 && (
          <div>
            <div className="prt-detail-label">Deferred maintenance</div>
            <div className="prt-chip-list">
              {deferred.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="prt-maint-chip"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate(`/maintenance?propertyId=${propertyId}&roomId=${room.id}`);
                  }}
                >
                  <span className="prt-chip-title">{d.description}</span>
                  <span className="prt-chip-meta">
                    {d.deferType === 'ROOM_TURN'
                      ? 'Until room turn'
                      : d.deferUntil
                        ? `Until ${fmtDate(d.deferUntil)}`
                        : 'Deferred'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
