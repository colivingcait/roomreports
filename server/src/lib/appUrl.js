// Canonical helper for the email/notification base URL.
// Pull from APP_URL when set; in production fall back to the live
// app domain so missing env config doesn't produce broken links.
export function appOrigin() {
  const fromEnv = process.env.APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') return 'https://app.roomreport.co';
  return 'http://localhost:5173';
}
