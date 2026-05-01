import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '$0';
  return Number(n).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  });
}

function Sparkline({ points }) {
  if (!points || points.length === 0) return null;
  const W = 240, H = 60, PAD = 4;
  const values = points.map((p) => p.host || 0);
  const max = Math.max(1, ...values);
  const n = points.length;
  const x = (i) => PAD + (n === 1 ? (W - 2 * PAD) / 2 : (i / (n - 1)) * (W - 2 * PAD));
  const y = (v) => PAD + (H - 2 * PAD) - (v / max) * (H - 2 * PAD);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.host || 0)}`).join(' ');
  const fillPath = `${path} L${x(n - 1)},${H - PAD} L${x(0)},${H - PAD} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      <path d={fillPath} fill="#6B8F71" fillOpacity="0.15" />
      <path d={path} fill="none" stroke="#6B8F71" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.host || 0)} r="2.5"
                fill="#fff" stroke="#6B8F71" strokeWidth="1.5" />
      ))}
    </svg>
  );
}

export default function PropertyFinancialHealth({ propertyId }) {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/financials/property-summary', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!loaded) return null;
  const summary = data?.propertySummary?.[propertyId];

  if (!data?.hasData) {
    return (
      <section className="fin-detail-section">
        <h2 className="po-section-title">Financial health</h2>
        <p className="page-subtitle">
          No financial data uploaded yet.{' '}
          <Link to="/financials" className="fin-detail-link">
            Upload a PadSplit report →
          </Link>
        </p>
      </section>
    );
  }

  if (!summary) {
    return (
      <section className="fin-detail-section">
        <h2 className="po-section-title">Financial health</h2>
        <p className="page-subtitle">
          This property isn't matched to a PadSplit address yet.{' '}
          <Link to="/financials" className="fin-detail-link">Match it →</Link>
        </p>
      </section>
    );
  }

  const netClass = summary.netMonthly > 0 ? 'fin-pl-good'
    : summary.netMonthly < 0 ? 'fin-pl-bad' : 'fin-pl-warn';

  return (
    <section className="fin-detail-section">
      <h2 className="po-section-title">Financial health</h2>
      <div className="fin-detail-grid">
        <div className="fin-detail-stat">
          <label>Avg monthly revenue</label>
          <span>{fmtMoney(summary.avgRevenue)}</span>
        </div>
        <div className="fin-detail-stat">
          <label>Avg monthly maintenance</label>
          <span>{fmtMoney(summary.avgMaintenance)}</span>
        </div>
        <div className="fin-detail-stat">
          <label>Net monthly</label>
          <span className={netClass}>{fmtMoney(summary.netMonthly)}</span>
        </div>
        <div className="fin-detail-stat">
          <label>Collection rate</label>
          <span>
            {summary.collectionRate != null
              ? `${summary.collectionRate.toFixed(1)}%`
              : '—'}
          </span>
        </div>
      </div>
      <div className="fin-spark-wrap">
        <Sparkline points={summary.sparkline} />
      </div>
      <Link to="/financials" className="fin-detail-link">
        View full financials →
      </Link>
    </section>
  );
}
