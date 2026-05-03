export function appOrigin() {
  const fromEnv = process.env.APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'https://app.roomreport.co';
}
