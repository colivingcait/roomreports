// Helpers for the OrganizationMember table — the junction that lets
// a single user belong to multiple organizations with a per-org role.
//
// The user's `organizationId` field still names their "active" org;
// every authenticated query continues to scope by that. Switching
// orgs updates the user's `organizationId` + `role` to match a
// membership row, so existing query code keeps working unchanged.

import prisma from './prisma.js';

// Backfill: every existing User who hasn't been added to the new
// OrganizationMember table gets one row representing their current
// org + role. Idempotent — safe to run on every server start.
export async function backfillMemberships() {
  try {
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, organizationId: true, role: true, customRole: true, createdAt: true },
    });
    if (users.length === 0) return { created: 0, total: 0 };
    const existing = await prisma.organizationMember.findMany({
      select: { userId: true, organizationId: true },
    });
    const existingKey = new Set(existing.map((m) => `${m.userId}|${m.organizationId}`));
    const toCreate = users
      .filter((u) => !existingKey.has(`${u.id}|${u.organizationId}`))
      .map((u) => ({
        userId: u.id,
        organizationId: u.organizationId,
        role: u.role,
        customRole: u.customRole,
        status: 'active',
        invitedAt: u.createdAt,
        acceptedAt: u.createdAt,
      }));
    if (toCreate.length === 0) return { created: 0, total: users.length };
    await prisma.organizationMember.createMany({ data: toCreate, skipDuplicates: true });
    console.log(`[orgMembership] backfilled ${toCreate.length} memberships`);
    return { created: toCreate.length, total: users.length };
  } catch (err) {
    // Most likely cause: schema hasn't been pushed yet on a fresh
    // deploy. Don't crash the server — the table will exist on the
    // next start.
    console.error('[orgMembership] backfill skipped:', err.message);
    return { created: 0, total: 0 };
  }
}

// Returns every active membership for a user, with the org name +
// role baked in. Used by /api/auth/orgs.
export async function listMemberships(userId) {
  const rows = await prisma.organizationMember.findMany({
    where: {
      userId,
      status: { in: ['active'] },
      organization: { deletedAt: null },
    },
    select: {
      id: true,
      role: true,
      customRole: true,
      status: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { invitedAt: 'asc' },
  });
  return rows.map((m) => ({
    membershipId: m.id,
    organizationId: m.organization.id,
    organizationName: m.organization.name,
    organizationSlug: m.organization.slug,
    role: m.role,
    customRole: m.customRole,
    status: m.status,
  }));
}

// Switch the user's active org to one they're a member of. Updates
// User.organizationId and User.role so subsequent requests scope to
// the new org. Returns the new active membership.
export async function switchActiveOrg(userId, organizationId) {
  const membership = await prisma.organizationMember.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  if (!membership || membership.status !== 'active') {
    throw new Error('You are not an active member of that organization');
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      organizationId,
      role: membership.role,
      customRole: membership.customRole,
    },
  });
  return membership;
}

// Add a membership for an existing user when they accept an invite
// from a different org. Idempotent — bumps status to active if a row
// already exists.
export async function ensureMembership({
  userId,
  organizationId,
  role,
  customRole = null,
  invitedById = null,
}) {
  return prisma.organizationMember.upsert({
    where: { userId_organizationId: { userId, organizationId } },
    create: {
      userId,
      organizationId,
      role,
      customRole,
      status: 'active',
      invitedById,
      invitedAt: new Date(),
      acceptedAt: new Date(),
    },
    update: {
      status: 'active',
      role,
      customRole,
      acceptedAt: new Date(),
    },
  });
}
