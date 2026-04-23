// Central notification service.
//
// `notify(prisma, { userId, type, title, message, link, email })`
// creates a Notification row and (when the user hasn't opted out)
// sends a branded SendGrid email.
//
// The bell is always on — the NotificationPreference row only gates
// email. When we're about to send a batched email (e.g. overdue digest)
// the caller decides what the email body looks like; the helper just
// applies the template shell and filters against user preferences.

import crypto from 'crypto';
import prisma from './prisma.js';
import { sendEmail } from './email.js';
import { defaultEmailFor } from '../../../shared/notifications.js';

const BRAND_GREEN = '#6B8F71';
const BRAND_CREAM = '#FAF8F5';
const BRAND_DARK = '#4A4543';
const BRAND_MUTED = '#8A8583';
const BRAND_BORDER = '#E8E4E1';

// Resolve the URL used in emails so users land on the right deploy.
function appOrigin() {
  return (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
}

export function emailShell({ preheader = '', title, bodyHtml, ctaLabel, ctaHref, footerNote }) {
  const origin = appOrigin();
  const managePrefs = `${origin}/notifications/settings`;

  const cta = ctaLabel && ctaHref
    ? `<tr><td style="padding:0 24px 24px;">
         <a href="${ctaHref}" style="display:inline-block;background:${BRAND_GREEN};color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;font-size:15px;">${esc(ctaLabel)}</a>
       </td></tr>`
    : '';

  const footerSub = footerNote
    ? `<p style="margin:0 0 8px;color:${BRAND_MUTED};font-size:12px;line-height:1.5;">${footerNote}</p>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND_CREAM};font-family:'DM Sans','Helvetica Neue',Helvetica,Arial,sans-serif;color:${BRAND_DARK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_CREAM};padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid ${BRAND_BORDER};border-radius:12px;overflow:hidden;">
      <tr><td style="background:${BRAND_GREEN};padding:20px 24px;">
        <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:0.02em;">RoomReport</span>
      </td></tr>
      <tr><td style="padding:28px 24px 8px;">
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:${BRAND_DARK};">${esc(title)}</h1>
        <div style="font-size:15px;line-height:1.55;color:${BRAND_DARK};">${bodyHtml}</div>
      </td></tr>
      ${cta}
      <tr><td style="padding:16px 24px 24px;border-top:1px solid ${BRAND_BORDER};">
        ${footerSub}
        <p style="margin:0;color:${BRAND_MUTED};font-size:12px;line-height:1.5;">
          RoomReport — roomreport.co ·
          <a href="${managePrefs}" style="color:${BRAND_GREEN};text-decoration:none;">Manage notification preferences</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function residentEmailShell({ title, bodyHtml, ctaLabel, ctaHref, unsubscribeHref, preheader = '' }) {
  const origin = appOrigin();
  const cta = ctaLabel && ctaHref
    ? `<tr><td style="padding:0 24px 24px;">
         <a href="${ctaHref}" style="display:inline-block;background:${BRAND_GREEN};color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;font-size:15px;">${esc(ctaLabel)}</a>
       </td></tr>`
    : '';

  const unsubLink = unsubscribeHref
    ? `<a href="${unsubscribeHref}" style="color:${BRAND_GREEN};text-decoration:none;">Unsubscribe from updates</a>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND_CREAM};font-family:'DM Sans','Helvetica Neue',Helvetica,Arial,sans-serif;color:${BRAND_DARK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_CREAM};padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid ${BRAND_BORDER};border-radius:12px;overflow:hidden;">
      <tr><td style="background:${BRAND_GREEN};padding:20px 24px;">
        <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:0.02em;">RoomReport</span>
      </td></tr>
      <tr><td style="padding:28px 24px 8px;">
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:${BRAND_DARK};">${esc(title)}</h1>
        <div style="font-size:15px;line-height:1.55;color:${BRAND_DARK};">${bodyHtml}</div>
      </td></tr>
      ${cta}
      <tr><td style="padding:16px 24px 24px;border-top:1px solid ${BRAND_BORDER};">
        <p style="margin:0;color:${BRAND_MUTED};font-size:12px;line-height:1.5;">
          RoomReport — <a href="${origin}" style="color:${BRAND_GREEN};text-decoration:none;">roomreport.co</a>
          ${unsubLink ? ` · ${unsubLink}` : ''}
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function summaryList(pairs) {
  if (!pairs.length) return '';
  const rows = pairs
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:${BRAND_MUTED};font-size:13px;vertical-align:top;white-space:nowrap;">${esc(
          k,
        )}</td><td style="padding:4px 0;font-size:14px;color:${BRAND_DARK};">${esc(v)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;">${rows}</table>`;
}

async function wantsEmail(userId, type) {
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_type: { userId, type } },
  });
  if (!pref) return defaultEmailFor(type);
  return pref.email;
}

/**
 * Create an in-app notification and optionally send a branded email.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.organizationId
 * @param {string} opts.type
 * @param {string} opts.title
 * @param {string} opts.message      plain text body for the bell
 * @param {string} [opts.link]       relative URL to navigate to when clicked
 * @param {object} [opts.email]      { subject, bodyHtml, ctaLabel, ctaHref, preheader, to }
 */
export async function notify(opts) {
  const { userId, organizationId, type, title, message, link, email } = opts;
  if (!userId || !organizationId || !type) return null;

  const notif = await prisma.notification.create({
    data: { userId, organizationId, type, title, message, link: link || null },
  });

  if (email) {
    const enabled = await wantsEmail(userId, type);
    if (!enabled) return notif;

    const user = email.to
      ? { email: email.to }
      : await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user?.email) return notif;

    const html = emailShell({
      title: email.title || title,
      bodyHtml: email.bodyHtml,
      ctaLabel: email.ctaLabel,
      ctaHref: email.ctaHref || (link ? `${appOrigin()}${link}` : undefined),
      preheader: email.preheader || message,
      footerNote: email.footerNote,
    });

    await sendEmail({
      to: user.email,
      subject: email.subject || title,
      html,
      text: message,
    });
  }

  return notif;
}

// Fan out a notification to a set of users (e.g. all PMs in an org).
export async function notifyMany({ userIds, ...opts }) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  return Promise.all(uniqueIds.map((userId) => notify({ userId, ...opts })));
}

// Helper: fetch active Owner + PM user IDs for an org.
export async function pmAndOwnerIds(organizationId) {
  const rows = await prisma.user.findMany({
    where: {
      organizationId,
      role: { in: ['OWNER', 'PM'] },
      deletedAt: null,
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// Generate a tracking token. base64url, 32 bytes.
export function newTrackingToken() {
  return crypto.randomBytes(24).toString('base64url');
}
