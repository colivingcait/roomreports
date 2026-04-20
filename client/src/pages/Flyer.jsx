import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';

// Printable 8.5x11 flyer with a large QR for posting in common areas.
// Routes: /flyer/:slug/:kind  where kind is movein | selfcheck | report

const KIND_META = {
  movein: {
    title: 'Move-In Inspection',
    headline: 'Just moved in?',
    instruction: 'Scan this QR or visit the link to document your room.',
    footer: 'Takes about 3 minutes · No login required',
  },
  selfcheck: {
    title: 'Monthly Self-Check',
    headline: 'See something off?',
    instruction: 'Scan the QR or visit the link to flag anything that needs attention.',
    footer: 'Takes about 2 minutes · No login required',
  },
  report: {
    title: 'Report Maintenance',
    headline: 'Something broken?',
    instruction: 'Scan the QR or visit the link to report a maintenance issue.',
    footer: 'Photos welcome · No login required',
  },
};

export default function Flyer() {
  const { slug, kind } = useParams();
  const meta = KIND_META[kind] || KIND_META.report;
  const url = `https://roomreport.co/${kind}/${slug}`;

  const [orgName, setOrgName] = useState('');

  useEffect(() => {
    fetch(`/api/public/org/${slug}`)
      .then(async (r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.organizationName) setOrgName(d.organizationName); })
      .catch(() => {});
  }, [slug]);

  useEffect(() => {
    // Give the QR a beat to render before invoking print
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flyer-page">
      <div className="flyer-sheet">
        <div className="flyer-header">
          <div className="flyer-brand">RoomReport</div>
          {orgName && <div className="flyer-org">{orgName}</div>}
        </div>

        <h1 className="flyer-headline">{meta.headline}</h1>
        <h2 className="flyer-title">{meta.title}</h2>

        <div className="flyer-qr">
          <QRCodeSVG value={url} size={360} level="M" fgColor="#4A4543" />
        </div>

        <p className="flyer-instruction">{meta.instruction}</p>

        <div className="flyer-url">
          <span className="flyer-url-label">Or visit:</span>
          <code>{url}</code>
        </div>

        <div className="flyer-footer">{meta.footer}</div>
      </div>

      <div className="flyer-reprint no-print">
        <button className="btn-primary" onClick={() => window.print()}>Print this flyer</button>
      </div>
    </div>
  );
}
