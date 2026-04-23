// Thin wrapper around whatever email transport is configured.
// Currently logs pseudo-emails to stdout (same mechanism used by the
// feature-suggestion notifier). If a real SMTP / transactional email
// provider is wired up later, update `send` here — call sites do not
// need to change.

export async function sendEmail({ to, subject, text, html }) {
  if (!to) return;
  const label = subject ? `[EMAIL] To: ${to} — ${subject}` : `[EMAIL] To: ${to}`;
  const body = html || text || '';
  console.log(`${label}\n${body}`);
}
