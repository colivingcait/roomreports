import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// GET /api/search?q=query — search across properties, inspections, maintenance
router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.json({ properties: [], inspections: [], maintenance: [] });
    }

    const query = q.trim();
    const orgId = req.user.organizationId;

    const [properties, inspections, maintenance] = await Promise.all([
      prisma.property.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { address: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, address: true },
        take: 5,
      }),

      prisma.inspection.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          OR: [
            { property: { name: { contains: query, mode: 'insensitive' } } },
            { room: { label: { contains: query, mode: 'insensitive' } } },
            { inspectorName: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          property: { select: { name: true } },
          room: { select: { label: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),

      prisma.maintenanceItem.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          OR: [
            { description: { contains: query, mode: 'insensitive' } },
            { zone: { contains: query, mode: 'insensitive' } },
            { property: { name: { contains: query, mode: 'insensitive' } } },
          ],
        },
        select: {
          id: true,
          description: true,
          zone: true,
          status: true,
          property: { select: { name: true } },
          room: { select: { label: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    return res.json({ properties, inspections, maintenance });
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
