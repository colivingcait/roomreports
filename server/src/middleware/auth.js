import { lucia } from '../lib/auth.js';
import prisma from '../lib/prisma.js';

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

  // Multi-org safety: if the user's active org membership has been
  // deactivated since they last logged in, repoint them to another
  // active membership. If none remain, log them out.
  let activeUser = user;
  try {
    const activeMembership = await prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: user.organizationId } },
      select: { status: true },
    });
    if (!activeMembership || activeMembership.status !== 'active') {
      const next = await prisma.organizationMember.findFirst({
        where: {
          userId: user.id,
          status: 'active',
          organization: { deletedAt: null },
        },
        orderBy: { acceptedAt: 'desc' },
      });
      if (next) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            organizationId: next.organizationId,
            role: next.role,
            customRole: next.customRole,
          },
        });
        activeUser = {
          ...user,
          organizationId: next.organizationId,
          role: next.role,
        };
      } else {
        // No active orgs left — invalidate the session and 401.
        await prisma.session.deleteMany({ where: { userId: user.id } });
        const blank = lucia.createBlankSessionCookie();
        res.setHeader('Set-Cookie', blank.serialize());
        return res.status(401).json({ error: 'Account deactivated' });
      }
    }
  } catch (err) {
    // If the membership table doesn't exist yet (fresh deploy with
    // schema not yet pushed), fall through to legacy behavior.
    console.error('[auth] org membership check skipped:', err.message);
  }

  req.user = activeUser;
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
