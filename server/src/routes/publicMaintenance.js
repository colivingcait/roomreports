// Public endpoints residents hit without auth: tracking a submitted
// maintenance ticket and unsubscribing from email updates.

import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

// ─── GET /api/public/track/:token — resident ticket status ──

router.get('/track/:token', async (req, res) => {
  try {
    const item = await prisma.maintenanceItem.findFirst({
      where: { trackingToken: req.params.token, deletedAt: null },
      include: {
        property: { select: { name: true } },
        room: { select: { label: true } },
      },
    });
    if (!item) return res.status(404).json({ error: 'Ticket not found' });

    return res.json({
      id: item.id,
      description: item.description,
      status: item.status,
      priority: item.priority,
      flagCategory: item.flagCategory,
      propertyName: item.property?.name,
      roomLabel: item.room?.label || null,
      createdAt: item.createdAt,
      resolvedAt: item.resolvedAt,
    });
  } catch (error) {
    console.error('Public track error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/public/track/:token/unsubscribe ───────────

router.post('/track/:token/unsubscribe', async (req, res) => {
  try {
    const item = await prisma.maintenanceItem.findFirst({
      where: { trackingToken: req.params.token, deletedAt: null },
    });
    if (!item) return res.status(404).json({ error: 'Ticket not found' });
    await prisma.maintenanceItem.update({
      where: { id: item.id },
      data: { reporterUnsubscribed: true },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('Public unsubscribe error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
