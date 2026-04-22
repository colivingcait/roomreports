import { Router } from 'express';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { generateChecklist, buildChecklist, ROOM_TYPES } from '../lib/checklist.js';
import { suggestPriority, PRIORITIES } from '../../../shared/index.js';

const router = Router();
router.use(requireAuth);

// ─── Permission helpers ─────────────────────────────────

const TYPE_PERMISSIONS = {
  OWNER: ['COMMON_AREA', 'COMMON_AREA_QUICK', 'ROOM_TURN', 'QUARTERLY', 'RESIDENT_SELF_CHECK', 'MOVE_IN_OUT'],
  PM: ['COMMON_AREA', 'COMMON_AREA_QUICK', 'ROOM_TURN', 'QUARTERLY', 'RESIDENT_SELF_CHECK', 'MOVE_IN_OUT'],
  CLEANER: ['COMMON_AREA', 'COMMON_AREA_QUICK', 'ROOM_TURN'],
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
    let existingDrafts = await prisma.inspection.findMany({
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

    // Auto-regenerate drafts that were created before the new 4-screen flow.
    // The new flow uses a `_Completed` marker item; old drafts won't have it.
    const staleIds = existingDrafts
      .filter((d) => !d.items.some((i) => i.zone === '_Completed'))
      .map((d) => d.id);
    if (staleIds.length > 0) {
      await prisma.inspectionItem.deleteMany({ where: { inspectionId: { in: staleIds } } });
      await prisma.inspection.deleteMany({ where: { id: { in: staleIds } } });
      existingDrafts = existingDrafts.filter((d) => !staleIds.includes(d.id));
    }

    const existingByRoom = {};
    for (const d of existingDrafts) existingByRoom[d.roomId] = d;

    // Create inspections for rooms that don't have drafts
    const created = [];
    for (const room of property.rooms) {
      if (existingByRoom[room.id]) continue;

      const checklistItems = await buildChecklist(prisma, organizationId, 'QUARTERLY', property, room);
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

    // ── Quick common area check ──
    // Stored as items on the "primary" room inspection (lowest numeric
    // room label, alphabetical tiebreaker) using zone `_QuickCommon:Kitchen`
    // or `_QuickCommon:Bathroom`. Shared bathrooms only — ensuite bathrooms
    // (labels containing "ensuite") are excluded.

    // Clean up any legacy COMMON_AREA_QUICK inspections — the quick check
    // is no longer a separate inspection. Any DRAFT ones are replaced;
    // already-submitted ones are left alone so history stays intact.
    await prisma.inspection.updateMany({
      where: {
        propertyId,
        type: 'COMMON_AREA_QUICK',
        status: 'DRAFT',
        organizationId,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    const roomSortKey = (insp) => {
      const label = insp.room?.label || '';
      const n = parseInt(label.match(/\d+/)?.[0], 10);
      return { n: isNaN(n) ? Infinity : n, label };
    };
    const primary = allInspections.slice().sort((a, b) => {
      const ka = roomSortKey(a);
      const kb = roomSortKey(b);
      if (ka.n !== kb.n) return ka.n - kb.n;
      return ka.label.localeCompare(kb.label);
    })[0];

    const sharedBathrooms = (property.bathrooms || []).filter(
      (b) => !/ensuite/i.test(b.label || '')
    );
    const desired = [
      ...(property.kitchens || []).map((k) => ({ kind: 'Kitchen', label: k.label || 'Kitchen' })),
      ...sharedBathrooms.map((b) => ({ kind: 'Bathroom', label: b.label || 'Bathroom' })),
    ];

    if (primary && desired.length > 0) {
      const existingQuick = primary.items.filter((i) => i.zone?.startsWith('_QuickCommon:'));
      const existingKeys = new Set(existingQuick.map((i) => `${i.zone}|${i.text}`));

      const toCreate = [];
      for (const d of desired) {
        const zone = `_QuickCommon:${d.kind}`;
        const key = `${zone}|${d.label}`;
        if (!existingKeys.has(key)) {
          toCreate.push({
            inspectionId: primary.id,
            zone,
            text: d.label,
            options: ['Pass', 'Fail'],
            status: '',
          });
        }
      }
      if (toCreate.length > 0) {
        await prisma.inspectionItem.createMany({ data: toCreate });
        // Refetch the primary so we return fresh quick items
        const refreshed = await prisma.inspection.findUnique({
          where: { id: primary.id },
          include: {
            items: { orderBy: { createdAt: 'asc' }, include: { photos: true } },
            room: { select: { id: true, label: true } },
          },
        });
        const idx = allInspections.findIndex((i) => i.id === primary.id);
        if (idx >= 0) allInspections[idx] = refreshed;
      }
    }

    // Build the commonAreaQuick payload from the primary inspection's
    // _QuickCommon:* items. Frontend reads/writes these via the primary id.
    const primaryAfter = allInspections.find((i) => i.id === primary?.id) || null;
    const quickCheckItems = primaryAfter
      ? primaryAfter.items.filter((i) => i.zone?.startsWith('_QuickCommon:'))
      : [];

    return res.status(201).json({
      inspections: allInspections.map((i) => ({
        id: i.id,
        roomId: i.roomId,
        roomLabel: i.room?.label,
        status: i.status,
        items: i.items,
        completedAt: i.completedAt,
      })),
      commonAreaQuick: primary ? {
        inspectionId: primary.id,
        items: quickCheckItems,
      } : null,
      propertyId,
      propertyName: property.name,
      kitchens: (property.kitchens || []).map((k) => ({ id: k.id, label: k.label || 'Kitchen' })),
      bathrooms: sharedBathrooms.map((b) => ({ id: b.id, label: b.label || 'Bathroom' })),
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
    const checklistItems = await buildChecklist(prisma, organizationId, type, property, room, { direction });

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

    // Flagged-item count per inspection so the reports list can show it
    // without a second request per row.
    const ids = inspections.map((i) => i.id);
    let flagCounts = [];
    if (ids.length > 0) {
      flagCounts = await prisma.inspectionItem.groupBy({
        by: ['inspectionId'],
        where: {
          inspectionId: { in: ids },
          OR: [
            { flagCategory: { not: null } },
            { isMaintenance: true },
            { isLeaseViolation: true },
          ],
        },
        _count: true,
      });
    }
    const flagMap = {};
    for (const row of flagCounts) flagMap[row.inspectionId] = row._count;

    return res.json({
      inspections: inspections.map((i) => ({
        ...i,
        flagCount: flagMap[i.id] || 0,
      })),
    });
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

// ─── POST /api/inspections/:id/items — add new item (e.g. dynamic Misc) ─

router.post('/:id/items', async (req, res) => {
  try {
    const inspection = await prisma.inspection.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });
    if (inspection.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Can only add items to DRAFT inspections' });
    }

    const { zone = 'Misc', text = '', options = ['Pass', 'Fail'] } = req.body || {};
    const created = await prisma.inspectionItem.create({
      data: {
        inspectionId: inspection.id,
        zone,
        text,
        options,
        status: '',
      },
    });
    return res.status(201).json({ item: created });
  } catch (error) {
    console.error('Add inspection item error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/inspections/:id/items/:itemId — remove (e.g. misc undo) ─

router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const inspection = await prisma.inspection.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });
    if (inspection.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Can only delete items on DRAFT inspections' });
    }
    const item = await prisma.inspectionItem.findFirst({
      where: { id: req.params.itemId, inspectionId: inspection.id },
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    await prisma.inspectionItem.delete({ where: { id: item.id } });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Delete inspection item error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/inspections/:id/reopen — PM/Owner reopens submitted ──

router.post('/:id/reopen', async (req, res) => {
  try {
    const { role, organizationId } = req.user;
    if (!['PM', 'OWNER'].includes(role)) {
      return res.status(403).json({ error: 'Only PM or Owner can reopen inspections' });
    }

    const inspection = await prisma.inspection.findFirst({
      where: { id: req.params.id, organizationId, deletedAt: null },
    });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });
    if (inspection.status === 'DRAFT') {
      return res.status(400).json({ error: 'Inspection is already a draft' });
    }

    const updated = await prisma.inspection.update({
      where: { id: inspection.id },
      data: {
        status: 'DRAFT',
        completedAt: null,
        editedAt: new Date(),
        editCount: { increment: 1 },
      },
    });
    return res.json({ inspection: updated });
  } catch (error) {
    console.error('Reopen inspection error:', error);
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
        flaggedItems: visible.filter((i) => i.flagCategory || i.isMaintenance || i.isLeaseViolation).map((item) => ({
          id: item.id,
          zone: item.zone,
          text: item.text,
          status: item.status,
          flagCategory: item.flagCategory,
          isMaintenance: item.isMaintenance,
          isLeaseViolation: item.isLeaseViolation,
          priority: item.priority,
          entryCode: item.entryCode,
          entryApproved: item.entryApproved,
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

    // Quick common area check: pull from any inspection holding
    // `_QuickCommon:*` items. Group by kind (Kitchen / Bathroom).
    const commonAreaQuick = [];
    for (const insp of inspections) {
      for (const it of insp.items) {
        if (!it.zone?.startsWith('_QuickCommon:')) continue;
        const kind = it.zone.split(':')[1] || 'Other';
        commonAreaQuick.push({
          id: it.id,
          kind,
          label: it.text,
          status: it.status,
          note: it.note,
          flagCategory: it.flagCategory,
          isMaintenance: it.isMaintenance,
          priority: it.priority,
          photos: it.photos || [],
        });
      }
    }

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
      commonAreaQuick,
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
            description: (sel?.description && sel.description.trim())
              || (item.note && item.note.trim())
              || item.text,
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
          description: (sel.description && sel.description.trim())
            || (item.note && item.note.trim())
            || item.text,
          pmNote: sel.pmNote || null,
          pmPriority: PRIORITIES.includes(sel.priority) ? sel.priority : null,
        });
      }
    } else {
      // Fallback: default to all flagged maintenance/violation items
      for (const item of inspection.items) {
        if (item.isMaintenance || item.isLeaseViolation) {
          pairs.push({
            item,
            description: (item.note && item.note.trim()) || item.text,
            pmNote: null,
          });
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

// ─── Inspection PDF ─────────────────────────────────────

const INSPECTION_TYPE_LABELS = {
  QUARTERLY: 'Room Inspection',
  COMMON_AREA: 'Common Area',
  COMMON_AREA_QUICK: 'Common Area Quick Check',
  ROOM_TURN: 'Room Turn',
  RESIDENT_SELF_CHECK: 'Self-Check',
  MOVE_IN_OUT: 'Move-In',
};

const BAD_STATUSES = new Set(['Fail', 'Poor', 'Dirty', 'No', 'Missing', 'Damaged', 'Heavily Damaged']);

// Fetch a photo URL as a Buffer, with a short timeout so a single slow
// image doesn't hold up a report. Returns null on any failure so the
// caller can skip silently.
async function fetchPhotoBuffer(url) {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    const raw = Buffer.from(arr);
    // Normalize EXIF orientation + re-encode as JPEG so pdfkit doesn't
    // render sideways photos from older uploads (sharp pipeline was only
    // recently added on ingest).
    try {
      return await sharp(raw).rotate().jpeg({ quality: 85 }).toBuffer();
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

// Embed up to 3 photos per item in a tidy row. If all fetches fail we
// fall back to a small "N photos attached" note instead of silence.
async function embedPhotos(doc, photos) {
  if (!photos || photos.length === 0) return;
  const MAX = 3;
  const tile = 120;
  const gap = 8;
  const buffers = await Promise.all(
    photos.slice(0, MAX).map((p) => fetchPhotoBuffer(p.url)),
  );
  const valid = buffers.filter(Boolean);
  if (valid.length === 0) {
    doc.fontSize(9).fillColor('#8A8583').text(`${photos.length} photo${photos.length === 1 ? '' : 's'} attached (not embedded)`);
    doc.fillColor('#4A4543');
    return;
  }
  const startX = doc.x;
  const startY = doc.y + 4;
  // Make sure we have room for the photos on this page
  if (startY + tile > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
  valid.forEach((buf, idx) => {
    const x = startX + idx * (tile + gap);
    try {
      doc.image(buf, x, startY, { width: tile, height: tile, fit: [tile, tile], align: 'center' });
    } catch { /* bad image, skip */ }
  });
  if (photos.length > MAX) {
    doc.fontSize(9).fillColor('#8A8583').text(
      ` +${photos.length - MAX} more photo${photos.length - MAX === 1 ? '' : 's'} not shown`,
      startX,
      startY + tile + 4,
    );
  }
  doc.x = startX;
  doc.y = startY + tile + 10;
  doc.fillColor('#4A4543');
}

function inspectionSummary(inspection) {
  const visible = (inspection.items || []).filter((i) => !i.zone?.startsWith('_'));
  const total = visible.length;
  const answered = visible.filter((i) => i.status).length;
  const passed = visible.filter((i) => !BAD_STATUSES.has(i.status) && i.status && i.status !== '').length;
  const failed = visible.filter((i) => BAD_STATUSES.has(i.status)).length;
  const notAnswered = total - answered;
  const flagged = visible.filter((i) => i.flagCategory || i.isMaintenance || i.isLeaseViolation);
  const maintenance = visible.filter((i) => i.isMaintenance);
  const violations = visible.filter((i) => i.isLeaseViolation);
  const partialItem = (inspection.items || []).find((i) => i.zone === '_PartialReason');
  return {
    total, answered, passed, failed, notAnswered,
    flagged, maintenance, violations,
    partialReason: partialItem?.note || null,
  };
}

function writeInspectionHeader(doc, inspection) {
  const label = INSPECTION_TYPE_LABELS[inspection.type] || inspection.type;
  doc.fontSize(20).fillColor('#4A4543').text(label);
  doc.moveDown(0.25);
  doc.fontSize(11).fillColor('#8A8583');
  doc.text(`${inspection.property?.name || ''}${inspection.property?.address ? ' — ' + inspection.property.address : ''}`);
  if (inspection.room?.label) doc.text(`Room: ${inspection.room.label}`);
  if (inspection.inspectorName) {
    doc.text(`Inspector: ${inspection.inspectorName}${inspection.inspectorRole ? ` (${inspection.inspectorRole})` : ''}`);
  }
  doc.text(`Created: ${new Date(inspection.createdAt).toLocaleString('en-US')}`);
  if (inspection.completedAt) {
    doc.text(`Completed: ${new Date(inspection.completedAt).toLocaleString('en-US')}`);
  }
  doc.text(`Status: ${inspection.status}`);
  if (inspection.editCount > 0 && inspection.editedAt) {
    doc.text(`Last edited: ${new Date(inspection.editedAt).toLocaleString('en-US')} (${inspection.editCount} edit${inspection.editCount === 1 ? '' : 's'})`);
  }
}

function writeInspectionSummary(doc, inspection) {
  const s = inspectionSummary(inspection);

  doc.moveDown(0.75);
  doc.fontSize(13).fillColor('#4A4543').text('Summary', { underline: true });
  doc.fontSize(11).fillColor('#4A4543');
  doc.moveDown(0.25);
  doc.text(`Items answered: ${s.answered} / ${s.total}`);
  doc.text(`Passed: ${s.passed}`);
  doc.text(`Failed / flagged: ${s.failed}`);
  if (s.notAnswered > 0) doc.text(`Not answered: ${s.notAnswered}`);
  doc.text(`Maintenance to follow up: ${s.maintenance.length}`);
  doc.text(`Lease violations: ${s.violations.length}`);

  if (s.partialReason) {
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#C4703F').text('Partial submission', { underline: true });
    doc.fontSize(10).fillColor('#4A4543').text(s.partialReason);
  }

  if (s.flagged.length > 0) {
    doc.moveDown(0.75);
    doc.fontSize(13).fillColor('#4A4543').text('Flagged items', { underline: true });
    doc.moveDown(0.25);
    doc.fontSize(10).fillColor('#4A4543');
    for (const item of s.flagged) {
      const title = (item.note && item.note.trim()) || item.text;
      doc.font('Helvetica-Bold').text(title);
      doc.font('Helvetica');
      const meta = [];
      if (item.zone) meta.push(item.zone);
      if (item.flagCategory) meta.push(item.flagCategory);
      if (item.priority) meta.push(item.priority + ' priority');
      if (item.isMaintenance) meta.push('→ maintenance');
      if (item.isLeaseViolation) meta.push('→ lease violation');
      if (meta.length) doc.fillColor('#8A8583').text(meta.join(' · ')).fillColor('#4A4543');
      if (item.note && item.note !== title) doc.text(item.note);
      if (item.photos?.length) {
        doc.fillColor('#8A8583').text(`${item.photos.length} photo${item.photos.length === 1 ? '' : 's'} attached`).fillColor('#4A4543');
      }
      doc.moveDown(0.35);
    }
  } else {
    doc.moveDown(0.75);
    doc.fontSize(11).fillColor('#3B6D11').text('✓ No issues flagged.');
  }
}

function writeInspectionFullDetail(doc, inspection) {
  const visible = (inspection.items || []).filter((i) => !i.zone?.startsWith('_'));

  // Group items by zone, preserving insertion order
  const zones = [];
  const byZone = {};
  for (const it of visible) {
    if (!byZone[it.zone]) { byZone[it.zone] = []; zones.push(it.zone); }
    byZone[it.zone].push(it);
  }

  doc.moveDown(0.75);
  doc.fontSize(13).fillColor('#4A4543').text('Full checklist', { underline: true });
  doc.moveDown(0.25);

  for (const zone of zones) {
    doc.moveDown(0.4);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#6B8F71').text(zone);
    doc.font('Helvetica').fillColor('#4A4543');
    for (const item of byZone[zone]) {
      const statusLabel = item.status || '—';
      const statusColor = item.status
        ? (BAD_STATUSES.has(item.status) ? '#C0392B' : '#3B6D11')
        : '#8A8583';
      doc.fontSize(10);
      doc.text('• ', { continued: true });
      doc.fillColor('#4A4543').text(item.text, { continued: true });
      doc.fillColor(statusColor).text(`   ${statusLabel}`);
      doc.fillColor('#4A4543');
      if (item.note) {
        doc.fontSize(9).fillColor('#8A8583').text(`   ${item.note}`);
      }
      if (item.flagCategory) {
        doc.fontSize(9).fillColor('#8A8583').text(`   Category: ${item.flagCategory}${item.priority ? ` · ${item.priority} priority` : ''}`);
      }
      if (item.photos?.length) {
        doc.fontSize(9).fillColor('#8A8583').text(`   ${item.photos.length} photo${item.photos.length === 1 ? '' : 's'}`);
      }
      doc.fillColor('#4A4543');
    }
  }
}

async function fetchInspectionForPdf(id, orgId) {
  return prisma.inspection.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
    include: {
      items: { orderBy: { createdAt: 'asc' }, include: { photos: true } },
      property: { select: { id: true, name: true, address: true } },
      room: { select: { id: true, label: true } },
    },
  });
}

// GET /api/inspections/:id/pdf — single non-quarterly inspection PDF.
// Quarterly inspections should use /quarterly-group/:propertyId/:date/pdf
// to get the grouped report; if called directly on a quarterly inspection
// it still renders but without the aggregate summary.
router.get('/:id/pdf', async (req, res) => {
  try {
    const inspection = await fetchInspectionForPdf(req.params.id, req.user.organizationId);
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });

    // Redirect QUARTERLY → grouped PDF (all rooms from the same batch).
    if (inspection.type === 'QUARTERLY' && inspection.property?.id) {
      const dateKey = new Date(inspection.createdAt).toISOString().slice(0, 10);
      return res.redirect(307, `/api/inspections/quarterly-group/${inspection.property.id}/${dateKey}/pdf`);
    }

    const filename = `inspection-${inspection.id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    doc.pipe(res);

    const s = inspectionSummary(inspection);
    const label = INSPECTION_TYPE_LABELS[inspection.type] || inspection.type;

    // Header
    doc.fontSize(22).fillColor('#2C2C2C').text(`${label} Report`);
    doc.moveDown(0.25);
    doc.fontSize(11).fillColor('#8A8580');
    doc.text(`${inspection.property?.name || ''}${inspection.property?.address ? ' — ' + inspection.property.address : ''}`);
    if (inspection.room?.label) doc.text(`Room: ${inspection.room.label}`);
    if (inspection.inspectorName) doc.text(`Inspector: ${inspection.inspectorName}`);
    doc.text(`Inspected: ${new Date(inspection.createdAt).toLocaleString('en-US')}`);
    if (inspection.completedAt) doc.text(`Submitted: ${new Date(inspection.completedAt).toLocaleString('en-US')}`);
    doc.text(`Status: ${inspection.status}`);
    doc.text(`Generated: ${new Date().toLocaleString('en-US')}`);

    // Stats
    doc.moveDown(0.75);
    doc.fontSize(13).fillColor('#2C2C2C').text('Summary', { underline: true });
    doc.moveDown(0.25);
    doc.fontSize(11).fillColor('#2C2C2C');
    doc.text(`Items answered: ${s.answered} / ${s.total}`);
    doc.text(`Passed: ${s.passed}`);
    doc.text(`Flagged: ${s.failed}`);
    if (s.notAnswered > 0) doc.text(`Not answered: ${s.notAnswered}`);
    doc.text(`Maintenance items: ${s.maintenance.length}`);
    doc.text(`Lease violations: ${s.violations.length}`);

    if (s.partialReason) {
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor('#C4703F').text('Partial submission', { underline: true });
      doc.fontSize(10).fillColor('#2C2C2C').text(s.partialReason);
    }

    // Flagged items with embedded photos
    if (s.flagged.length > 0) {
      doc.moveDown(0.75);
      doc.fontSize(13).fillColor('#2C2C2C').text('Flagged items', { underline: true });
      doc.moveDown(0.25);
      for (const item of s.flagged) {
        const title = (item.note && item.note.trim()) || item.text;
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#2C2C2C').text(title);
        doc.font('Helvetica').fontSize(10);
        const meta = [];
        if (item.zone) meta.push(item.zone);
        if (item.flagCategory) meta.push(item.flagCategory);
        if (item.priority) meta.push(item.priority + ' priority');
        if (item.isMaintenance) meta.push('→ maintenance');
        if (item.isLeaseViolation) meta.push('→ lease violation');
        if (meta.length) doc.fillColor('#8A8580').text(meta.join(' · ')).fillColor('#2C2C2C');
        if (item.note && item.note !== title) doc.text(item.note);
        if (item.photos?.length) {
          await embedPhotos(doc, item.photos);
        }
        doc.moveDown(0.5);
      }
    } else {
      doc.moveDown(0.75);
      doc.fontSize(11).fillColor('#3B6D11').text('No issues flagged.');
    }

    doc.moveDown(1);
    doc.fontSize(8).fillColor('#8A8580').text(`ID ${inspection.id}`, { align: 'right' });
    doc.end();
  } catch (error) {
    console.error('Inspection PDF error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/inspections/quarterly-group/:propertyId/:date/pdf — Room Inspection batch PDF
//
// Layout:
//   Page 1: Summary — header + aggregate stats + room-by-room list
//   Pages 2+: One page per room that has flags/maintenance/violations
//   Last page: Common Area Quick Check (if any `_QuickCommon` items present)
//
// Photos on flagged items are embedded (up to 3 per item) when reachable.
router.get('/quarterly-group/:propertyId/:date/pdf', async (req, res) => {
  try {
    const { propertyId, date } = req.params;
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
        property: { select: { id: true, name: true, address: true } },
        room: { select: { id: true, label: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (inspections.length === 0) return res.status(404).json({ error: 'No inspections found' });

    inspections.sort((a, b) => {
      const la = a.room?.label || '';
      const lb = b.room?.label || '';
      const na = parseInt(la.match(/\d+/)?.[0], 10);
      const nb = parseInt(lb.match(/\d+/)?.[0], 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return la.localeCompare(lb);
    });

    const first = inspections[0];
    const filename = `room-inspection-${propertyId}-${date}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    doc.pipe(res);

    // ─── PAGE 1: SUMMARY ─────────────────────────────
    doc.fontSize(22).fillColor('#2C2C2C').text('Room Inspection Report');
    doc.moveDown(0.25);
    doc.fontSize(11).fillColor('#8A8580');
    if (first.property?.name) doc.text(first.property.name);
    if (first.property?.address) doc.text(first.property.address);
    doc.text(`Date of inspection: ${new Date(first.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`);
    if (first.inspectorName) doc.text(`Inspector: ${first.inspectorName}`);
    const submittedAt = inspections
      .map((i) => i.completedAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0];
    if (submittedAt) doc.text(`Submitted: ${new Date(submittedAt).toLocaleString('en-US')}`);
    // Group status — REVIEWED if all reviewed, SUBMITTED if any submitted, else DRAFT
    const statuses = inspections.map((i) => i.status);
    let groupStatus = 'DRAFT';
    if (statuses.every((s) => s === 'REVIEWED')) groupStatus = 'REVIEWED';
    else if (statuses.some((s) => s === 'SUBMITTED')) groupStatus = 'SUBMITTED';
    doc.text(`Status: ${groupStatus}`);
    doc.text(`Generated: ${new Date().toLocaleString('en-US')}`);

    // Aggregate stats
    const roomSummaries = inspections.map((insp) => {
      const s = inspectionSummary(insp);
      const isCompletedMarker = (insp.items || []).some(
        (i) => i.zone === '_Completed' && i.status === 'Yes',
      );
      return { inspection: insp, summary: s, completed: isCompletedMarker };
    });
    const roomsInspected = roomSummaries.filter((r) => r.completed || r.summary.answered > 0).length;
    const roomsSkipped = roomSummaries.filter((r) => !r.completed && r.summary.answered === 0);
    const totalFlagged = roomSummaries.reduce((a, r) => a + r.summary.flagged.length, 0);
    const totalMaint = roomSummaries.reduce((a, r) => a + r.summary.maintenance.length, 0);
    const totalViol = roomSummaries.reduce((a, r) => a + r.summary.violations.length, 0);

    doc.moveDown(0.75);
    doc.fontSize(13).fillColor('#2C2C2C').text('Summary', { underline: true });
    doc.moveDown(0.25);
    doc.fontSize(11).fillColor('#2C2C2C');
    doc.text(`Rooms inspected: ${roomsInspected} / ${roomSummaries.length} total`);
    if (roomsSkipped.length > 0) {
      doc.fillColor('#C4703F').text(
        `Rooms unable to be completed: ${roomsSkipped.map((r) => r.inspection.room?.label || '?').join(', ')}`,
      );
      doc.fillColor('#2C2C2C');
    }
    doc.text(`Flagged items total: ${totalFlagged}`);
    doc.text(`Maintenance items: ${totalMaint}`);
    doc.text(`Lease violations: ${totalViol}`);

    // Room-by-room summary list
    doc.moveDown(0.75);
    doc.fontSize(13).fillColor('#2C2C2C').text('Room-by-room', { underline: true });
    doc.moveDown(0.25);
    doc.fontSize(11).fillColor('#2C2C2C');
    for (const { inspection: insp, summary: s } of roomSummaries) {
      const roomLabel = insp.room?.label || 'Room';
      const parts = [];
      if (s.maintenance.length > 0) parts.push(`Maintenance: ${s.maintenance.length}`);
      if (s.violations.length > 0) parts.push(`Violations: ${s.violations.length}`);
      const otherFlagged = s.flagged.filter(
        (i) => !i.isMaintenance && !i.isLeaseViolation,
      ).length;
      if (otherFlagged > 0) parts.push(`Other flags: ${otherFlagged}`);

      const isSkipped = s.answered === 0;
      const isPartial = s.answered > 0 && s.answered < s.total;
      let statePrefix = '';
      if (isSkipped) statePrefix = 'Skipped';
      else if (isPartial) statePrefix = `Partial (${s.answered}/${s.total})`;

      let suffix;
      if (statePrefix && parts.length > 0) {
        suffix = `${statePrefix} — ${parts.join(', ')}`;
      } else if (statePrefix) {
        suffix = statePrefix;
      } else if (parts.length > 0) {
        suffix = parts.join(', ');
      } else {
        suffix = 'All clear';
      }
      const bold = parts.length > 0 || isSkipped || isPartial;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(`${roomLabel}: ${suffix}`);
    }
    doc.font('Helvetica');

    // ─── PAGES 2+: per room with issues ─────────────
    const roomsWithIssues = roomSummaries.filter(
      (r) => r.summary.flagged.length > 0,
    );

    for (const { inspection: insp, summary: s } of roomsWithIssues) {
      doc.addPage();
      const roomLabel = insp.room?.label || 'Room';
      doc.fontSize(18).fillColor('#2C2C2C').text(roomLabel);
      doc.moveDown(0.25);
      doc.fontSize(11).fillColor('#8A8580')
        .text(`Items answered: ${s.answered}  |  Passed: ${s.passed}  |  Flagged: ${s.flagged.length}`);
      doc.text(`Maintenance items: ${s.maintenance.length}`);
      doc.text(`Lease violations: ${s.violations.length}`);

      // Maintenance items
      if (s.maintenance.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#C4703F').text('Maintenance');
        doc.font('Helvetica').fillColor('#2C2C2C');
        for (const item of s.maintenance) {
          doc.moveDown(0.25);
          const title = (item.note && item.note.trim()) || item.text;
          doc.fontSize(11).font('Helvetica-Bold').fillColor('#2C2C2C').text(title);
          doc.font('Helvetica').fontSize(10);
          const meta = [];
          if (item.flagCategory) meta.push(item.flagCategory);
          if (item.priority) meta.push(item.priority + ' priority');
          if (meta.length) doc.fillColor('#8A8580').text(meta.join(' · ')).fillColor('#2C2C2C');
          if (item.note && item.note !== title) doc.text(item.note);
          if (item.photos?.length) {
            await embedPhotos(doc, item.photos);
          }
        }
      }

      // Lease violations
      if (s.violations.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#D85A30').text('Lease violations');
        doc.font('Helvetica').fillColor('#2C2C2C');
        for (const item of s.violations) {
          doc.moveDown(0.25);
          doc.fontSize(11).font('Helvetica-Bold').fillColor('#2C2C2C').text(item.text);
          doc.font('Helvetica').fontSize(10);
          if (item.note) doc.text(item.note);
          if (item.photos?.length) {
            await embedPhotos(doc, item.photos);
          }
        }
      }

      // Any other flagged items (flagCategory without maintenance/violation)
      const otherFlagged = s.flagged.filter(
        (i) => !i.isMaintenance && !i.isLeaseViolation,
      );
      if (otherFlagged.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#8A8580').text('Other flagged items');
        doc.font('Helvetica').fillColor('#2C2C2C');
        for (const item of otherFlagged) {
          doc.moveDown(0.25);
          const title = (item.note && item.note.trim()) || item.text;
          doc.fontSize(11).font('Helvetica-Bold').fillColor('#2C2C2C').text(title);
          doc.font('Helvetica').fontSize(10);
          if (item.flagCategory) doc.fillColor('#8A8580').text(item.flagCategory).fillColor('#2C2C2C');
          if (item.note && item.note !== title) doc.text(item.note);
          if (item.photos?.length) {
            await embedPhotos(doc, item.photos);
          }
        }
      }
    }

    // ─── LAST PAGE: COMMON AREA QUICK CHECK ─────────
    const quickItems = [];
    for (const insp of inspections) {
      for (const it of (insp.items || [])) {
        if (it.zone?.startsWith('_QuickCommon:')) quickItems.push(it);
      }
    }
    const touchedQuick = quickItems.filter((i) => i.status);
    if (touchedQuick.length > 0) {
      doc.addPage();
      doc.fontSize(18).fillColor('#2C2C2C').text('Common Area Quick Check');
      doc.moveDown(0.25);
      doc.fontSize(11).fillColor('#8A8580').text('Shared spaces checked during this inspection.');
      doc.moveDown(0.5);
      // Group by kind
      const groups = {};
      for (const it of touchedQuick) {
        const kind = (it.zone.split(':')[1] || 'Other');
        if (!groups[kind]) groups[kind] = [];
        groups[kind].push(it);
      }
      for (const kind of Object.keys(groups)) {
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#2C2C2C').text(`${kind}s`);
        doc.font('Helvetica').fontSize(11);
        for (const it of groups[kind]) {
          const mark = it.status === 'Pass' ? 'Pass' : 'Fail';
          const color = it.status === 'Pass' ? '#3B6D11' : '#C0392B';
          doc.fillColor('#2C2C2C').text(`${it.text}: `, { continued: true });
          doc.fillColor(color).text(mark);
          if (it.status === 'Fail' && (it.note || it.flagCategory || it.photos?.length)) {
            doc.fontSize(10).fillColor('#8A8580');
            if (it.flagCategory) doc.text(`  ${it.flagCategory}`);
            if (it.note) doc.fillColor('#2C2C2C').text(`  ${it.note}`);
            if (it.photos?.length) {
              await embedPhotos(doc, it.photos);
            }
            doc.fontSize(11).fillColor('#2C2C2C');
          }
        }
        doc.moveDown(0.35);
      }
    }

    doc.end();
  } catch (error) {
    console.error('Quarterly group PDF error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
