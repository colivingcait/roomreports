import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { propertyIdScope } from '../lib/scope.js';

const router = Router();
router.use(requireAuth);

// GET /api/dashboard — operational command center data
router.get('/', async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const scope = await propertyIdScope(req.user);

    // ─── Pending Review ─── Inspections with status SUBMITTED
    // Quarterly inspections are grouped per property+date as one entry
    const pendingInspections = await prisma.inspection.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: 'SUBMITTED',
        ...scope,
      },
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
        inspector: { select: { id: true, name: true, role: true, customRole: true } },
        items: {
          where: { flagCategory: { not: null } },
          select: { id: true, isMaintenance: true },
        },
      },
      orderBy: { completedAt: 'desc' },
    });

    const pendingReview = [];
    const quarterlyGroups = {};

    for (const i of pendingInspections) {
      if (i.type === 'QUARTERLY') {
        const dateKey = new Date(i.createdAt).toISOString().slice(0, 10);
        const groupKey = `${i.property?.id}-${dateKey}`;
        if (!quarterlyGroups[groupKey]) {
          quarterlyGroups[groupKey] = {
            id: `qgroup:${i.property?.id}:${dateKey}`,
            isGroup: true,
            type: 'QUARTERLY',
            propertyId: i.property?.id,
            propertyName: i.property?.name,
            roomId: null,
            roomLabel: null,
            dateKey,
            inspectorName: i.inspector?.name,
            inspectorRole: i.inspector?.role,
            completedAt: i.completedAt,
            createdAt: i.createdAt,
            flagCount: 0,
            maintenanceCount: 0,
            roomCount: 0,
          };
          pendingReview.push(quarterlyGroups[groupKey]);
        }
        quarterlyGroups[groupKey].roomCount += 1;
        quarterlyGroups[groupKey].flagCount += i.items.length;
        quarterlyGroups[groupKey].maintenanceCount += i.items.filter((it) => it.isMaintenance).length;
      } else {
        pendingReview.push({
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
        });
      }
    }

    // ─── Maintenance Overview ─── Stats + recent items
    const maintenanceCounts = await prisma.maintenanceItem.groupBy({
      by: ['status'],
      where: { organizationId: orgId, deletedAt: null, ...scope },
      _count: true,
    });

    // Open task count for combined total — orgwide tasks live with propertyId=null
    const taskOpenCount = await prisma.task.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { not: 'DONE' },
        ...(scope.propertyId
          ? { OR: [{ propertyId: null }, { propertyId: scope.propertyId }] }
          : {}),
      },
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
        ...scope,
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
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...(scope.propertyId ? { id: scope.propertyId } : {}),
      },
      include: {
        maintenanceItems: {
          where: {
            deletedAt: null,
            status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
          },
          select: { id: true, priority: true, flagCategory: true },
        },
        inspections: {
          where: { deletedAt: null },
          select: { id: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });

    const propertyHealth = properties.map((p) => {
      const openCount = p.maintenanceItems.length;

      // Health: Green (0-2), Yellow (3-5), Red (6+)
      let health = 'green';
      if (openCount >= 6) health = 'red';
      else if (openCount >= 3) health = 'yellow';

      return {
        id: p.id,
        name: p.name,
        openMaintenanceCount: openCount,
        lastInspectionDate: p.inspections[0]?.createdAt || null,
        health,
      };
    });

    // ─── Needs Attention ─── Overdue rooms (quarterly 90+ days or never)
    const allProperties = await prisma.property.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...(scope.propertyId ? { id: scope.propertyId } : {}),
      },
      include: {
        rooms: {
          where: { deletedAt: null },
          select: { id: true, label: true },
        },
      },
    });

    const overdueRooms = [];
    for (const prop of allProperties) {
      for (const room of prop.rooms) {
        const lastQuarterly = await prisma.inspection.findFirst({
          where: {
            roomId: room.id,
            type: 'QUARTERLY',
            organizationId: orgId,
            deletedAt: null,
            status: { in: ['SUBMITTED', 'REVIEWED'] },
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        const daysSince = lastQuarterly
          ? Math.floor((Date.now() - new Date(lastQuarterly.createdAt)) / (1000 * 60 * 60 * 24))
          : null;
        if (daysSince === null || daysSince >= 90) {
          overdueRooms.push({
            propertyId: prop.id,
            propertyName: prop.name,
            roomId: room.id,
            roomLabel: room.label,
            daysSince,
          });
        }
      }
    }

    const openMaintenance = statusCounts.OPEN + statusCounts.ASSIGNED + statusCounts.IN_PROGRESS;
    return res.json({
      pendingReview,
      maintenance: {
        statusCounts,
        total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        recentOpen: recentMaintenance,
      },
      tasks: { openCount: taskOpenCount },
      combinedOpen: openMaintenance + taskOpenCount,
      propertyHealth,
      overdueRooms,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
