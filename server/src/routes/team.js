import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

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

// ─── POST /api/team/invite — send invitation ────────────

router.post('/invite', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { email, role, propertyId, roomId } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: 'email and role are required' });
    }

    if (role === 'OWNER') {
      return res.status(400).json({ error: 'Cannot invite as OWNER' });
    }

    // Check if user already exists in this org
    const existing = await prisma.user.findFirst({
      where: { email, organizationId: req.user.organizationId },
    });
    if (existing) {
      return res.status(409).json({ error: 'User already in this organization' });
    }

    // Check for pending invite
    const pendingInvite = await prisma.invitation.findFirst({
      where: {
        email,
        organizationId: req.user.organizationId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (pendingInvite) {
      return res.status(409).json({ error: 'Invitation already pending for this email' });
    }

    const token = crypto.randomBytes(32).toString('hex');

    const invitation = await prisma.invitation.create({
      data: {
        email,
        role,
        token,
        organizationId: req.user.organizationId,
        propertyId: propertyId || null,
        roomId: roomId || null,
        invitedById: req.user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
      include: {
        organization: { select: { name: true } },
        property: { select: { name: true } },
        room: { select: { label: true } },
      },
    });

    // Build signup URL with token
    const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const signupUrl = `${baseUrl}/signup?invite=${token}`;

    // Log for now (email integration later)
    console.log(`[INVITE] ${email} invited as ${role} to ${invitation.organization.name}`);
    console.log(`[INVITE] Signup URL: ${signupUrl}`);

    return res.status(201).json({ invitation, signupUrl });
  } catch (error) {
    console.error('Invite error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/team/invites — list pending invitations ───

router.get('/invites', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const invitations = await prisma.invitation.findMany({
      where: {
        organizationId: req.user.organizationId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
        invitedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ invitations });
  } catch (error) {
    console.error('List invites error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/team/invites/:id — cancel invitation ───

router.delete('/invites/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const invitation = await prisma.invitation.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        acceptedAt: null,
      },
    });

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    await prisma.invitation.delete({ where: { id: invitation.id } });

    return res.json({ success: true });
  } catch (error) {
    console.error('Cancel invite error:', error);
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

    const { role, propertyIds } = req.body;

    // Update role if provided
    if (role !== undefined) {
      await prisma.user.update({
        where: { id: user.id },
        data: { role },
      });
    }

    // Update property assignments if provided
    if (propertyIds !== undefined) {
      // Remove existing assignments
      await prisma.propertyAssignment.deleteMany({
        where: { userId: user.id },
      });

      // Create new assignments
      if (propertyIds.length > 0) {
        await prisma.propertyAssignment.createMany({
          data: propertyIds.map((pid) => ({
            userId: user.id,
            propertyId: pid,
          })),
        });
      }
    }

    // Fetch updated user
    const updated = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
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

// ─── GET /api/team/invite-info/:token — public route ────

router.get('/invite-info/:token', async (req, res) => {
  try {
    const invitation = await prisma.invitation.findFirst({
      where: {
        token: req.params.token,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        organization: { select: { name: true } },
      },
    });

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found or expired' });
    }

    return res.json({
      email: invitation.email,
      role: invitation.role,
      organizationName: invitation.organization.name,
    });
  } catch (error) {
    console.error('Invite info error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
