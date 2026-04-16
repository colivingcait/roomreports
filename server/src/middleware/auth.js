import { lucia } from '../lib/auth.js';

export async function requireAuth(req, res, next) {
  const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');
  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { session, user } = await lucia.validateSession(sessionId);
  if (!session) {
    const blankCookie = lucia.createBlankSessionCookie();
    res.setHeader('Set-Cookie', blankCookie.serialize());
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Refresh cookie if session was extended
  if (session.fresh) {
    const sessionCookie = lucia.createSessionCookie(session.id);
    res.setHeader('Set-Cookie', sessionCookie.serialize());
  }

  req.user = user;
  req.session = session;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
