import { Router } from 'express';
import crypto from 'crypto';
import { hash } from '@node-rs/argon2';
import { generateIdFromEntropySize } from 'lucia';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { planLimit, wouldExceed } from '../../../shared/features.js';
import { sendEmail } from '../lib/email.js';
import { notify } from '../lib/notifications.js';
import { appOrigin } from '../lib/appUrl.js';

const router = Router();
router.use(requireAuth);

const INVITE_TTL_DAYS = 7;

// Password chars — excludes confusing 0/O/1/l/I
const PW_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PW_LOWER = 'abcdefghjkmnpqrstuvwxyz';
const PW_DIGIT = '23456789';

function generatePassword() {
  const chars = [];
  for (let i = 0; i < 3; i++) chars.push(PW_UPPER[Math.floor(Math.random() * PW_UPPER.length)]);
  for (let i = 0; i < 3; i++) chars.push(PW_LOWER[Math.floor(Math.random() * PW_LOWER.length)]);
  for (let i = 0; i < 2; i++) chars.push(PW_DIGIT[Math.floor(Math.random() * PW_DIGIT.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function generateInviteToken() {
  return crypto.randomBytes(32).toString('base64url');
}


function roleHuman(role, customRole) {
  if (role === 'OTHER' && customRole) return customRole;
  return {
    OWNER: 'Owner',
    PM: 'Property Manager',
    CLEANER: 'Cleaner',
    HANDYPERSON: 'Handyperson',
    RESIDENT: 'Resident',
    OTHER: 'Team Member',
  }[role] || role;
}

async function sendInviteEmail({ invite, org, inviter, req }) {
  const link = `${appOrigin()}/signup?invite=${encodeURIComponent(invite.token)}`;
  const roleStr = roleHuman(invite.role, invite.customRole);
  const inviterName = inviter?.name || 'Your team';
  const orgName = org?.name || 'your team';

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#3B3634;background:#FAF8F5;">
      <h1 style="margin:0 0 12px;font-size:22px;color:#3B3634;">You've been invited to join ${orgName} on RoomReport</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
        ${escapeHtml(inviterName)} has invited you to join <strong>${escapeHtml(orgName)}</strong> as a <strong>${escapeHtml(roleStr)}</strong> on RoomReport.
      </p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#6B6865;">
        RoomReport is a property inspection and maintenance tracking tool.
      </p>
      <p style="margin:0 0 32px;">
        <a href="${link}" style="display:inline-block;background:#6B8F71;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;">Accept Invite</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#8A8583;">This invite expires in ${INVITE_TTL_DAYS} days.</p>
      <p style="margin:32px 0 0;font-size:12px;color:#8A8583;border-top:1px solid #E6E2DE;padding-top:16px;">RoomReport — roomreport.co</p>
    </div>
  `;

  const text =
    `${inviterName} has invited you to join ${orgName} as a ${roleStr} on RoomReport.\n\n` +
    `RoomReport is a property inspection and maintenance tracking tool.\n\n` +
    `Accept your invite: ${link}\n\n` +
    `This invite expires in ${INVITE_TTL_DAYS} days.\n\n` +
    `RoomReport — roomreport.co`;

  await sendEmail({
    to: invite.email,
    subject: `You've been invited to join ${orgName} on RoomReport`,
    text,
    html,
  });
}

// Friendly reminder / reactivation email — points to the login page.
// `kind` controls the headline: 'reminder' for active-member nudge,
// 'reactivated' for a just-reactivated user.
async function sendLoginLinkEmail({ user, org, kind, req }) {
  const origin = appOrigin();
  const link = `${origin}/login`;
  const orgName = org?.name || 'your team';
  const headline = kind === 'reactivated'
    ? `You've been reactivated on ${orgName}`
    : `You have access to ${orgName} on RoomReport`;
  const intro = kind === 'reactivated'
    ? `Your access to <strong>${escapeHtml(orgName)}</strong> on RoomReport has been restored. You can sign in with your existing email and password.`
    : `You have access to <strong>${escapeHtml(orgName)}</strong> on RoomReport. Sign in to view your tasks and properties.`;
  const subject = kind === 'reactivated'
    ? `You've been reactivated on ${orgName}`
    : `Your RoomReport access — ${orgName}`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#3B3634;background:#FAF8F5;">
      <h1 style="margin:0 0 12px;font-size:22px;color:#3B3634;">${escapeHtml(headline)}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">${intro}</p>
      <p style="margin:0 0 32px;">
        <a href="${link}" style="display:inline-block;background:#6B8F71;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;">Log in</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#8A8583;">
        Forgot your password? Use the "Forgot password?" link on the login page.
      </p>
      <p style="margin:32px 0 0;font-size:12px;color:#8A8583;border-top:1px solid #E6E2DE;padding-top:16px;">RoomReport — roomreport.co</p>
    </div>
  `;
  const text =
    `${headline}.\n\n` +
    `Log in at ${link}\n\n` +
    `Forgot your password? Use the "Forgot password?" link on the login page.\n\n` +
    `RoomReport — roomreport.co`;

  await sendEmail({ to: user.email, subject, text, html });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inviteStatus(inv) {
  if (inv.acceptedAt) return 'ACCEPTED';
  if (inv.revokedAt) return 'REVOKED';
  if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) return 'EXPIRED';
  return 'PENDING';
}

function inviteShape(inv) {
  return {
    id: inv.id,
    email: inv.email,
    name: inv.name,
    role: inv.role,
    customRole: inv.customRole,
    propertyIds: inv.propertyIds || [],
    status: inviteStatus(inv),
    createdAt: inv.createdAt,
    expiresAt: inv.expiresAt,
    acceptedAt: inv.acceptedAt,
    lastSentAt: inv.lastSentAt,
  };
}

// ─── GET /api/team — list org members + pending invites ─

router.get('/', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const [users, invitations] = await Promise.all([
      prisma.user.findMany({
        where: { organizationId: req.user.organizationId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          customRole: true,
          createdAt: true,
          deletedAt: true,
          propertyAssignments: {
            include: {
              property: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.invitation.findMany({
        where: {
          organizationId: req.user.organizationId,
          acceptedAt: null,
          revokedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return res.json({
      users,
      invitations: invitations.map(inviteShape),
    });
  } catch (error) {
    console.error('List team error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/team/invite — send an invitation email ──

router.post('/invite', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { email, name, role, customRole, propertyId, propertyIds, assignToAllProperties } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: 'email and role are required' });
    }

    if (role === 'OWNER') {
      return res.status(400).json({ error: 'Cannot invite as OWNER' });
    }

    if (role === 'OTHER' && !customRole?.trim()) {
      return res.status(400).json({ error: 'customRole is required when role is OTHER' });
    }

    let assignedPropertyIds = Array.isArray(propertyIds)
      ? propertyIds
      : propertyId ? [propertyId] : [];

    // "All current and future properties" — pre-populate with the current
    // property set so the invitee gets immediate access on accept; the
    // flag itself is what drives auto-assign on future property creation.
    if (assignToAllProperties) {
      const allProps = await prisma.property.findMany({
        where: { organizationId: req.user.organizationId, deletedAt: null },
        select: { id: true },
      });
      assignedPropertyIds = allProps.map((p) => p.id);
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists in this org
    const existingUser = await prisma.user.findFirst({
      where: { email: normalizedEmail, organizationId: req.user.organizationId },
    });
    if (existingUser) {
      return res.status(409).json({ error: 'A user with this email already exists in your organization' });
    }

    // Check if user exists in another org (prevents cross-org collision)
    const anyUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (anyUser) {
      // Already in THIS org → can't re-invite. Membership in another
      // org is fine — the invite-accept path will add a new
      // OrganizationMember row when they accept.
      const sameOrgMember = anyUser.organizationId === req.user.organizationId
        || await prisma.organizationMember.findFirst({
          where: {
            userId: anyUser.id,
            organizationId: req.user.organizationId,
            status: 'active',
          },
          select: { id: true },
        });
      if (sameOrgMember) {
        return res.status(409).json({ error: 'A user with this email is already on this team' });
      }
      // Otherwise fall through and create the invitation. The accept
      // handler will detect the existing account and add a membership
      // instead of creating a new user.
    }

    // If an active invite exists for this email in this org, reuse the row
    const existingInvite = await prisma.invitation.findFirst({
      where: {
        organizationId: req.user.organizationId,
        email: normalizedEmail,
        acceptedAt: null,
        revokedAt: null,
      },
    });

    // Team-member plan limit check: active members + pending invites
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { id: true, name: true, plan: true, isBeta: true },
    });
    const currentMembers = await prisma.user.count({
      where: { organizationId: req.user.organizationId, deletedAt: null },
    });
    const pendingInviteCount = await prisma.invitation.count({
      where: {
        organizationId: req.user.organizationId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    const headcount = currentMembers + pendingInviteCount;
    if (!existingInvite && wouldExceed(org, 'teamMembers', headcount)) {
      return res.status(403).json({
        error: 'Team member limit reached for your plan',
        code: 'PLAN_LIMIT_TEAM',
        limit: planLimit(org, 'teamMembers'),
        currentCount: headcount,
      });
    }

    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invitation = existingInvite
      ? await prisma.invitation.update({
          where: { id: existingInvite.id },
          data: {
            name: name || existingInvite.name,
            role,
            customRole: role === 'OTHER' ? customRole.trim() : null,
            propertyIds: assignedPropertyIds,
            assignToAllProperties: !!assignToAllProperties,
            token,
            expiresAt,
            lastSentAt: new Date(),
          },
        })
      : await prisma.invitation.create({
          data: {
            email: normalizedEmail,
            name: name || null,
            role,
            customRole: role === 'OTHER' ? customRole.trim() : null,
            organizationId: req.user.organizationId,
            propertyIds: assignedPropertyIds,
            assignToAllProperties: !!assignToAllProperties,
            invitedById: req.user.id,
            token,
            expiresAt,
            lastSentAt: new Date(),
          },
        });

    await sendInviteEmail({
      invite: invitation,
      org,
      inviter: req.user,
      req,
    });

    return res.status(201).json({ invitation: inviteShape(invitation) });
  } catch (error) {
    console.error('Invite error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/team/invitations/:token/accept-as-existing ──
// Accept a team invite when the invitee already has an account. The
// signup form blocks "email already in use" — this endpoint is for
// the already-logged-in case (e.g. an existing Owner gets invited
// as a Cleaner to a different org). Adds an OrganizationMember row
// and switches the user's active org to the inviting one.
router.post('/invitations/:token/accept-as-existing', async (req, res) => {
  try {
    // requireAuth would normally be applied, but this is a public
    // route mounted under /api/team which already has requireAuth.
    // Defensive: confirm req.user.
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const invite = await prisma.invitation.findUnique({
      where: { token: req.params.token },
    });
    if (!invite) return res.status(404).json({ error: 'Invalid invitation' });
    if (invite.acceptedAt) return res.status(400).json({ error: 'Invitation already accepted' });
    if (invite.revokedAt) return res.status(400).json({ error: 'Invitation has been revoked' });
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'Invitation has expired' });
    }
    const me = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true },
    });
    if (!me) return res.status(404).json({ error: 'User not found' });
    if (me.email.toLowerCase() !== invite.email.toLowerCase()) {
      return res.status(403).json({ error: 'This invitation was sent to a different email' });
    }

    const { ensureMembership, switchActiveOrg } = await import('../lib/orgMembership.js');
    await ensureMembership({
      userId: me.id,
      organizationId: invite.organizationId,
      role: invite.role,
      customRole: invite.customRole,
      invitedById: invite.invitedById,
    });
    // Property assignments come over with the invite.
    const propIds = Array.isArray(invite.propertyIds) ? invite.propertyIds : [];
    if (propIds.length > 0) {
      await prisma.propertyAssignment.createMany({
        data: propIds.map((pid) => ({ userId: me.id, propertyId: pid })),
        skipDuplicates: true,
      });
    }
    await prisma.invitation.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date(), status: 'ACCEPTED' },
    });
    // Switch the user's active org to the new one so the next
    // request lands them on the right dashboard.
    await switchActiveOrg(me.id, invite.organizationId);
    return res.json({ ok: true, organizationId: invite.organizationId });
  } catch (err) {
    console.error('accept-as-existing error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/team/invitations/:id/resend ──────────────

router.post('/invitations/:id/resend', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const invite = await prisma.invitation.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!invite) return res.status(404).json({ error: 'Invitation not found' });
    if (invite.acceptedAt) return res.status(400).json({ error: 'Invitation already accepted' });
    if (invite.revokedAt) return res.status(400).json({ error: 'Invitation has been revoked' });

    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const updated = await prisma.invitation.update({
      where: { id: invite.id },
      data: { token, expiresAt, lastSentAt: new Date() },
    });

    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { id: true, name: true },
    });

    await sendInviteEmail({ invite: updated, org, inviter: req.user, req });

    return res.json({ invitation: inviteShape(updated) });
  } catch (error) {
    console.error('Resend invite error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/team/invitations/:id — revoke ──────────

router.delete('/invitations/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const invite = await prisma.invitation.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!invite) return res.status(404).json({ error: 'Invitation not found' });
    if (invite.acceptedAt) return res.status(400).json({ error: 'Invitation already accepted' });

    await prisma.invitation.update({
      where: { id: invite.id },
      data: { revokedAt: new Date(), status: 'REVOKED' },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('Revoke invite error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/team/:userId — update role, assignments ───

router.put('/:userId', requireRole('OWNER'), async (req, res) => {
  try {
    const user = await prisma.user.findFirst({
      where: {
        id: req.params.userId,
        organizationId: req.user.organizationId,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot modify your own account here' });
    }

    const { role, customRole, propertyIds, name } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (role !== undefined) {
      if (role === 'OTHER' && !customRole?.trim()) {
        return res.status(400).json({ error: 'customRole is required when role is OTHER' });
      }
      data.role = role;
      data.customRole = role === 'OTHER' ? customRole.trim() : null;
    }
    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id: user.id }, data });
    }

    if (propertyIds !== undefined) {
      const previous = await prisma.propertyAssignment.findMany({
        where: { userId: user.id },
        select: { propertyId: true },
      });
      const previousIds = new Set(previous.map((p) => p.propertyId));
      await prisma.propertyAssignment.deleteMany({ where: { userId: user.id } });
      if (propertyIds.length > 0) {
        await prisma.propertyAssignment.createMany({
          data: propertyIds.map((pid) => ({ userId: user.id, propertyId: pid })),
        });
      }
      // Notify the user about newly-added properties (CLEANER / HANDYPERSON).
      const newlyAdded = propertyIds.filter((pid) => !previousIds.has(pid));
      if (newlyAdded.length > 0 && ['CLEANER', 'HANDYPERSON'].includes(user.role)) {
        try {
          const props = await prisma.property.findMany({
            where: { id: { in: newlyAdded } },
            select: { id: true, name: true },
          });
          const origin = appOrigin();
          await notify({
            userId: user.id,
            organizationId: req.user.organizationId,
            type: 'PROPERTY_ASSIGNED',
            title: `You've been assigned to ${props.length} propert${props.length === 1 ? 'y' : 'ies'}`,
            message: props.map((p) => p.name).join(', '),
            link: '/dashboard',
            email: {
              subject: `New property assignment${props.length > 1 ? 's' : ''}`,
              ctaLabel: 'Open dashboard',
              ctaHref: `${origin}/dashboard`,
              bodyHtml: `<p style="margin:0 0 12px;">You've been added to the following propert${props.length === 1 ? 'y' : 'ies'}:</p>
                <ul style="margin:0 0 12px;padding-left:20px;">${props.map((p) => `<li>${p.name}</li>`).join('')}</ul>`,
            },
          });
        } catch (e) {
          console.error('property assigned notification error:', e);
        }
      }
    }

    const updated = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        customRole: true,
        deletedAt: true,
        propertyAssignments: {
          include: { property: { select: { id: true, name: true } } },
        },
      },
    });

    return res.json({ user: updated });
  } catch (error) {
    console.error('Update team member error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/team/:userId — deactivate user from THIS org ──
// Multi-org aware: if the user has memberships in other orgs, only
// the membership row for the current org is marked DEACTIVATED so
// their access to other orgs is preserved. If this was their only
// remaining active org, fall back to the legacy soft-delete +
// session purge so they're effectively logged out.
router.delete('/:userId', requireRole('OWNER'), async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const targetUserId = req.params.userId;
    if (targetUserId === req.user.id) {
      return res.status(400).json({ error: 'Cannot deactivate yourself' });
    }

    const membership = await prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } },
    });
    if (!membership || membership.status !== 'active') {
      return res.status(404).json({ error: 'User not found in this organization' });
    }
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    // Other active orgs the user still belongs to.
    const otherActive = await prisma.organizationMember.findMany({
      where: {
        userId: targetUserId,
        status: 'active',
        organizationId: { not: orgId },
        organization: { deletedAt: null },
      },
      orderBy: { acceptedAt: 'desc' },
      select: { organizationId: true, role: true, customRole: true },
    });

    await prisma.organizationMember.update({
      where: { id: membership.id },
      data: { status: 'deactivated', deactivatedAt: new Date() },
    });

    if (otherActive.length === 0) {
      // Last org — soft-delete the user and purge sessions so they
      // can't keep using the app with stale data.
      await prisma.user.update({
        where: { id: targetUserId },
        data: { deletedAt: new Date() },
      });
      await prisma.session.deleteMany({ where: { userId: targetUserId } });
    } else if (targetUser.organizationId === orgId) {
      // User is currently active in this org — repoint their active
      // org to the next available membership so the next request
      // they make goes to a real org instead of a deactivated one.
      const next = otherActive[0];
      await prisma.user.update({
        where: { id: targetUserId },
        data: {
          organizationId: next.organizationId,
          role: next.role,
          customRole: next.customRole,
        },
      });
    }
    // Property assignments inside this org stay attached to userId;
    // they're naturally hidden because every query intersects with
    // the property's organizationId.

    return res.json({
      success: true,
      removedFromOrg: orgId,
      remainingOrgs: otherActive.length,
    });
  } catch (error) {
    console.error('Deactivate user error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/team/:userId/reactivate — restore a user to this org ──
// Multi-org aware: flip the membership row back to active. If the
// user was fully soft-deleted (single-org case), un-soft-delete and
// repoint their active org to this one.
router.post('/:userId/reactivate', requireRole('OWNER'), async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const targetUserId = req.params.userId;

    const membership = await prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } },
    });
    if (!membership) {
      return res.status(404).json({ error: 'No prior membership in this org' });
    }
    if (membership.status === 'active') {
      return res.status(400).json({ error: 'User is already active in this org' });
    }
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    // Plan-limit check: re-adding this user must not push us past the cap.
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { id: true, plan: true, isBeta: true },
    });
    const activeMembers = await prisma.user.count({
      where: { organizationId: req.user.organizationId, deletedAt: null },
    });
    if (wouldExceed(org, 'teamMembers', activeMembers)) {
      return res.status(403).json({
        error: 'Team member limit reached for your plan',
        code: 'PLAN_LIMIT_TEAM',
        limit: planLimit(org, 'teamMembers'),
        currentCount: activeMembers,
      });
    }

    // Flip membership back to active.
    await prisma.organizationMember.update({
      where: { id: membership.id },
      data: { status: 'active', deactivatedAt: null, acceptedAt: membership.acceptedAt || new Date() },
    });
    // If the user was fully soft-deleted (single-org case), restore
    // them and point their active org at this one.
    if (targetUser.deletedAt) {
      await prisma.user.update({
        where: { id: targetUserId },
        data: {
          deletedAt: null,
          organizationId: orgId,
          role: membership.role,
          customRole: membership.customRole,
        },
      });
    }
    const updated = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        customRole: true,
        deletedAt: true,
        propertyAssignments: {
          include: { property: { select: { id: true, name: true } } },
        },
      },
    });

    // Best-effort welcome-back email pointing at the login page.
    try {
      const org = await prisma.organization.findUnique({
        where: { id: req.user.organizationId },
        select: { name: true },
      });
      await sendLoginLinkEmail({ user: updated, org, kind: 'reactivated', req });
    } catch (e) {
      console.error('reactivate email error:', e);
    }

    return res.json({ user: updated });
  } catch (error) {
    console.error('Reactivate user error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/team/:userId/send-login-link — friendly reminder ─

router.post('/:userId/send-login-link', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const user = await prisma.user.findFirst({
      where: {
        id: req.params.userId,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { name: true },
    });
    await sendLoginLinkEmail({ user, org, kind: 'reminder', req });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Send login link error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/team/:userId/reset-password ──────────────

router.post('/:userId/reset-password', requireRole('OWNER'), async (req, res) => {
  try {
    const user = await prisma.user.findFirst({
      where: {
        id: req.params.userId,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const password = generatePassword();
    const hashedPassword = await hash(password, {
      memoryCost: 19456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { hashedPassword },
    });

    await prisma.session.deleteMany({ where: { userId: user.id } });

    return res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      password,
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Keep the old generatePassword export to make this module future-proof
export { generatePassword, generateIdFromEntropySize };
export default router;
