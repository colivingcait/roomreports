import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { generateChecklist, ROOM_TYPES } from '../lib/checklist.js';
import { suggestPriority, PRIORITIES } from '../../../shared/index.js';

const router = Router();
router.use(requireAuth);

// ─── Permission helpers ─────────────────────────────────

const TYPE_PERMISSIONS = {
  OWNER: ['COMMON_AREA', 'ROOM_TURN', 'QUARTERLY', 'RESIDENT_SELF_CHECK', 'MOVE_IN_OUT'],
  PM: ['COMMON_AREA', 'ROOM_TURN', 'QUARTERLY', 'RESIDENT_SELF_CHECK', 'MOVE_IN_OUT'],
  CLEANER: ['COMMON_AREA', 'ROOM_TURN'],
  RESIDENT: ['RESIDENT_SELF_CHECK', 'MOVE_IN_OUT'],
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

// ─── POST /api/inspections/quarterly-batch — start quarterly for all rooms ──

router.post('/quarterly-batch', async (req, res) => {
  try {
    const { propertyId } = req.body;
    const { role, organizationId } = req.user;

    if (!propertyId) {
      return res.status(400).json({ error: 'propertyId is required' });
    }

    const allowed = TYPE_PERMISSIONS[role] || [];
    if (!allowed.includes('QUARTERLY')) {
      return res.status(403).json({ error: 'Not authorized for quarterly inspections' });
    }

    const access = await verifyPropertyAccess(req.user.id, role, propertyId, organizationId);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const { property } = access;

    if (!property.rooms.length) {
      return res.status(400).json({ error: 'Property has no rooms' });
    }

    // Check for existing DRAFT quarterly inspections for these rooms
    const existingDrafts = await prisma.inspection.findMany({
      where: {
        propertyId,
        type: 'QUARTERLY',
        status: 'DRAFT',
        organizationId,
        deletedAt: null,
        roomId: { in: property.rooms.map((r) => r.id) },
      },
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
          include: { photos: true },
        },
        room: { select: { id: true, label: true } },
      },
    });

    const existingByRoom = {};
    for (const d of existingDrafts) existingByRoom[d.roomId] = d;

    // Create inspections for rooms that don't have drafts
    const created = [];
    for (const room of property.rooms) {
      if (existingByRoom[room.id]) continue;

      const checklistItems = generateChecklist('QUARTERLY', property, room);
      const insp = await prisma.inspection.create({
        data: {
          type: 'QUARTERLY',
          propertyId,
          roomId: room.id,
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
          room: { select: { id: true, label: true } },
        },
      });
      created.push(insp);
    }

    // Combine existing drafts and newly created
    const allInspections = [...existingDrafts, ...created];

    return res.status(201).json({
      inspections: allInspections.map((i) => ({
        id: i.id,
        roomId: i.roomId,
        roomLabel: i.room?.label,
        status: i.status,
        items: i.items,
        completedAt: i.completedAt,
      })),
      propertyId,
      propertyName: property.name,
    });
  } catch (error) {
    console.error('Quarterly batch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/inspections — create new inspection ──────

router.post('/', async (req, res) => {
  try {
    const { type, propertyId, roomId, direction } = req.body;
    const { role, organizationId } = req.user;

    // Validate direction for MOVE_IN_OUT
    if (type === 'MOVE_IN_OUT' && direction && !['Move-In', 'Move-Out'].includes(direction)) {
      return res.status(400).json({ error: 'direction must be "Move-In" or "Move-Out"' });
    }

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
    const checklistItems = generateChecklist(type, property, room, { direction });

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
    const { propertyId, roomId, type, status, startDate, endDate, archived } = req.query;

    const where = {
      organizationId: req.user.organizationId,
    };

    // archived=true: only archived, archived=only: same, else: only active
    if (archived === 'true' || archived === 'only') {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
    }

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
        items: {
          orderBy: { createdAt: 'asc' },
          include: { photos: true },
        },
        property: { select: { id: true, name: true, address: true } },
        room: { select: { id: true, label: true } },
        inspector: { select: { id: true, name: true, role: true, customRole: true } },
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

    const {
      status, flagCategory, note, isMaintenance,
      isLeaseViolation, priority, entryCode, entryApproved,
    } = req.body;
    if (priority !== undefined && priority !== null && !PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
    }
    const updated = await prisma.inspectionItem.update({
      where: { id: item.id },
      data: {
        ...(status !== undefined && { status }),
        ...(flagCategory !== undefined && { flagCategory }),
        ...(note !== undefined && { note }),
        ...(isMaintenance !== undefined && { isMaintenance }),
        ...(isLeaseViolation !== undefined && { isLeaseViolation }),
        ...(priority !== undefined && { priority }),
        ...(entryCode !== undefined && { entryCode }),
        ...(entryApproved !== undefined && { entryApproved: !!entryApproved }),
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
    const { partial, partialReason } = req.body || {};

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

    // Check that all items have a status set (ignore metadata zones starting with _)
    const incomplete = inspection.items.filter((i) => !i.status && !i.zone.startsWith('_'));

    if (incomplete.length > 0 && !partial) {
      return res.status(400).json({
        error: `${incomplete.length} item(s) have not been completed`,
        incompleteItems: incomplete.map((i) => i.id),
      });
    }

    if (incomplete.length > 0 && partial && !partialReason?.trim()) {
      return res.status(400).json({ error: 'partialReason is required for partial submission' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // If partial, store reason as synthetic item
      if (incomplete.length > 0 && partial) {
        await tx.inspectionItem.deleteMany({
          where: { inspectionId: inspection.id, zone: '_PartialReason' },
        });
        await tx.inspectionItem.create({
          data: {
            inspectionId: inspection.id,
            zone: '_PartialReason',
            text: 'Partial submission',
            options: [],
            status: 'partial',
            note: partialReason.trim(),
          },
        });
      }

      return tx.inspection.update({
        where: { id: inspection.id },
        data: {
          status: 'SUBMITTED',
          completedAt: new Date(),
        },
      });
    });

    const flaggedItems = inspection.items.filter((i) => i.flagCategory);
    const propertyName = inspection.property?.name || 'Unknown';
    const roomLabel = inspection.room?.label || '';

    if (flaggedItems.length > 0) {
      console.log(
        `[NOTIFICATION] Inspection ${inspection.id} submitted for ${propertyName}${roomLabel ? ` / ${roomLabel}` : ''}` +
        ` — ${flaggedItems.length} flagged item(s), awaiting PM review`,
      );
    } else if (inspection.type === 'ROOM_TURN') {
      console.log(
        `[NOTIFICATION] Room Ready: ${propertyName} / ${roomLabel} — Room turn passed with no flags`,
      );
    }

    return res.json({
      inspection: updated,
      flaggedItemsCount: flaggedItems.length,
      notification: flaggedItems.length > 0
        ? `Submitted for PM review — ${flaggedItems.length} flagged item(s)`
        : inspection.type === 'ROOM_TURN'
          ? 'Room Ready — no issues found'
          : 'Inspection submitted for review',
    });
  } catch (error) {
    console.error('Submit inspection error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/inspections/:id — soft-delete DRAFT or REVIEWED ──

router.delete('/:id', async (req, res) => {
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

    if (!['DRAFT', 'REVIEWED'].includes(inspection.status)) {
      return res.status(400).json({ error: 'SUBMITTED inspections must be reviewed before deletion' });
    }

    await prisma.inspection.update({
      where: { id: inspection.id },
      data: { deletedAt: new Date() },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete inspection error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/inspections/quarterly-group — group quarterly by property+date ──

router.get('/quarterly-group/:propertyId/:date', async (req, res) => {
  try {
    const { propertyId, date } = req.params; // date format: YYYY-MM-DD

    const dayStart = new Date(date + 'T00:00:00.000Z');
    const dayEnd = new Date(date + 'T23:59:59.999Z');

    const inspections = await prisma.inspection.findMany({
      where: {
        propertyId,
        type: 'QUARTERLY',
        organizationId: req.user.organizationId,
        deletedAt: null,
        createdAt: { gte: dayStart, lte: dayEnd },
      },
      include: {
        items: { orderBy: { createdAt: 'asc' }, include: { photos: true } },
        room: { select: { id: true, label: true } },
        inspector: { select: { name: true, role: true, customRole: true } },
        property: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (inspections.length === 0) {
      return res.status(404).json({ error: 'No quarterly inspections found' });
    }

    // Sort rooms numerically
    inspections.sort((a, b) => {
      const la = a.room?.label || '';
      const lb = b.room?.label || '';
      const na = parseInt(la.match(/\d+/)?.[0], 10);
      const nb = parseInt(lb.match(/\d+/)?.[0], 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return la.localeCompare(lb);
    });

    // Aggregate stats
    let totalFlags = 0;
    let totalMaintenance = 0;
    let allItemsCount = 0;

    const rooms = inspections.map((insp) => {
      const visible = insp.items.filter((i) => !i.zone.startsWith('_'));
      const flags = visible.filter((i) => i.flagCategory).length;
      const maint = visible.filter((i) => i.isMaintenance).length;
      const answered = visible.filter((i) => i.status).length;
      totalFlags += flags;
      totalMaintenance += maint;
      allItemsCount += answered;

      // Detect partial submission
      const partialItem = insp.items.find((i) => i.zone === '_PartialReason');

      return {
        inspectionId: insp.id,
        roomId: insp.room?.id,
        roomLabel: insp.room?.label,
        status: insp.status,
        completedAt: insp.completedAt,
        flagCount: flags,
        maintenanceCount: maint,
        totalItems: visible.length,
        completedItems: visible.filter((i) => i.status).length,
        partialReason: partialItem?.note || null,
        flaggedItems: visible.filter((i) => i.flagCategory || i.isMaintenance).map((item) => ({
          id: item.id,
          zone: item.zone,
          text: item.text,
          status: item.status,
          flagCategory: item.flagCategory,
          isMaintenance: item.isMaintenance,
          note: item.note,
          photos: item.photos || [],
        })),
      };
    });

    // Group status: REVIEWED if all reviewed, SUBMITTED if any submitted, DRAFT otherwise
    const statuses = inspections.map((i) => i.status);
    let groupStatus = 'DRAFT';
    if (statuses.every((s) => s === 'REVIEWED')) groupStatus = 'REVIEWED';
    else if (statuses.some((s) => s === 'SUBMITTED')) groupStatus = 'SUBMITTED';

    return res.json({
      propertyId,
      property: inspections[0].property,
      inspector: inspections[0].inspector,
      date: inspections[0].createdAt,
      completedAt: inspections[0].completedAt,
      status: groupStatus,
      totalRooms: rooms.filter((r) => r.completedItems > 0).length,
      totalFlags,
      totalMaintenance,
      totalItems: allItemsCount,
      rooms,
    });
  } catch (error) {
    console.error('Quarterly group error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/inspections/bulk-approve — approve quarterly group ──

router.post('/bulk-approve', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { ids, items: itemSelections } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    const selectionMap = {};
    for (const sel of (itemSelections || [])) selectionMap[sel.itemId] = sel;

    const inspections = await prisma.inspection.findMany({
      where: {
        id: { in: ids },
        organizationId: req.user.organizationId,
        deletedAt: null,
        status: 'SUBMITTED',
      },
      include: { items: true },
    });
    if (inspections.length === 0) {
      return res.status(404).json({ error: 'No SUBMITTED inspections found' });
    }

    let totalMaintenance = 0;
    let totalViolations = 0;

    await prisma.$transaction(async (tx) => {
      for (const insp of inspections) {
        const pairs = [];
        for (const item of insp.items) {
          if (item.zone.startsWith('_')) continue;
          const sel = selectionMap[item.id];
          const createTask = sel ? sel.createTask : item.isMaintenance;
          const createViolation = sel ? sel.createViolation : item.isLeaseViolation;
          if (!createTask && !createViolation) continue;
          pairs.push({
            item: { ...item, isMaintenance: !!createTask, isLeaseViolation: !!createViolation },
            description: sel?.description || item.text,
            pmNote: sel?.pmNote || null,
            pmPriority: PRIORITIES.includes(sel?.priority) ? sel.priority : null,
          });
        }
        const counts = await createTicketsFromApproval(tx, insp, pairs, req.user);
        totalMaintenance += counts.maintenanceCreated;
        totalViolations += counts.violationsCreated;
        await tx.inspection.update({
          where: { id: insp.id },
          data: { status: 'REVIEWED' },
        });
      }
    });

    return res.json({
      approved: inspections.length,
      maintenanceItemsCreated: totalMaintenance,
      violationsCreated: totalViolations,
    });
  } catch (error) {
    console.error('Bulk approve error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/inspections/bulk-delete — soft-delete multiple DRAFT or REVIEWED ──

router.post('/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    const result = await prisma.inspection.updateMany({
      where: {
        id: { in: ids },
        organizationId: req.user.organizationId,
        status: { in: ['DRAFT', 'REVIEWED'] },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    return res.json({ deleted: result.count });
  } catch (error) {
    console.error('Bulk delete inspections error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/inspections/:id/restore — restore an archived inspection ──

router.post('/:id/restore', async (req, res) => {
  try {
    const inspection = await prisma.inspection.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: { not: null },
      },
    });

    if (!inspection) {
      return res.status(404).json({ error: 'Archived inspection not found' });
    }

    const updated = await prisma.inspection.update({
      where: { id: inspection.id },
      data: { deletedAt: null },
    });

    return res.json({ inspection: updated });
  } catch (error) {
    console.error('Restore inspection error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/inspections/pending — SUBMITTED for dashboard ──

router.get('/pending', async (req, res) => {
  try {
    const inspections = await prisma.inspection.findMany({
      where: {
        organizationId: req.user.organizationId,
        deletedAt: null,
        status: 'SUBMITTED',
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

    const summaries = inspections.map((i) => ({
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

    return res.json({ inspections: summaries });
  } catch (error) {
    console.error('List pending inspections error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/inspections/:id/approve — PM approves + creates maintenance ──
// Body: { items: [{ itemId, createTask, description?, pmNote? }] }

// Shared logic: create maintenance items + lease violations from a list of
// (item, selection) pairs within an open transaction.
async function createTicketsFromApproval(tx, inspection, pairs, user) {
  // Skip items that already have maintenance tickets from this inspection
  const existing = await tx.maintenanceItem.findMany({
    where: { inspectionId: inspection.id, deletedAt: null },
    select: { inspectionItemId: true },
  });
  const existingIds = new Set(existing.map((m) => m.inspectionItemId));

  let maintenanceCreated = 0;
  let violationsCreated = 0;

  for (const { item, description, pmNote, pmPriority } of pairs) {
    const combinedNote = [item.note, pmNote ? `PM: ${pmNote}` : null].filter(Boolean).join('\n');
    const category = item.flagCategory || 'General';
    const priority = pmPriority
      || (PRIORITIES.includes(item.priority) ? item.priority : null)
      || suggestPriority(category);

    // Maintenance side
    if (item.isMaintenance && !existingIds.has(item.id)) {
      const mi = await tx.maintenanceItem.create({
        data: {
          inspectionItemId: item.id,
          inspectionId: inspection.id,
          propertyId: inspection.propertyId,
          roomId: inspection.roomId,
          organizationId: inspection.organizationId,
          description,
          zone: item.zone,
          flagCategory: category,
          note: combinedNote || null,
          priority,
          entryCode: item.entryCode || null,
          entryApproved: !!item.entryApproved,
          entryApprovedAt: item.entryApproved ? new Date() : null,
          reportedById: inspection.inspectorId,
          reportedByName: inspection.inspectorName,
          reportedByRole: inspection.inspectorRole,
        },
      });
      await tx.maintenanceEvent.create({
        data: {
          maintenanceItemId: mi.id,
          type: 'created',
          toValue: 'OPEN',
          byUserId: user?.id || null,
          byUserName: user?.name || null,
          note: `Approved from inspection by ${inspection.inspectorName}`,
        },
      });
      maintenanceCreated += 1;
    }

    // Lease violation side (separate record, tied to the same InspectionItem)
    if (item.isLeaseViolation) {
      const existingViolation = await tx.leaseViolation.findUnique({
        where: { inspectionItemId: item.id },
      }).catch(() => null);
      if (!existingViolation) {
        await tx.leaseViolation.create({
          data: {
            organizationId: inspection.organizationId,
            propertyId: inspection.propertyId,
            roomId: inspection.roomId,
            inspectionId: inspection.id,
            inspectionItemId: item.id,
            description,
            category,
            note: combinedNote || null,
            reportedById: inspection.inspectorId,
            reportedByName: inspection.inspectorName,
          },
        });
        violationsCreated += 1;
      }
    }
  }

  return { maintenanceCreated, violationsCreated };
}

router.post('/:id/approve', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { items: itemSelections } = req.body;

    const inspection = await prisma.inspection.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
      include: { items: true },
    });

    if (!inspection) {
      return res.status(404).json({ error: 'Inspection not found' });
    }

    if (inspection.status !== 'SUBMITTED') {
      return res.status(400).json({ error: 'Can only approve SUBMITTED inspections' });
    }

    // Build a map of item id -> inspection item
    const itemMap = {};
    for (const it of inspection.items) itemMap[it.id] = it;

    // Determine which items to create tickets for
    const pairs = [];
    if (Array.isArray(itemSelections) && itemSelections.length > 0) {
      for (const sel of itemSelections) {
        if (!sel.createTask && !sel.createViolation) continue;
        const item = itemMap[sel.itemId];
        if (!item) continue;
        // Apply overrides from the PM review UI before creating tickets
        pairs.push({
          item: {
            ...item,
            isMaintenance: sel.createTask !== undefined ? !!sel.createTask : item.isMaintenance,
            isLeaseViolation: sel.createViolation !== undefined
              ? !!sel.createViolation
              : item.isLeaseViolation,
          },
          description: sel.description || item.text,
          pmNote: sel.pmNote || null,
          pmPriority: PRIORITIES.includes(sel.priority) ? sel.priority : null,
        });
      }
    } else {
      // Fallback: default to all flagged maintenance/violation items
      for (const item of inspection.items) {
        if (item.isMaintenance || item.isLeaseViolation) {
          pairs.push({ item, description: item.text, pmNote: null });
        }
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.inspection.update({
        where: { id: inspection.id },
        data: { status: 'REVIEWED' },
      });
      const counts = await createTicketsFromApproval(tx, inspection, pairs, req.user);
      await tx.inspectionItem.deleteMany({
        where: { inspectionId: inspection.id, zone: '_SendBackReason' },
      });
      return { inspection: updated, ...counts };
    });

    return res.json({
      inspection: result.inspection,
      maintenanceItemsCreated: result.maintenanceCreated,
      violationsCreated: result.violationsCreated,
    });
  } catch (error) {
    console.error('Approve inspection error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/inspections/:id/send-back — PM sends back to DRAFT ──
// Body: { reason?: string }

router.post('/:id/send-back', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { reason } = req.body;

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
      return res.status(400).json({ error: 'Can only send back SUBMITTED inspections' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Remove any existing _SendBackReason items
      await tx.inspectionItem.deleteMany({
        where: { inspectionId: inspection.id, zone: '_SendBackReason' },
      });

      // Store reason as synthetic item (if provided)
      if (reason && reason.trim()) {
        await tx.inspectionItem.create({
          data: {
            inspectionId: inspection.id,
            zone: '_SendBackReason',
            text: 'PM feedback',
            options: [],
            status: 'sent-back',
            note: reason.trim(),
          },
        });
      }

      return tx.inspection.update({
        where: { id: inspection.id },
        data: { status: 'DRAFT', completedAt: null },
      });
    });

    return res.json({ inspection: updated });
  } catch (error) {
    console.error('Send back inspection error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/inspections/compare/:roomId — Move-In vs Move-Out ─

router.get('/compare/:roomId', async (req, res) => {
  try {
    const room = await prisma.room.findFirst({
      where: { id: req.params.roomId, deletedAt: null },
      include: {
        property: { select: { id: true, name: true, organizationId: true } },
      },
    });

    if (!room || room.property.organizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const inspections = await prisma.inspection.findMany({
      where: {
        roomId: room.id,
        type: 'MOVE_IN_OUT',
        organizationId: req.user.organizationId,
        deletedAt: null,
        status: { in: ['SUBMITTED', 'REVIEWED'] },
      },
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
          include: { photos: true },
        },
        inspector: { select: { name: true, role: true, customRole: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Determine direction from the _Direction metadata item
    const getDirection = (insp) => {
      const meta = insp.items.find((i) => i.zone === '_Direction');
      return meta?.status || null;
    };

    const moveOut = inspections.find((i) => getDirection(i) === 'Move-Out');
    const moveIn = inspections.find((i) => getDirection(i) === 'Move-In');

    // Fallback: no direction stored — use chronology (oldest = Move-In, newest = Move-Out)
    const ordered = inspections.slice().reverse(); // oldest first
    const fallbackMoveIn = !moveIn && ordered.length >= 1 ? ordered[0] : moveIn;
    const fallbackMoveOut = !moveOut && ordered.length >= 2 ? ordered[ordered.length - 1] : moveOut;

    // Filter out the _Direction meta item from display
    const cleanItems = (insp) => ({
      id: insp.id,
      status: insp.status,
      createdAt: insp.createdAt,
      completedAt: insp.completedAt,
      inspectorName: insp.inspector?.name,
      items: insp.items
        .filter((item) => item.zone !== '_Direction')
        .map((item) => ({
          id: item.id,
          zone: item.zone,
          text: item.text,
          status: item.status,
          note: item.note,
          photos: item.photos || [],
        })),
    });

    // Build comparison
    const conditionRank = { 'Excellent': 0, 'Good': 1, 'Fair': 2, 'Damaged': 3, 'Heavily Damaged': 4 };
    let comparison = [];
    if (fallbackMoveIn && fallbackMoveOut) {
      const inMap = {};
      for (const item of fallbackMoveIn.items.filter((i) => i.zone !== '_Direction')) {
        inMap[`${item.zone}|${item.text}`] = item.status;
      }
      for (const item of fallbackMoveOut.items.filter((i) => i.zone !== '_Direction')) {
        const key = `${item.zone}|${item.text}`;
        const prev = inMap[key];
        if (prev && prev !== item.status) {
          const prevRank = conditionRank[prev] ?? -1;
          const currRank = conditionRank[item.status] ?? -1;
          comparison.push({
            zone: item.zone,
            text: item.text,
            moveInStatus: prev,
            moveOutStatus: item.status,
            deteriorated: currRank > prevRank,
          });
        }
      }
    }

    return res.json({
      room: { id: room.id, label: room.label },
      property: { id: room.property.id, name: room.property.name },
      moveIn: fallbackMoveIn ? cleanItems(fallbackMoveIn) : null,
      moveOut: fallbackMoveOut ? cleanItems(fallbackMoveOut) : null,
      comparison,
    });
  } catch (error) {
    console.error('Move-in/out compare error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/inspections/history/:roomId — room history ─

router.get('/history/:roomId', async (req, res) => {
  try {
    const room = await prisma.room.findFirst({
      where: { id: req.params.roomId, deletedAt: null },
      include: {
        property: {
          select: { id: true, name: true, organizationId: true },
        },
      },
    });

    if (!room || room.property.organizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const inspections = await prisma.inspection.findMany({
      where: {
        roomId: room.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
        status: { in: ['SUBMITTED', 'REVIEWED'] },
      },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        inspector: { select: { name: true, role: true, customRole: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 4,
    });

    // Build comparison: for each item text, track status across inspections
    const comparison = [];
    if (inspections.length >= 2) {
      const latest = inspections[0];
      const previous = inspections[1];

      const prevMap = {};
      for (const item of previous.items) {
        prevMap[`${item.zone}|${item.text}`] = item.status;
      }

      for (const item of latest.items) {
        const key = `${item.zone}|${item.text}`;
        const prevStatus = prevMap[key] || null;
        if (prevStatus && prevStatus !== item.status) {
          comparison.push({
            zone: item.zone,
            text: item.text,
            currentStatus: item.status,
            previousStatus: prevStatus,
            deteriorated: isDeteriorated(prevStatus, item.status),
          });
        }
      }
    }

    return res.json({
      room: { id: room.id, label: room.label },
      property: { id: room.property.id, name: room.property.name },
      inspections: inspections.map((i) => ({
        id: i.id,
        type: i.type,
        status: i.status,
        createdAt: i.createdAt,
        completedAt: i.completedAt,
        inspectorName: i.inspector?.name,
        inspectorRole: i.inspector?.role,
        items: i.items.map((item) => ({
          id: item.id,
          zone: item.zone,
          text: item.text,
          status: item.status,
          flagCategory: item.flagCategory,
          isMaintenance: item.isMaintenance,
          note: item.note,
        })),
        flagCount: i.items.filter((item) => item.flagCategory).length,
      })),
      comparison,
    });
  } catch (error) {
    console.error('Room history error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

function isDeteriorated(prev, current) {
  const goodStatuses = ['Pass', 'Good', 'Clean', 'Yes'];
  const badStatuses = ['Fail', 'Poor', 'Dirty', 'No', 'Missing'];
  const wasGood = goodStatuses.includes(prev);
  const nowBad = badStatuses.includes(current);
  return wasGood && nowBad;
}

export default router;
