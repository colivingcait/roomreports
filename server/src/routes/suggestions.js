import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { sendEmail } from '../lib/email.js';

const router = Router();
router.use(requireAuth);

// POST /api/suggestions — persist a feature suggestion and notify the org Owner
router.post('/', async (req, res) => {
  try {
    const text = (req.body?.suggestion || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'suggestion is required' });
    }

    const created = await prisma.suggestion.create({
      data: {
        organizationId: req.user.organizationId,
        userId: req.user.id,
        userName: req.user.name,
        userEmail: req.user.email,
        text,
      },
    });

    // Notify the org Owner (email service is not yet configured, so log as pseudo-email)
    const owner = await prisma.user.findFirst({
      where: {
        organizationId: req.user.organizationId,
        role: 'OWNER',
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      select: { email: true, name: true },
    });

    if (owner) {
      await sendEmail({
        to: owner.email,
        subject: 'New feature suggestion on RoomReport',
        text: `New feature suggestion from ${req.user.name} <${req.user.email}>: ${text}`,
      });
    }

    return res.status(201).json({ suggestion: created });
  } catch (error) {
    console.error('Create suggestion error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/suggestions — list suggestions for the org (Owner/PM only)
router.get('/', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const suggestions = await prisma.suggestion.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({
      suggestions: suggestions.map((s) => ({
        id: s.id,
        suggestion: s.text,
        userName: s.userName,
        userEmail: s.userEmail,
        createdAt: s.createdAt,
      })),
    });
  } catch (error) {
    console.error('List suggestions error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
