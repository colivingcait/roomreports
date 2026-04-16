import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { generateChecklist, ROOM_TYPES } from '../lib/checklist.js';

const router = Router();
router.use(requireAuth);

// ─── Permission helpers ─────────────────────────────────

const TYPE_PERMISSIONS = {
  OWNER: ['COMMON_AREA', 'ROOM_TURN', 'QUARTERLY', 'RESIDENT_SELF_CHECK', 'MOVE_IN_OUT'],
  PM: ['COMMON_AREA', 'ROOM_TURN', 'QUARTERLY', 'RESIDENT_SELF_CHECK', 'MOVE_IN_OUT'],
  CLEANER: ['COMMON_AREA', 'ROOM_TURN'],
  RESIDENT: ['RESIDENT_SELF_CHECK'],
};

async function verifyPropertyAccess(userId, role, propertyId, organizationId) {
  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId, deletedAt: null },
    include: {
      rooms: { where: { deletedAt: null } },
      kitchens: { where: { deletedAt: null } },
      bathrooms: { where: { deletedAt: null } },
    },
  });

  if (!property) return { error: 'Property not found', status: 404 };

  // Cleaners must be assigned to the property
  if (role === 'CLEANER') {
    const assignment = await prisma.propertyAssignment.findFirst({
      where: { userId, propertyId },
    });
    if (!assignment) return { error: 'Not assigned to this property', status: 403 };
  }

  return { property };
}

// ─── POST /api/inspections — create new inspection ──────

