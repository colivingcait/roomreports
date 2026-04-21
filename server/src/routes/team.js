import { Router } from 'express';
import { hash } from '@node-rs/argon2';
import { generateIdFromEntropySize } from 'lucia';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { planLimit, wouldExceed } from '../../../shared/features.js';

const router = Router();
router.use(requireAuth);

// Password chars — excludes confusing 0/O/1/l/I
const PW_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PW_LOWER = 'abcdefghjkmnpqrstuvwxyz';
const PW_DIGIT = '23456789';

function generatePassword() {
  // 3 upper, 3 lower, 2 digit, shuffled
  const chars = [];
  for (let i = 0; i < 3; i++) chars.push(PW_UPPER[Math.floor(Math.random() * PW_UPPER.length)]);
  for (let i = 0; i < 3; i++) chars.push(PW_LOWER[Math.floor(Math.random() * PW_LOWER.length)]);
  for (let i = 0; i < 2; i++) chars.push(PW_DIGIT[Math.floor(Math.random() * PW_DIGIT.length)]);
  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ─── GET /api/team — list org members ───────────────────

router.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
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
    });

    return res.json({ users });
  } catch (error) {
    console.error('List team error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/team/invite — create user with generated password ──

router.post('/invite', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { email, name, role, customRole, propertyId, propertyIds } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: 'email and role are required' });
    }

    if (role === 'OWNER') {
      return res.status(400).json({ error: 'Cannot invite as OWNER' });
    }

    if (role === 'OTHER' && !customRole?.trim()) {
      return res.status(400).json({ error: 'customRole is required when role is OTHER' });
    }

    // Accept either propertyId (legacy, single) or propertyIds (array)
    const assignedPropertyIds = Array.isArray(propertyIds)
      ? propertyIds
      : propertyId ? [propertyId] : [];

    // Check if user already exists with this email (in any org)
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    // Enforce team-member limit for this org's plan (beta bypasses)
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { plan: true, isBeta: true },
    });
    const currentMembers = await prisma.user.count({
      where: { organizationId: req.user.organizationId, deletedAt: null },
    });
    if (wouldExceed(org, 'teamMembers', currentMembers)) {
      return res.status(403).json({
        error: 'Team member limit reached for your plan',
        code: 'PLAN_LIMIT_TEAM',
        limit: planLimit(org, 'teamMembers'),
        currentCount: currentMembers,
      });
    }

    // Generate password and hash it
    const password = generatePassword();
    const hashedPassword = await hash(password, {
      memoryCost: 19456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    });

    const userId = generateIdFromEntropySize(10);
    const displayName = name || email.split('@')[0];

    // Create user + property assignments in a transaction
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          id: userId,
          email,
          name: displayName,
          hashedPassword,
          role,
          customRole: role === 'OTHER' ? customRole.trim() : null,
          organizationId: req.user.organizationId,
        },
      });

      if (assignedPropertyIds.length > 0) {
        await tx.propertyAssignment.createMany({
          data: assignedPropertyIds.map((pid) => ({ userId: created.id, propertyId: pid })),
        });
      }

      return created;
    });

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        customRole: user.customRole,
      },
      password, // plaintext — displayed once, never stored
    });
  } catch (error) {
    console.error('Invite error:', error);
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

    const { role, customRole, propertyIds } = req.body;

    if (role !== undefined) {
      if (role === 'OTHER' && !customRole?.trim()) {
        return res.status(400).json({ error: 'customRole is required when role is OTHER' });
      }
      await prisma.user.update({
        where: { id: user.id },
        data: {
          role,
          customRole: role === 'OTHER' ? customRole.trim() : null,
        },
      });
    }

    if (propertyIds !== undefined) {
      await prisma.propertyAssignment.deleteMany({ where: { userId: user.id } });
      if (propertyIds.length > 0) {
        await prisma.propertyAssignment.createMany({
          data: propertyIds.map((pid) => ({ userId: user.id, propertyId: pid })),
        });
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

// ─── DELETE /api/team/:userId — deactivate user ─────────

router.delete('/:userId', requireRole('OWNER'), async (req, res) => {
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

    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot deactivate yourself' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    });

    // Invalidate all sessions for this user
    await prisma.session.deleteMany({ where: { userId: user.id } });

    return res.json({ success: true });
  } catch (error) {
    console.error('Deactivate user error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/team/:userId/reset-password ──────────────
// Generate a new password for an existing team member

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

    // Invalidate existing sessions
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

export default router;
