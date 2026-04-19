import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// POST /api/suggestions — log a feature suggestion to the server console
router.post('/', async (req, res) => {
  try {
    const { suggestion } = req.body;
    if (!suggestion || !suggestion.trim()) {
      return res.status(400).json({ error: 'suggestion is required' });
    }

    console.log(
      `[SUGGESTION] ${req.user.name} <${req.user.email}> (org ${req.user.organizationId}): ${suggestion.trim()}`
    );

    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error('Create suggestion error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/suggestions — disabled until persistence is added
router.get('/', requireRole('OWNER', 'PM'), async (_req, res) => {
  return res.json({ suggestions: [] });
});

export default router;
