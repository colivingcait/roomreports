import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// GET /api/dashboard — aggregated data for the PM dashboard
router.get('/', async (req, res) => {
  try {
    const orgId = req.user.organizationId;

    // Properties with room counts, last inspection, open maintenance count
    const properties = await prisma.property.findMany({
      where: { organizationId: orgId, deletedAt: null },
      include: {
        _count: {
          select: { rooms: { where: { deletedAt: null } } },
        },
        inspections: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
        maintenanceItems: {
          where: {
            deletedAt: null,
            status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
          },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const propertySummaries = properties.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      roomCount: p._count.rooms,
      lastInspectionDate: p.inspections[0]?.createdAt || null,
      openMaintenanceCount: p.maintenanceItems.length,
    }));

    // Recent 10 inspections
    const recentInspections = await prisma.inspection.findMany({
      where: { organizationId: orgId, deletedAt: null },
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
        inspector: { select: { id: true, name: true, role: true } },
        items: {
          where: { flagCategory: { not: null } },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const inspectionSummaries = recentInspections.map((i) => ({
      id: i.id,
      type: i.type,
      status: i.status,
      propertyName: i.property?.name,
      roomLabel: i.room?.label || null,
      inspectorName: i.inspector?.name,
      inspectorRole: i.inspector?.role,
      createdAt: i.createdAt,
      flagCount: i.items.length,
    }));

    // Top 5 open maintenance items (prioritized: Urgent > High > Medium > Low > null)
    const openMaintenance = await prisma.maintenanceItem.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
      },
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Sort by priority client-side for flexibility
    const priorityOrder = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
    const sorted = openMaintenance.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 4;
      const pb = priorityOrder[b.priority] ?? 4;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    const maintenanceSummaries = sorted.slice(0, 5).map((m) => ({
      id: m.id,
      description: m.description,
      zone: m.zone,
      status: m.status,
      priority: m.priority,
      flagCategory: m.flagCategory,
      propertyName: m.property?.name,
      roomLabel: m.room?.label || null,
      createdAt: m.createdAt,
    }));

    const totalOpenMaintenance = openMaintenance.length;

    return res.json({
      properties: propertySummaries,
      recentInspections: inspectionSummaries,
      openMaintenance: maintenanceSummaries,
      totalOpenMaintenance,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
