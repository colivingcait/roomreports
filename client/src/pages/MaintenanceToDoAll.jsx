import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import MaintenanceToDoTabs from '../components/MaintenanceToDoTabs';
import { PRIORITY_COLORS } from '../../../shared/index.js';

const STATUS_LABELS = {
  OPEN: 'Open', ASSIGNED: 'Assigned', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved',
  TODO: 'Open', DONE: 'Done',
};
const STATUS_COLORS = {
  OPEN: '#C0392B', ASSIGNED: '#D85A30', IN_PROGRESS: '#BA7517', RESOLVED: '#3B6D11',
  TODO: '#C0392B', DONE: '#3B6D11',
};

const api = (path) => fetch(path, { credentials: 'include' }).then(async (r) => {
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
});

function shortDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function MiniColumn({ status, items, render }) {
  return (
    <div className="kanban-col">
      <div className="kanban-col-header" style={{ borderBottomColor: STATUS_COLORS[status] }}>
        <span>{STATUS_LABELS[status]}</span>
        <span className="kanban-col-count">{items.length}</span>
      </div>
      <div className="kanban-col-body">
        {items.map(render)}
        {items.length === 0 && <p className="empty-text">Empty</p>}
      </div>
    </div>
  );
}

export default function MaintenanceToDoAll() {
  const navigate = useNavigate();
  const [maintenance, setMaintenance] = useState([]);
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([
        api('/api/maintenance'),
        api('/api/tasks'),
      ]);
      setMaintenance(m.items || []);
      setTodos(t.tasks || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="page-loading">Loading...</div>;

  const maintStatuses = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'];
  const todoStatuses = ['TODO', 'IN_PROGRESS', 'DONE'];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <MaintenanceToDoTabs />
          <h1>All</h1>
          <p className="page-subtitle">
            {maintenance.length} maintenance · {todos.length} to-do
          </p>
        </div>
      </div>

      <h3 className="md-section-title" style={{ marginTop: '1rem' }}>Maintenance</h3>
      <div className="kanban-board">
        {maintStatuses.map((s) => (
          <MiniColumn
            key={s}
            status={s}
            items={maintenance.filter((m) => m.status === s)}
            render={(m) => (
              <div
                key={m.id}
                className="maint-card"
                onClick={() => navigate(`/maintenance?status=${s}`)}
                style={{ cursor: 'pointer' }}
              >
                <div className="maint-card-top">
                  <div className="maint-card-desc">{m.description}</div>
                  {m.priority && (
                    <span
                      className="maint-priority-tag"
                      style={{ color: PRIORITY_COLORS[m.priority], borderColor: PRIORITY_COLORS[m.priority] }}
                    >
                      {m.priority}
                    </span>
                  )}
                </div>
                <div className="maint-card-meta">
                  <span>{m.property?.name}</span>
                  {m.room && <><span className="dot" /><span>{m.room.label}</span></>}
                </div>
              </div>
            )}
          />
        ))}
      </div>

      <h3 className="md-section-title" style={{ marginTop: '1.5rem' }}>To-Do</h3>
      <div className="kanban-board" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {todoStatuses.map((s) => (
          <MiniColumn
            key={s}
            status={s}
            items={todos.filter((t) => t.status === s)}
            render={(t) => (
              <div
                key={t.id}
                className={`maint-card ${t.isOverdue ? 'task-card-overdue' : ''}`}
                onClick={() => navigate('/todo')}
                style={{ cursor: 'pointer' }}
              >
                <div className="maint-card-top">
                  <div className="maint-card-desc">{t.title}</div>
                  {t.priority && (
                    <span
                      className="maint-priority-tag"
                      style={{ color: PRIORITY_COLORS[t.priority], borderColor: PRIORITY_COLORS[t.priority] }}
                    >
                      {t.priority}
                    </span>
                  )}
                </div>
                <div className="maint-card-meta">
                  <span>{t.property?.name || 'General'}</span>
                  {t.assignedTo && <><span className="dot" /><span>{t.assignedTo}</span></>}
                </div>
                <div className="maint-card-foot">
                  <span className="maint-card-date">
                    {t.dueAt ? `Due ${shortDate(t.dueAt)}` : 'No due date'}
                    {t.isOverdue && <span style={{ color: '#C0392B', fontWeight: 600 }}> · overdue</span>}
                  </span>
                </div>
              </div>
            )}
          />
        ))}
      </div>
    </div>
  );
}