router.post('/', async (req, res) => {
  try {
    const { type, propertyId, roomId } = req.body;
    const { role, organizationId } = req.user;

    if (!type || !propertyId) {
      return res.status(400).json({ error: 'type and propertyId are required' });
    }

    // Check type permission
    const allowed = TYPE_PERMISSIONS[role] || [];
    if (!allowed.includes(type)) {
      return res.status(403).json({ error: `${role} cannot create ${type} inspections` });
    }

    // Verify property access
    const access = await verifyPropertyAccess(req.user.id, role, propertyId, organizationId);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const { property } = access;

    // Validate room requirement
    let room = null;
    if (ROOM_TYPES.includes(type)) {
      if (!roomId) {
        return res.status(400).json({ error: `roomId is required for ${type} inspections` });
      }
      room = await prisma.room.findFirst({
        where: { id: roomId, propertyId, deletedAt: null },
      });
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }
    }

    // Generate checklist items
    const checklistItems = generateChecklist(type, property, room);

    // Create inspection with items in a transaction
    const inspection = await prisma.inspection.create({
      data: {
        type,
        propertyId,
        roomId: room?.id || null,
        inspectorId: req.user.id,
        inspectorName: req.user.name,
        inspectorRole: role,
        organizationId,
        items: {
          create: checklistItems.map((item) => ({
            zone: item.zone,
            text: item.text,
            options: item.options,
            status: item.status,
          })),
        },
      },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        property: { select: { id: true, name: true, address: true } },
        room: { select: { id: true, label: true } },
      },
    });

    return res.status(201).json({ inspection });
  } catch (error) {
    console.error('Create inspection error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/inspections — list with filters ───────────

router.get('/', async (req, res) => {
  try {
    const { propertyId, roomId, type, status, startDate, endDate } = req.query;

    const where = {
      organizationId: req.user.organizationId,
      deletedAt: null,
    };

    if (propertyId) where.propertyId = propertyId;
    if (roomId) where.roomId = roomId;
    if (type) where.type = type;
    if (status) where.status = status;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const inspections = await prisma.inspection.findMany({
      where,
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ inspections });
  } catch (error) {
    console.error('List inspections error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/inspections/:id — get with all items ──────

router.get('/:id', async (req, res) => {
  try {
    const inspection = await prisma.inspection.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        property: { select: { id: true, name: true, address: true } },
        room: { select: { id: true, label: true } },
        inspector: { select: { id: true, name: true, role: true } },
      },
    });

    if (!inspection) {
      return res.status(404).json({ error: 'Inspection not found' });
    }

    return res.json({ inspection });
  } catch (error) {
    console.error('Get inspection error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/inspections/:id — update metadata ────────

router.put('/:id', async (req, res) => {
  try {
    const inspection = await prisma.inspection.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });

    if (!inspection) {
      return res.status(404).json({ error: 'Inspection not found' });
    }

    if (inspection.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Can only update DRAFT inspections' });
    }

    const { type } = req.body;
    const updated = await prisma.inspection.update({
      where: { id: inspection.id },
      data: { ...(type !== undefined && { type }) },
    });

    return res.json({ inspection: updated });
  } catch (error) {
    console.error('Update inspection error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/inspections/:id/items/:itemId — auto-save ─

router.put('/:id/items/:itemId', async (req, res) => {
  try {
    const inspection = await prisma.inspection.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });

    if (!inspection) {
      return res.status(404).json({ error: 'Inspection not found' });
    }

    if (inspection.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Can only update items on DRAFT inspections' });
    }

    const item = await prisma.inspectionItem.findFirst({
      where: { id: req.params.itemId, inspectionId: inspection.id },
    });

    if (!item) {
      return res.status(404).json({ error: 'Inspection item not found' });
    }

    const { status, flagCategory, note, isMaintenance } = req.body;
    const updated = await prisma.inspectionItem.update({
      where: { id: item.id },
      data: {
        ...(status !== undefined && { status }),
        ...(flagCategory !== undefined && { flagCategory }),
        ...(note !== undefined && { note }),
        ...(isMaintenance !== undefined && { isMaintenance }),
      },
    });

    return res.json({ item: updated });
  } catch (error) {
    console.error('Update inspection item error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/inspections/:id/submit ───────────────────

router.post('/:id/submit', async (req, res) => {
  try {
    const inspection = await prisma.inspection.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
      include: {
        items: true,
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
      },
    });

    if (!inspection) {
      return res.status(404).json({ error: 'Inspection not found' });
    }

    if (inspection.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Inspection already submitted' });
    }

    // Check that all items have a status set
    const incomplete = inspection.items.filter((i) => !i.status);
    if (incomplete.length > 0) {
      return res.status(400).json({
        error: `${incomplete.length} item(s) have not been completed`,
        incompleteItems: incomplete.map((i) => i.id),
      });
    }

    // Find items flagged for maintenance
    const maintenanceItems = inspection.items.filter((i) => i.isMaintenance);

    // Submit in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update inspection status
      const updated = await tx.inspection.update({
        where: { id: inspection.id },
        data: {
          status: 'SUBMITTED',
          completedAt: new Date(),
        },
      });

      // Create maintenance items for flagged items
      const createdMaintenance = [];
      for (const item of maintenanceItems) {
        const mi = await tx.maintenanceItem.create({
          data: {
            inspectionItemId: item.id,
            inspectionId: inspection.id,
            propertyId: inspection.propertyId,
            roomId: inspection.roomId,
            organizationId: inspection.organizationId,
            description: item.text,
            zone: item.zone,
            flagCategory: item.flagCategory || 'General',
            note: item.note,
          },
        });
        createdMaintenance.push(mi);
      }

      return { inspection: updated, maintenanceItems: createdMaintenance };
    });

    // Build notification summary (logged for now, email integration later)
    const flaggedItems = inspection.items.filter((i) => i.flagCategory);
    const propertyName = inspection.property?.name || 'Unknown';
    const roomLabel = inspection.room?.label || '';

    if (flaggedItems.length > 0) {
      console.log(
        `[NOTIFICATION] Inspection ${inspection.id} submitted for ${propertyName}${roomLabel ? ` / ${roomLabel}` : ''}` +
        ` — ${flaggedItems.length} flagged item(s), ${maintenanceItems.length} maintenance item(s) created`,
      );
    } else if (inspection.type === 'ROOM_TURN') {
      console.log(
        `[NOTIFICATION] Room Ready: ${propertyName} / ${roomLabel} — Room turn passed with no flags`,
      );
    }

    return res.json({
      inspection: result.inspection,
      maintenanceItemsCreated: result.maintenanceItems.length,
      flaggedItemsCount: flaggedItems.length,
      notification: flaggedItems.length > 0
        ? `${flaggedItems.length} flagged item(s) — maintenance tickets created`
        : inspection.type === 'ROOM_TURN'
          ? 'Room Ready — no issues found'
          : 'Inspection submitted successfully',
    });
  } catch (error) {
    console.error('Submit inspection error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/inspections/:id/review — PM review ───────

router.put('/:id/review', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const inspection = await prisma.inspection.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });

    if (!inspection) {
      return res.status(404).json({ error: 'Inspection not found' });
    }

    if (inspection.status !== 'SUBMITTED') {
      return res.status(400).json({ error: 'Can only review SUBMITTED inspections' });
    }

    const updated = await prisma.inspection.update({
      where: { id: inspection.id },
      data: { status: 'REVIEWED' },
    });

    return res.json({ inspection: updated });
  } catch (error) {
    console.error('Review inspection error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
