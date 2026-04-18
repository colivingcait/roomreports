import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// POST /api/suggestions — submit a feature suggestion
router.post('/', async (req, res) => {
  try {
    const { suggestion } = req.body;
    if (!suggestion || !suggestion.trim()) {
      return res.status(400).json({ error: 'suggestion is required' });
    }

    const created = await prisma.featureSuggestion.create({
      data: {
        suggestion: suggestion.trim(),
        userName: req.user.name,
        userEmail: req.user.email,
        organizationId: req.user.organizationId,
      },
    });

    return res.status(201).json({ suggestion: created });
  } catch (error) {
    console.error('Create suggestion error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/suggestions — list suggestions for this org (OWNER/PM only)
router.get('/', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const suggestions = await prisma.featureSuggestion.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ suggestions });
  } catch (error) {
    console.error('List suggestions error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
