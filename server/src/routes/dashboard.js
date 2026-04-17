import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// GET /api/dashboard — operational command center data
router.get('/', async (req, res) => {
  try {
    const orgId = req.user.organizationId;

    // ─── Pending Review ─── Inspections with status SUBMITTED
    const pendingInspections = await prisma.inspection.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: 'SUBMITTED',
      },
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
        inspector: { select: { id: true, name: true, role: true } },
        items: {
          where: { flagCategory: { not: null } },
          select: { id: true, isMaintenance: true },
        },
      },
      orderBy: { completedAt: 'desc' },
    });

    const pendingReview = pendingInspections.map((i) => ({
      id: i.id,
      type: i.type,
      propertyId: i.property?.id,
      propertyName: i.property?.name,
      roomId: i.room?.id || null,
      roomLabel: i.room?.label || null,
      inspectorName: i.inspector?.name,
      inspectorRole: i.inspector?.role,
      completedAt: i.completedAt,
      createdAt: i.createdAt,
      flagCount: i.items.length,
      maintenanceCount: i.items.filter((it) => it.isMaintenance).length,
    }));

    // ─── Maintenance Overview ─── Stats + recent items
    const maintenanceCounts = await prisma.maintenanceItem.groupBy({
      by: ['status'],
      where: { organizationId: orgId, deletedAt: null },
      _count: true,
    });

    const statusCounts = { OPEN: 0, ASSIGNED: 0, IN_PROGRESS: 0, RESOLVED: 0 };
    for (const c of maintenanceCounts) {
      statusCounts[c.status] = c._count;
    }

    // Recent/urgent open maintenance items (top 5)
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

    const priorityOrder = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
    const sorted = openMaintenance.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 4;
      const pb = priorityOrder[b.priority] ?? 4;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    const recentMaintenance = sorted.slice(0, 5).map((m) => ({
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

    // ─── Property Health ─── Per-property open maintenance
    const properties = await prisma.property.findMany({
      where: { organizationId: orgId, deletedAt: null },
      include: {
        maintenanceItems: {
          where: {
            deletedAt: null,
            status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
          },
          select: { id: true, priority: true, flagCategory: true },
        },
        inspections: {
          where: { deletedAt: null, status: 'SUBMITTED' },
          select: { id: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const propertyHealth = properties.map((p) => {
      const openCount = p.maintenanceItems.length;
      const urgentCount = p.maintenanceItems.filter((m) => m.priority === 'Urgent').length;
      const safetyCount = p.maintenanceItems.filter((m) => m.flagCategory === 'Safety').length;
      const pestCount = p.maintenanceItems.filter((m) => m.flagCategory === 'Pest').length;

      // Health score: green/yellow/red based on open maintenance
      let health = 'healthy';
      if (urgentCount > 0 || safetyCount > 0 || pestCount > 0 || openCount >= 5) {
        health = 'attention';
      } else if (openCount >= 1) {
        health = 'watch';
      }

      return {
        id: p.id,
        name: p.name,
        openMaintenanceCount: openCount,
        urgentCount,
        pendingReviewCount: p.inspections.length,
        health,
      };
    });

    return res.json({
      pendingReview,
      maintenance: {
        statusCounts,
        total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        recentOpen: recentMaintenance,
      },
      propertyHealth,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
