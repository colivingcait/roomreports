import { useState, useEffect, useRef } from 'react';

const api = (path) =>
  fetch(path, { credentials: 'include' })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

// Picker that lets the PM assign maintenance to a teammate, a vendor, or a
// custom name. Emits one of:
//   { assignedUserId, assignedVendorId: null, assignedTo: null } (team)
//   { assignedVendorId, assignedUserId: null, assignedTo: null } (vendor)
//   { assignedTo: 'custom name', assignedUserId: null, assignedVendorId: null }

export default function AssigneePicker({ value, onChange, placeholder = 'Assign...' }) {
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [customDraft, setCustomDraft] = useState('');
  const ref = useRef(null);

  // Current display value: prefer explicit selection labels over stored text
  const display = value?.userName
    ? value.userName
    : value?.vendorName
      ? value.vendorName
      : value?.assignedTo || '';

  useEffect(() => {
    Promise.all([api('/api/team'), api('/api/vendors')])
      .then(([t, v]) => {
        setTeam((t.users || []).filter((u) => !u.deletedAt));
        setVendors(v.vendors || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const pickUser = (u) => {
    onChange({ assignedUserId: u.id, assignedVendorId: null, assignedTo: u.name });
    setOpen(false);
  };
  const pickVendor = (v) => {
    const label = v.company ? `${v.name} (${v.company})` : v.name;
    onChange({ assignedVendorId: v.id, assignedUserId: null, assignedTo: label });
    setOpen(false);
  };
  const pickCustom = () => {
    const trimmed = customDraft.trim();
    if (!trimmed) return;
    onChange({ assignedTo: trimmed, assignedUserId: null, assignedVendorId: null });
    setCustomDraft('');
    setOpen(false);
  };
  const clear = () => {
    onChange({ assignedTo: null, assignedUserId: null, assignedVendorId: null });
    setOpen(false);
  };

  return (
    <div className="assignee-picker" ref={ref}>
      <button type="button" className="maint-input assignee-trigger" onClick={() => setOpen((v) => !v)}>
        {display || <span style={{ color: '#B5B0AB' }}>{placeholder}</span>}
        <span className="assignee-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="assignee-menu">
          {team.length > 0 && (
            <div className="assignee-group">
              <div className="assignee-group-label">Team</div>
              {team.map((u) => (
                <button key={u.id} type="button" className="assignee-option" onClick={() => pickUser(u)}>
                  <span>{u.name}</span>
                  <span className="assignee-option-sub">{u.customRole || u.role}</span>
                </button>
              ))}
            </div>
          )}
          {vendors.length > 0 && (
            <div className="assignee-group">
              <div className="assignee-group-label">Vendors</div>
              {vendors.map((v) => (
                <button key={v.id} type="button" className="assignee-option" onClick={() => pickVendor(v)}>
                  <span>{v.name}</span>
                  <span className="assignee-option-sub">
                    {v.company || (v.specialties?.length ? v.specialties[0] : 'Vendor')}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="assignee-group">
            <div className="assignee-group-label">Custom</div>
            <div className="assignee-custom">
              <input
                type="text"
                className="maint-input"
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                placeholder="Type a name..."
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pickCustom(); } }}
              />
              <button type="button" className="btn-primary-xs" onClick={pickCustom} disabled={!customDraft.trim()}>
                Set
              </button>
            </div>
          </div>
          {display && (
            <button type="button" className="assignee-clear" onClick={clear}>
              Clear assignment
            </button>
          )}
        </div>
      )}
    </div>
  );
}
