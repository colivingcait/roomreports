import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const TYPE_LABELS = {
  COMMON_AREA: 'Common Area',
  COMMON_AREA_QUICK: 'Common Area Quick Check',
  ROOM_TURN: 'Room Turn',
  QUARTERLY: 'Room Inspection',
  RESIDENT_SELF_CHECK: 'Self-Check',
  MOVE_IN_OUT: 'Move-In',
};
const TYPE_COLORS = {
  COMMON_AREA: '#2B5F8A',
  COMMON_AREA_QUICK: '#2B5F8A',
  ROOM_TURN: '#854F0B',
  QUARTERLY: '#3B6D11',
  RESIDENT_SELF_CHECK: '#8A2B6D',
  MOVE_IN_OUT: '#6D3B11',
};

const api = (path) =>
  fetch(path, { credentials: 'include' }).then(async (r) => {
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  });

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtIso(d) {
  return d.toISOString().slice(0, 10);
}

export default function Calendar() {
  const navigate = useNavigate();
  const [view, setView] = useState('month'); // month | week
  const [cursor, setCursor] = useState(new Date());
  const [completed, setCompleted] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [loading, setLoading] = useState(true);

  const [rangeStart, rangeEnd] = useMemo(() => {
    if (view === 'week') {
      const start = addDays(cursor, -cursor.getDay());
      return [start, addDays(start, 6)];
    }
    // month view + a padding week on either side so the calendar grid is full
    const first = startOfMonth(cursor);
    const last = endOfMonth(cursor);
    const gridStart = addDays(first, -first.getDay());
    const gridEnd = addDays(last, 6 - last.getDay());
    return [gridStart, gridEnd];
  }, [view, cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api(
        `/api/schedules/calendar?start=${rangeStart.toISOString()}&end=${rangeEnd.toISOString()}`,
      );
      setCompleted(d.completed || []);
      setUpcoming(d.upcoming || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [rangeStart, rangeEnd]);

  useEffect(() => { load(); }, [load]);

  const eventsByDay = useMemo(() => {
    const map = new Map();
    const push = (key, ev) => {
      const list = map.get(key) || [];
      list.push(ev);
      map.set(key, list);
    };
    for (const c of completed) {
      if (!c.completedAt) continue;
      const k = fmtIso(new Date(c.completedAt));
      push(k, {
        kind: 'completed',
        id: c.id,
        type: c.type,
        label: c.property?.name || '',
        room: c.room?.label || '',
        onClick: () => navigate(`/inspections/${c.id}/review`),
      });
    }
    for (const u of upcoming) {
      const k = fmtIso(new Date(u.nextDueAt));
      push(k, {
        kind: 'upcoming',
        id: u.scheduleId,
        type: u.inspectionType,
        label: u.property?.name || '',
        overdue: u.isOverdue,
        onClick: () => navigate('/inspections'),
      });
    }
    return map;
  }, [completed, upcoming, navigate]);

  const shift = (dir) => {
    const step = view === 'week' ? 7 : 30;
    setCursor((c) => addDays(c, dir * step));
  };

  const days = [];
  for (let d = new Date(rangeStart); d <= rangeEnd; d = addDays(d, 1)) {
    days.push(new Date(d));
  }
  const today = new Date();

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Inspection Calendar</h1>
          <p className="page-subtitle">
            {cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div className="view-toggle">
            <button className={`view-btn ${view === 'week' ? 'active' : ''}`} onClick={() => setView('week')}>Week</button>
            <button className={`view-btn ${view === 'month' ? 'active' : ''}`} onClick={() => setView('month')}>Month</button>
          </div>
          <button className="btn-secondary" onClick={() => shift(-1)}>&larr;</button>
          <button className="btn-secondary" onClick={() => setCursor(new Date())}>Today</button>
          <button className="btn-secondary" onClick={() => shift(1)}>&rarr;</button>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading calendar...</div>
      ) : (
        <>
          <div className="cal-weekday-row">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="cal-weekday">{d}</div>
            ))}
          </div>
          <div className={`cal-grid cal-grid-${view}`}>
            {days.map((d) => {
              const k = fmtIso(d);
              const events = eventsByDay.get(k) || [];
              const inMonth = view === 'week' || d.getMonth() === cursor.getMonth();
              const isToday = sameDay(d, today);
              return (
                <div key={k} className={`cal-day ${!inMonth ? 'cal-day-dim' : ''} ${isToday ? 'cal-day-today' : ''}`}>
                  <div className="cal-day-num">{d.getDate()}</div>
                  {events.map((e, i) => (
                    <button
                      key={i}
                      onClick={e.onClick}
                      className={`cal-event ${e.overdue ? 'cal-event-overdue' : ''} ${e.kind === 'completed' ? 'cal-event-done' : ''}`}
                      style={{ '--color': TYPE_COLORS[e.type] || '#8A8583' }}
                      title={`${TYPE_LABELS[e.type]} · ${e.label}${e.room ? ' / ' + e.room : ''}${e.overdue ? ' · overdue' : ''}`}
                    >
                      <span className="cal-event-dot" />
                      <span className="cal-event-text">
                        {TYPE_LABELS[e.type]} · {e.label}{e.room ? ` / ${e.room}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="cal-legend">
            {Object.entries(TYPE_LABELS).map(([k, label]) => (
              <span key={k} className="cal-legend-item">
                <span className="cal-legend-dot" style={{ background: TYPE_COLORS[k] }} />
                {label}
              </span>
            ))}
            <span className="cal-legend-item">
              <span className="cal-legend-dot" style={{ background: '#C0392B' }} />
              Overdue
            </span>
          </div>
        </>
      )}
    </div>
  );
}
