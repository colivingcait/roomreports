import { useState, useEffect } from 'react';

const GOOD = ['Pass', 'Good', 'Clean', 'Yes'];
const BAD = ['Fail', 'Poor', 'Dirty', 'No', 'Missing'];

function statusClass(status) {
  if (!status) return '';
  if (GOOD.includes(status)) return 'hist-good';
  if (BAD.includes(status)) return 'hist-bad';
  return 'hist-mid';
}

export default function RoomHistory({ roomId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!roomId) return;
    setLoading(true);
    fetch(`/api/inspections/history/${roomId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [roomId]);

  if (loading) return <div className="hist-loading">Loading room history...</div>;
  if (!data || !data.inspections?.length) {
    return (
      <div className="hist-empty">
        <p>No completed inspections for this room yet</p>
      </div>
    );
  }

  const { inspections, comparison, room, property } = data;

  // Group comparison items by zone
  const compZones = {};
  for (const c of comparison) {
    if (!compZones[c.zone]) compZones[c.zone] = [];
    compZones[c.zone].push(c);
  }

  // Build all item texts for the comparison table
  const allItems = {};
  for (const insp of inspections) {
    for (const item of insp.items) {
      const key = `${item.zone}|||${item.text}`;
      if (!allItems[key]) allItems[key] = { zone: item.zone, text: item.text };
    }
  }
  const itemKeys = Object.keys(allItems);

  // Group items by zone for the table
  const zones = [];
  const zoneMap = {};
  for (const key of itemKeys) {
    const { zone } = allItems[key];
    if (!zoneMap[zone]) { zoneMap[zone] = []; zones.push(zone); }
    zoneMap[zone].push(allItems[key]);
  }

  // Build lookup: inspectionId -> item text -> status
  const statusLookup = {};
  for (const insp of inspections) {
    statusLookup[insp.id] = {};
    for (const item of insp.items) {
      statusLookup[insp.id][`${item.zone}|||${item.text}`] = item.status;
    }
  }

  // Check if a cell changed (deteriorated)
  const changedKeys = new Set(comparison.filter((c) => c.deteriorated).map((c) => `${c.zone}|||${c.text}`));

  return (
    <div className="hist-container">
      <div className="hist-header">
        <h3>Room History: {room.label}</h3>
        <span className="hist-subtitle">{property.name} &middot; {inspections.length} inspection{inspections.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Changes summary */}
      {comparison.length > 0 && (
        <div className="hist-changes">
          <h4>Changes Since Last Inspection</h4>
          {Object.entries(compZones).map(([zone, items]) => (
            <div key={zone} className="hist-change-zone">
              <span className="hist-change-zone-name">{zone}</span>
              {items.map((c, i) => (
                <div key={i} className={`hist-change-item ${c.deteriorated ? 'hist-deteriorated' : 'hist-improved'}`}>
                  <span className="hist-change-text">{c.text}</span>
                  <span className="hist-change-arrow">
                    <span className={statusClass(c.previousStatus)}>{c.previousStatus}</span>
                    <span className="hist-arrow">&rarr;</span>
                    <span className={statusClass(c.currentStatus)}>{c.currentStatus}</span>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Comparison table */}
      <div className="hist-table-wrap">
        <table className="hist-table">
          <thead>
            <tr>
              <th className="hist-th-item">Item</th>
              {inspections.map((insp) => (
                <th key={insp.id} className="hist-th-insp">
                  <div className="hist-th-type">{insp.type.replace(/_/g, ' ')}</div>
                  <div className="hist-th-date">
                    {new Date(insp.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                  </div>
                  <div className="hist-th-inspector">{insp.inspectorName}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zones.map((zone) => (
              <Fragment key={zone}>
                <tr className="hist-zone-row">
                  <td colSpan={inspections.length + 1} className="hist-zone-label">{zone}</td>
                </tr>
                {zoneMap[zone].map((item) => {
                  const key = `${item.zone}|||${item.text}`;
                  const isChanged = changedKeys.has(key);
                  return (
                    <tr key={key} className={isChanged ? 'hist-row-changed' : ''}>
                      <td className="hist-cell-item">{item.text}</td>
                      {inspections.map((insp) => {
                        const st = statusLookup[insp.id]?.[key] || '—';
                        return (
                          <td key={insp.id} className={`hist-cell-status ${statusClass(st)}`}>
                            {st}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Need Fragment for table grouping
import { Fragment } from 'react';
