import { useState, useEffect, Fragment } from 'react';

const COND = { 'Excellent': 0, 'Good': 1, 'Fair': 2, 'Damaged': 3, 'Heavily Damaged': 4 };

function statusClass(status) {
  const r = COND[status] ?? -1;
  if (r <= 1) return 'cmp-good';
  if (r === 2) return 'cmp-mid';
  if (r >= 3) return 'cmp-bad';
  return '';
}

export default function MoveInOutComparison({ roomId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!roomId) return;
    setLoading(true);
    fetch(`/api/inspections/compare/${roomId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [roomId]);

  if (loading) return <div className="cmp-loading">Loading comparison...</div>;
  if (!data) return null;

  const { moveIn, moveOut, comparison, room, property } = data;

  if (!moveIn && !moveOut) {
    return (
      <div className="cmp-empty">
        <p>No Move-In inspections yet for this room.</p>
      </div>
    );
  }

  // Build item map for side-by-side layout
  const itemKeys = new Set();
  const zones = [];
  const zoneItems = {};

  const addItems = (items) => {
    for (const item of items || []) {
      const key = `${item.zone}|${item.text}`;
      itemKeys.add(key);
      if (!zoneItems[item.zone]) {
        zoneItems[item.zone] = {};
        zones.push(item.zone);
      }
      zoneItems[item.zone][item.text] = { zone: item.zone, text: item.text };
    }
  };
  addItems(moveIn?.items || []);
  addItems(moveOut?.items || []);

  const lookupIn = {};
  const lookupOut = {};
  for (const i of (moveIn?.items || [])) lookupIn[`${i.zone}|${i.text}`] = i;
  for (const i of (moveOut?.items || [])) lookupOut[`${i.zone}|${i.text}`] = i;

  const deterKeys = new Set(
    (comparison || []).filter((c) => c.deteriorated).map((c) => `${c.zone}|${c.text}`),
  );

  return (
    <div className="cmp-container">
      <div className="cmp-header">
        <div>
          <h3>Move-In Comparison</h3>
          <span className="cmp-subtitle">{property?.name} — {room?.label}</span>
        </div>
      </div>

      {/* Deterioration summary */}
      {comparison?.length > 0 && (
        <div className="cmp-changes">
          <h4>Changes Since Move-In</h4>
          {comparison.map((c, i) => (
            <div
              key={i}
              className={`cmp-change-item ${c.deteriorated ? 'cmp-deteriorated' : 'cmp-improved'}`}
            >
              <div>
                <span className="cmp-change-zone">{c.zone}</span>
                <span className="cmp-change-text">{c.text}</span>
              </div>
              <div className="cmp-change-arrow">
                <span className={statusClass(c.moveInStatus)}>{c.moveInStatus}</span>
                <span className="cmp-arrow">&rarr;</span>
                <span className={statusClass(c.moveOutStatus)}>{c.moveOutStatus}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Side-by-side item table */}
      <div className="cmp-table-wrap">
        <table className="cmp-table">
          <thead>
            <tr>
              <th className="cmp-th-item">Item</th>
              <th className="cmp-th-col">
                <div className="cmp-th-label">Move-In</div>
                <div className="cmp-th-sub">
                  {moveIn ? new Date(moveIn.createdAt).toLocaleDateString() : '—'}
                </div>
              </th>
              <th className="cmp-th-col">
                <div className="cmp-th-label">Move-Out</div>
                <div className="cmp-th-sub">
                  {moveOut ? new Date(moveOut.createdAt).toLocaleDateString() : '—'}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {zones.map((zone) => (
              <Fragment key={zone}>
                <tr className="cmp-zone-row">
                  <td colSpan={3} className="cmp-zone-label">{zone}</td>
                </tr>
                {Object.values(zoneItems[zone]).map((item) => {
                  const key = `${item.zone}|${item.text}`;
                  const inI = lookupIn[key];
                  const outI = lookupOut[key];
                  const det = deterKeys.has(key);
                  return (
                    <tr key={key} className={det ? 'cmp-row-deter' : ''}>
                      <td className="cmp-cell-item">{item.text}</td>
                      <td className={`cmp-cell ${statusClass(inI?.status)}`}>
                        <div className="cmp-cell-status">{inI?.status || '—'}</div>
                        {inI?.photos?.length > 0 && (
                          <div className="cmp-photos">
                            {inI.photos.slice(0, 3).map((p) => (
                              <img key={p.id} src={p.url} alt="" className="cmp-photo" />
                            ))}
                          </div>
                        )}
                      </td>
                      <td className={`cmp-cell ${statusClass(outI?.status)}`}>
                        <div className="cmp-cell-status">{outI?.status || '—'}</div>
                        {outI?.photos?.length > 0 && (
                          <div className="cmp-photos">
                            {outI.photos.slice(0, 3).map((p) => (
                              <img key={p.id} src={p.url} alt="" className="cmp-photo" />
                            ))}
                          </div>
                        )}
                      </td>
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
