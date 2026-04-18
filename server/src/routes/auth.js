import { Router } from 'express';
import { hash, verify } from '@node-rs/argon2';
import { generateIdFromEntropySize } from 'lucia';
import { generateState, generateCodeVerifier } from 'arctic';
import { lucia } from '../lib/auth.js';
import { google } from '../lib/oauth.js';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyPropertyInvite } from '../lib/propertyInvite.js';

const router = Router();

// ─── GET /api/auth/join/:slug — friendly URL for residents ──
// Resolves a slug (derived from property name + address) to an invite token.
// Public endpoint.

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

router.get('/join/:slug', async (req, res) => {
  try {
    const target = req.params.slug.toLowerCase();

    const properties = await prisma.property.findMany({
      where: { deletedAt: null },
      include: { organization: { select: { name: true } } },
    });

    // Try matching by name slug first, then by (address + name) slug
    let match = properties.find((p) => slugify(p.name) === target);
    if (!match) {
      match = properties.find((p) => slugify(p.address + p.name) === target);
    }
    if (!match) {
      // Try address-number + name (e.g. "1939candace" from "1939 Main St" + "Candace")
      match = properties.find((p) => {
        const addrNum = (p.address || '').match(/\d+/)?.[0] || '';
        return slugify(addrNum + p.name) === target;
      });
    }

    if (!match) return res.status(404).json({ error: 'Property not found' });

    const { signPropertyInvite } = await import('../lib/propertyInvite.js');
    const token = signPropertyInvite(match.id, match.organizationId);
    return res.json({
      token,
      propertyName: match.name,
      organizationName: match.organization.name,
    });
  } catch (error) {
    console.error('Join slug error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/property-invite/:token — public endpoint ──
// Returns property/org info so the signup page knows who's being invited

router.get('/property-invite/:token', async (req, res) => {
  try {
    const info = verifyPropertyInvite(req.params.token);
    if (!info) return res.status(400).json({ error: 'Invalid invitation link' });

    const property = await prisma.property.findFirst({
      where: { id: info.propertyId, organizationId: info.organizationId, deletedAt: null },
      include: { organization: { select: { name: true } } },
    });
    if (!property) return res.status(404).json({ error: 'Property no longer exists' });

    return res.json({
      propertyName: property.name,
      organizationName: property.organization.name,
    });
  } catch (error) {
    console.error('Property invite info error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/signup ──────────────────────────────
// Creates a new Organization + User (OWNER role), returns session.
//
// curl -X POST http://localhost:3000/api/auth/signup \
//   -H "Content-Type: application/json" \
//   -d '{"email":"owner@example.com","password":"password123","name":"Jane Doe","organizationName":"Acme Coliving"}'
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name, organizationName, propertyInviteToken } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password, and name are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Resident signup via QR code
    let inviteInfo = null;
    if (propertyInviteToken) {
      inviteInfo = verifyPropertyInvite(propertyInviteToken);
      if (!inviteInfo) {
        return res.status(400).json({ error: 'Invalid or expired invitation link' });
      }
      // Verify property still exists
      const property = await prisma.property.findFirst({
        where: {
          id: inviteInfo.propertyId,
          organizationId: inviteInfo.organizationId,
          deletedAt: null,
        },
      });
      if (!property) {
        return res.status(400).json({ error: 'Property no longer exists' });
      }
    }

    // New org signup requires organizationName (non-resident)
    if (!inviteInfo && !organizationName) {
      return res.status(400).json({ error: 'organizationName is required' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const hashedPassword = await hash(password, {
      memoryCost: 19456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    });

    const userId = generateIdFromEntropySize(10);

    const user = await prisma.$transaction(async (tx) => {
      if (inviteInfo) {
        // Resident signup: join existing organization as RESIDENT
        const created = await tx.user.create({
          data: {
            id: userId,
            email,
            name,
            hashedPassword,
            role: 'RESIDENT',
            organizationId: inviteInfo.organizationId,
          },
        });
        // Assign to property
        await tx.propertyAssignment.create({
          data: { userId: created.id, propertyId: inviteInfo.propertyId },
        });
        return created;
      }

      // New org signup as OWNER
      const org = await tx.organization.create({
        data: { name: organizationName },
      });
      return tx.user.create({
        data: {
          id: userId,
          email,
          name,
          hashedPassword,
          role: 'OWNER',
          organizationId: org.id,
        },
      });
    });

    const session = await lucia.createSession(user.id, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    res.setHeader('Set-Cookie', sessionCookie.serialize());

    return res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/login ───────────────────────────────
// Validates email/password, returns session.
//
// curl -X POST http://localhost:3000/api/auth/login \
//   -H "Content-Type: application/json" \
//   -d '{"email":"owner@example.com","password":"password123"}'
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.hashedPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.deletedAt) {
      return res.status(401).json({ error: 'Account has been deactivated' });
    }

    const validPassword = await verify(user.hashedPassword, password, {
      memoryCost: 19456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    });
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const session = await lucia.createSession(user.id, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    res.setHeader('Set-Cookie', sessionCookie.serialize());

    return res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/logout ──────────────────────────────
// Clears session.
//
// curl -X POST http://localhost:3000/api/auth/logout \
//   -H "Cookie: auth_session=<session_id>"
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await lucia.invalidateSession(req.session.id);
    const blankCookie = lucia.createBlankSessionCookie();
    res.setHeader('Set-Cookie', blankCookie.serialize());
    return res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/me ───────────────────────────────────
// Returns current user + organization (or 401).
//
// curl http://localhost:3000/api/auth/me \
//   -H "Cookie: auth_session=<session_id>"
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        organizationId: true,
        organization: { select: { id: true, name: true } },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user });
  } catch (error) {
    console.error('Me error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/google ───────────────────────────────
// Redirects to Google OAuth consent screen.
//
// curl -v http://localhost:3000/api/auth/google
router.get('/google', async (_req, res) => {
  try {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const url = google.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']);

    res.cookie('google_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 10 * 1000, // 10 minutes
      sameSite: 'lax',
      path: '/',
    });
    res.cookie('google_code_verifier', codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 10 * 1000,
      sameSite: 'lax',
      path: '/',
    });

    return res.redirect(url.toString());
  } catch (error) {
    console.error('Google OAuth init error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/google/callback ──────────────────────
// Handles Google callback, creates or links user, returns session.
//
// (Called by Google redirect, not directly by client)
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const storedState = req.cookies.google_oauth_state;
    const storedCodeVerifier = req.cookies.google_code_verifier;

    if (!code || !state || !storedState || state !== storedState) {
      return res.status(400).json({ error: 'Invalid OAuth callback' });
    }

    const tokens = await google.validateAuthorizationCode(code, storedCodeVerifier);
    const accessToken = tokens.accessToken();

    const googleUserRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const googleUser = await googleUserRes.json();

    if (!googleUser.sub || !googleUser.email) {
      return res.status(400).json({ error: 'Failed to get Google user info' });
    }

    // Check if user already exists by googleId or email
    let user = await prisma.user.findFirst({
      where: {
        OR: [{ googleId: googleUser.sub }, { email: googleUser.email }],
      },
    });

    if (user) {
      // Link Google account if not already linked
      if (!user.googleId) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { googleId: googleUser.sub },
        });
      }
    } else {
      // New user via Google — create org + user
      const userId = generateIdFromEntropySize(10);
      user = await prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { name: `${googleUser.name}'s Organization` },
        });

        return tx.user.create({
          data: {
            id: userId,
            email: googleUser.email,
            name: googleUser.name || googleUser.email,
            googleId: googleUser.sub,
            role: 'OWNER',
            organizationId: org.id,
          },
        });
      });
    }

    const session = await lucia.createSession(user.id, {});
    const sessionCookie = lucia.createSessionCookie(session.id);

    // Clear OAuth cookies
    res.clearCookie('google_oauth_state');
    res.clearCookie('google_code_verifier');
    res.setHeader('Set-Cookie', sessionCookie.serialize());

    // Redirect to frontend after successful auth
    return res.redirect('/');
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
