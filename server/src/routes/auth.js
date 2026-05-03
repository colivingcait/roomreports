import { Router } from 'express';
import crypto from 'crypto';
import { hash, verify } from '@node-rs/argon2';
import { generateIdFromEntropySize } from 'lucia';
import { generateState, generateCodeVerifier } from 'arctic';
import { lucia } from '../lib/auth.js';
import { google } from '../lib/oauth.js';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyPropertyInvite } from '../lib/propertyInvite.js';
import { notify, notifyMany, esc } from '../lib/notifications.js';
import { sendEmail } from '../lib/email.js';
import { appOrigin } from '../lib/appUrl.js';

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

// ─── GET /api/auth/invite/:token — team invite info (public) ──
// Returns name/email/role/org info for the invite token so the signup
// page can pre-fill the form. Surfaces EXPIRED / ACCEPTED / REVOKED
// states so the frontend can render the right messaging.

router.get('/invite/:token', async (req, res) => {
  try {
    const invite = await prisma.invitation.findUnique({
      where: { token: req.params.token },
      include: {
        organization: { select: { name: true } },
        invitedBy: { select: { name: true } },
      },
    });
    if (!invite) return res.status(404).json({ error: 'Invalid invitation link' });

    let status = 'PENDING';
    if (invite.acceptedAt) status = 'ACCEPTED';
    else if (invite.revokedAt) status = 'REVOKED';
    else if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) status = 'EXPIRED';

    // Tell the client whether the invited email already has an
    // account so the signup page can route them to a "Sign in to
    // accept" flow instead of the new-user signup form.
    const existingUser = await prisma.user.findUnique({
      where: { email: invite.email.toLowerCase() },
      select: { id: true },
    });
    return res.json({
      email: invite.email,
      name: invite.name,
      role: invite.role,
      customRole: invite.customRole,
      organizationName: invite.organization?.name,
      inviterName: invite.invitedBy?.name,
      status,
      expiresAt: invite.expiresAt,
      existingUser: !!existingUser,
    });
  } catch (error) {
    console.error('Invite info error:', error);
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
    const { email, password, name, organizationName, propertyInviteToken, teamInviteToken } = req.body;

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

    // Team member signup via email invite
    let teamInvite = null;
    if (teamInviteToken) {
      teamInvite = await prisma.invitation.findUnique({
        where: { token: teamInviteToken },
      });
      if (!teamInvite) {
        return res.status(400).json({ error: 'Invalid invitation link' });
      }
      if (teamInvite.acceptedAt) {
        return res.status(400).json({ error: 'Invitation has already been accepted' });
      }
      if (teamInvite.revokedAt) {
        return res.status(400).json({ error: 'Invitation has been revoked' });
      }
      if (teamInvite.expiresAt && new Date(teamInvite.expiresAt) < new Date()) {
        return res.status(400).json({ error: 'Invitation has expired' });
      }
      if (teamInvite.email.toLowerCase() !== String(email).toLowerCase()) {
        return res.status(400).json({ error: 'Email does not match the invitation' });
      }
    }

    // New org signup requires organizationName (non-invite)
    if (!inviteInfo && !teamInvite && !organizationName) {
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
      if (teamInvite) {
        const created = await tx.user.create({
          data: {
            id: userId,
            email,
            name,
            hashedPassword,
            role: teamInvite.role,
            customRole: teamInvite.customRole,
            organizationId: teamInvite.organizationId,
            assignToAllProperties: !!teamInvite.assignToAllProperties,
          },
        });
        const propIds = Array.isArray(teamInvite.propertyIds) ? teamInvite.propertyIds : [];
        if (propIds.length > 0) {
          await tx.propertyAssignment.createMany({
            data: propIds.map((pid) => ({ userId: created.id, propertyId: pid })),
          });
        }
        await tx.invitation.update({
          where: { id: teamInvite.id },
          data: { acceptedAt: new Date(), status: 'ACCEPTED' },
        });
        return created;
      }

      if (inviteInfo) {
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

    if (teamInvite) {
      try {
        await notifyInviteAccepted(teamInvite, user);
      } catch (e) {
        console.error('invite accepted notification error:', e);
      }
    }

    return res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

async function notifyInviteAccepted(invite, newUser) {
  if (!invite?.organizationId) return;
  const origin = appOrigin();

  // Notify the inviter plus every active OWNER in the org so the
  // account owner always sees these — even when a PM did the inviting.
  const owners = await prisma.user.findMany({
    where: {
      organizationId: invite.organizationId,
      role: 'OWNER',
      deletedAt: null,
    },
    select: { id: true },
  });
  const recipientIds = new Set(owners.map((o) => o.id));
  if (invite.invitedById) recipientIds.add(invite.invitedById);
  // Don't notify the new user themselves (e.g. an Owner accepting their
  // own invite, in case that ever happens).
  recipientIds.delete(newUser.id);
  if (recipientIds.size === 0) return;

  await notifyMany({
    userIds: [...recipientIds],
    organizationId: invite.organizationId,
    type: 'TEAM_INVITE_ACCEPTED',
    title: `${newUser.name} accepted the team invite`,
    message: `${newUser.name} <${newUser.email}> just joined as ${newUser.role}.`,
    link: '/team',
    email: {
      subject: `${newUser.name} accepted their RoomReport invite`,
      ctaLabel: 'View team',
      ctaHref: `${origin}/team`,
      bodyHtml: `<p style="margin:0 0 12px;"><strong>${esc(newUser.name)}</strong> (${esc(newUser.email)}) just created their account and joined as <strong>${esc(newUser.role)}</strong>.</p>`,
    },
  });
}

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
// ─── GET /api/auth/orgs — list memberships for current user ──
// Used by the sidebar org switcher. Active membership is whichever
// org matches the user's current `organizationId`.
router.get('/orgs', requireAuth, async (req, res) => {
  try {
    const { listMemberships } = await import('../lib/orgMembership.js');
    const memberships = await listMemberships(req.user.id);
    return res.json({
      memberships,
      activeOrganizationId: req.user.organizationId,
    });
  } catch (err) {
    console.error('list orgs error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/switch-org — set active org by membership ──
// Updates User.organizationId and User.role to the values from the
// membership row, so subsequent authenticated queries scope to the
// new org automatically.
router.post('/switch-org', requireAuth, async (req, res) => {
  try {
    const { organizationId } = req.body || {};
    if (!organizationId) return res.status(400).json({ error: 'organizationId required' });
    const { switchActiveOrg } = await import('../lib/orgMembership.js');
    const m = await switchActiveOrg(req.user.id, organizationId);
    return res.json({ ok: true, organizationId, role: m.role });
  } catch (err) {
    console.error('switch org error:', err);
    return res.status(400).json({ error: err.message || 'Could not switch org' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        customRole: true,
        organizationId: true,
        organization: { select: { id: true, name: true, slug: true, plan: true, isBeta: true, timezone: true } },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Lazy backfill: generate an org slug if none exists yet
    if (user.organization && !user.organization.slug) {
      const baseSlug = (user.organization.name || 'org')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'org';
      let slug = baseSlug;
      let n = 1;
      while (await prisma.organization.findUnique({ where: { slug } })) {
        n += 1;
        slug = `${baseSlug}-${n}`;
      }
      await prisma.organization.update({
        where: { id: user.organization.id },
        data: { slug },
      });
      user.organization.slug = slug;
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
router.get('/google', async (req, res) => {
  try {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const url = google.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']);

    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 10 * 1000, // 10 minutes
      sameSite: 'lax',
      path: '/',
    };
    res.cookie('google_oauth_state', state, cookieOpts);
    res.cookie('google_code_verifier', codeVerifier, cookieOpts);

    // If the signup flow passed an invite token, stash it so the
    // callback can attach the new/existing user to the right org/role.
    if (req.query.invite) {
      res.cookie('team_invite_token', String(req.query.invite), cookieOpts);
    }

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

    // Pick up a pending team-invite token from the cookie (set on /google)
    const teamInviteTokenCookie = req.cookies.team_invite_token;
    let teamInvite = null;
    if (teamInviteTokenCookie) {
      teamInvite = await prisma.invitation.findUnique({
        where: { token: teamInviteTokenCookie },
      });
      if (teamInvite) {
        const tooOld = teamInvite.expiresAt && new Date(teamInvite.expiresAt) < new Date();
        if (teamInvite.acceptedAt || teamInvite.revokedAt || tooOld) {
          teamInvite = null;
        } else if (teamInvite.email.toLowerCase() !== String(googleUser.email).toLowerCase()) {
          teamInvite = null;
        }
      }
      res.clearCookie('team_invite_token');
    }

    if (user) {
      // Link Google account if not already linked
      if (!user.googleId) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { googleId: googleUser.sub },
        });
      }
      // Existing user accepting a team invite via Google: add a
      // membership row instead of creating a new account, copy
      // property assignments, and switch their active org so they
      // land on the right dashboard.
      if (teamInvite) {
        const { ensureMembership, switchActiveOrg } = await import('../lib/orgMembership.js');
        await ensureMembership({
          userId: user.id,
          organizationId: teamInvite.organizationId,
          role: teamInvite.role,
          customRole: teamInvite.customRole,
          invitedById: teamInvite.invitedById,
        });
        const propIds = Array.isArray(teamInvite.propertyIds) ? teamInvite.propertyIds : [];
        if (propIds.length > 0) {
          await prisma.propertyAssignment.createMany({
            data: propIds.map((pid) => ({ userId: user.id, propertyId: pid })),
            skipDuplicates: true,
          });
        }
        await prisma.invitation.update({
          where: { id: teamInvite.id },
          data: { acceptedAt: new Date(), status: 'ACCEPTED' },
        });
        await switchActiveOrg(user.id, teamInvite.organizationId);
        try { await notifyInviteAccepted(teamInvite, user); } catch (e) { console.error(e); }
      }
    } else if (teamInvite) {
      // New user accepting a team invite: join the inviter's org
      const userId = generateIdFromEntropySize(10);
      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            id: userId,
            email: googleUser.email,
            name: googleUser.name || googleUser.email,
            googleId: googleUser.sub,
            role: teamInvite.role,
            customRole: teamInvite.customRole,
            organizationId: teamInvite.organizationId,
          },
        });
        const propIds = Array.isArray(teamInvite.propertyIds) ? teamInvite.propertyIds : [];
        if (propIds.length > 0) {
          await tx.propertyAssignment.createMany({
            data: propIds.map((pid) => ({ userId: created.id, propertyId: pid })),
          });
        }
        await tx.invitation.update({
          where: { id: teamInvite.id },
          data: { acceptedAt: new Date(), status: 'ACCEPTED' },
        });
        return created;
      });
      try { await notifyInviteAccepted(teamInvite, user); } catch (e) { console.error(e); }
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

// ─── Forgot password ────────────────────────────────────

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour


// POST /api/auth/forgot-password — { email }
// Always returns success to avoid leaking which emails exist.
router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email is required' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.deletedAt) {
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + RESET_TTL_MS);
      await prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt },
      });

      const resetUrl = `${appOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#3B3634;background:#FAF8F5;">
          <h1 style="margin:0 0 12px;font-size:22px;color:#3B3634;">Reset your RoomReport password</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
            Click the link below to reset your password. This link expires in 1 hour.
          </p>
          <p style="margin:0 0 32px;">
            <a href="${resetUrl}" style="display:inline-block;background:#6B8F71;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;">Reset password</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;color:#8A8583;">
            If you didn't request this, you can ignore this email.
          </p>
          <p style="margin:32px 0 0;font-size:12px;color:#8A8583;border-top:1px solid #E6E2DE;padding-top:16px;">RoomReport — roomreport.co</p>
        </div>
      `;
      const text =
        `Reset your RoomReport password.\n\n` +
        `Click the link below to reset your password. This link expires in 1 hour.\n\n` +
        `${resetUrl}\n\n` +
        `If you didn't request this, you can ignore this email.\n\n` +
        `RoomReport — roomreport.co`;

      sendEmail({
        to: user.email,
        subject: 'Reset your RoomReport password',
        text,
        html,
      }).catch((e) => console.error('forgot-password email error:', e));
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('Forgot password error:', error);
    // Same generic response — don't surface internal errors back.
    return res.json({ ok: true });
  }
});

// GET /api/auth/reset-password/:token — token validity check
router.get('/reset-password/:token', async (req, res) => {
  try {
    const tok = await prisma.passwordResetToken.findUnique({
      where: { token: req.params.token },
    });
    const valid = tok && !tok.usedAt && new Date(tok.expiresAt) > new Date();
    return res.json({ valid: !!valid });
  } catch (error) {
    console.error('Reset-password token check error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/reset-password — { token, password }
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ error: 'token and password are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const tok = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });
    if (!tok || tok.usedAt || new Date(tok.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'Reset link is invalid or expired' });
    }
    if (!tok.user || tok.user.deletedAt) {
      return res.status(400).json({ error: 'Reset link is invalid or expired' });
    }

    const hashedPassword = await hash(password, {
      memoryCost: 19456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    });

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: tok.userId },
        data: { hashedPassword },
      });
      await tx.passwordResetToken.update({
        where: { id: tok.id },
        data: { usedAt: new Date() },
      });
      // Invalidate any other unused tokens for this user.
      await tx.passwordResetToken.updateMany({
        where: { userId: tok.userId, usedAt: null, id: { not: tok.id } },
        data: { usedAt: new Date() },
      });
      // Wipe existing sessions so the password change takes effect everywhere.
      await tx.session.deleteMany({ where: { userId: tok.userId } });
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
