import crypto from 'crypto';

const SECRET = process.env.SESSION_SECRET || process.env.DATABASE_URL || 'dev-secret-not-for-production';

// Generate a signed token for a property + organization
export function signPropertyInvite(propertyId, organizationId) {
  const payload = Buffer.from(JSON.stringify({ p: propertyId, o: organizationId })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

// Verify a token and return the payload if valid, null otherwise
export function verifyPropertyInvite(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

  // Constant-time comparison
  try {
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.p || !decoded.o) return null;
    return { propertyId: decoded.p, organizationId: decoded.o };
  } catch {
    return null;
  }
}
