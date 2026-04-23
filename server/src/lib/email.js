// Shared email transport for the app.
//
// Uses SendGrid when SENDGRID_API_KEY / SENDGRID_FROM_EMAIL are set.
// When either is missing we fall back to logging the message to stdout
// so local dev and test environments still see what would have shipped
// — deploys that want real delivery just need the env vars populated.

import sgMail from '@sendgrid/mail';

const apiKey = process.env.SENDGRID_API_KEY;
const fromEmail = process.env.SENDGRID_FROM_EMAIL;
const fromName = process.env.SENDGRID_FROM_NAME || 'RoomReport';

let configured = false;
if (apiKey) {
  sgMail.setApiKey(apiKey);
  configured = true;
}

/**
 * Send an email.
 * @param {object} opts
 * @param {string} opts.to        recipient address
 * @param {string} opts.subject   subject line
 * @param {string} [opts.text]    plain-text body
 * @param {string} [opts.html]    HTML body (defaults to text)
 * @param {string} [opts.replyTo] optional reply-to
 * @returns {Promise<{sent: boolean, skipped?: string, error?: string}>}
 */
export async function sendEmail({ to, subject, text, html, replyTo }) {
  if (!to) return { sent: false, skipped: 'no-recipient' };

  if (!configured || !fromEmail) {
    const label = subject ? `[EMAIL:dev] To: ${to} — ${subject}` : `[EMAIL:dev] To: ${to}`;
    console.log(`${label}\n${html || text || ''}`);
    console.warn(
      '[email] SENDGRID_API_KEY / SENDGRID_FROM_EMAIL not set — message logged only.',
    );
    return { sent: false, skipped: 'sendgrid-not-configured' };
  }

  const msg = {
    to,
    from: { email: fromEmail, name: fromName },
    subject: subject || '(no subject)',
    text: text || (html ? stripTags(html) : ''),
    html: html || escapeToHtml(text || ''),
  };
  if (replyTo) msg.replyTo = replyTo;

  try {
    await sgMail.send(msg);
    return { sent: true };
  } catch (err) {
    // SendGrid returns detailed errors on `response.body.errors`; surface
    // the most useful bits without spamming the whole payload.
    const detail = err?.response?.body?.errors?.[0]?.message || err?.message || String(err);
    console.error(`[email] SendGrid send failed for ${to}: ${detail}`);
    return { sent: false, error: detail };
  }
}

function escapeToHtml(text) {
  return `<pre style="font-family:inherit;white-space:pre-wrap;">${String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</pre>`;
}

function stripTags(html) {
  return String(html).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
