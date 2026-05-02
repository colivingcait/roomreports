import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../context/AuthContext';

function downloadQr(id, filename) {
  const svg = document.getElementById(id);
  if (!svg) return;
  const serializer = new XMLSerializer();
  const data = serializer.serializeToString(svg);
  const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function LinkCard({ title, url, description, flyerHref, qrId }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="sharing-card">
      <div className="sharing-card-main">
        <h3 className="sharing-card-title">{title}</h3>
        <p className="sharing-card-desc">{description}</p>
        <div className="sharing-card-url" title={url}>{url}</div>
        <div className="sharing-card-actions">
          <button className="btn-primary-sm" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
          <button
            className="btn-secondary-sm"
            onClick={() => downloadQr(qrId, `${title.toLowerCase().replace(/\s+/g, '-')}-qr.svg`)}
          >
            Download QR
          </button>
          {flyerHref && (
            <a className="btn-secondary-sm" href={flyerHref} target="_blank" rel="noopener noreferrer">
              Printable flyer
            </a>
          )}
        </div>
      </div>
      <div className="sharing-card-qr">
        <QRCodeSVG
          id={qrId}
          value={url}
          size={128}
          level="M"
          fgColor="#4A4543"
        />
      </div>
    </div>
  );
}

export default function Sharing() {
  const { organization } = useAuth();
  const slug = organization?.slug;

  if (!slug) {
    return (
      <div className="page-container">
        <div className="page-header"><h1>Sharing</h1></div>
        <div className="empty-state">
          <p>Your organization is missing a slug. Open Settings to set one so we can generate resident links.</p>
        </div>
      </div>
    );
  }

  const base = `https://roomreport.co`;
  const links = [
    {
      title: 'Report Maintenance',
      url: `${base}/report/${slug}`,
      flyerHref: `${base}/flyer/${slug}/report`,
      qrId: 'qr-report',
      description: 'Residents report a maintenance issue directly into your kanban board — photo + description.',
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Sharing</h1>
          <p className="page-subtitle">Universal org-wide resident links</p>
        </div>
      </div>

      <div className="sharing-list">
        {links.map((l) => (
          <LinkCard key={l.title} {...l} />
        ))}
      </div>
    </div>
  );
}
