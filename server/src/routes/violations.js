import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { propertyIdScope } from '../lib/scope.js';

const router = Router();
router.use(requireAuth);

const METHODS = ['text', 'email', 'verbal', 'written_notice', 'other'];

async function hydrateViolations(violations, orgId) {
  if (violations.length === 0) return [];
  const propIds = [...new Set(violations.map((v) => v.propertyId).filter(Boolean))];
  const roomIds = [...new Set(violations.map((v) => v.roomId).filter(Boolean))];

  const [props, rooms] = await Promise.all([
    propIds.length
      ? prisma.property.findMany({
          where: { id: { in: propIds }, organizationId: orgId },
          select: { id: true, name: true, address: true },
        })
      : [],
    roomIds.length
      ? prisma.room.findMany({
          where: { id: { in: roomIds } },
          select: { id: true, label: true, propertyId: true },
        })
      : [],
  ]);
  const propMap = Object.fromEntries(props.map((p) => [p.id, p]));
  const roomMap = Object.fromEntries(rooms.map((r) => [r.id, r]));

  return violations.map((v) => ({
    ...v,
    property: v.propertyId ? propMap[v.propertyId] || null : null,
    room: v.roomId ? roomMap[v.roomId] || null : null,
  }));
}

// ─── GET /api/violations ────────────────────────────────
// Owner/PM only — the violations log is a management surface.
// Cleaners still flag violations during inspections, but they don't
// read the log.

router.get('/', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { propertyId, roomId, active, includeArchived } = req.query;
    const scope = await propertyIdScope(req.user);
    const where = {
      organizationId: req.user.organizationId,
      deletedAt: null,
      ...scope,
    };
    if (propertyId) where.propertyId = propertyId;
    if (roomId) where.roomId = roomId;
    if (active === 'true') where.resolvedAt = null;
    // Archived violations are excluded by default so they don't count
    // toward active tallies / health grades.
    if (includeArchived !== 'true') where.archivedAt = null;

    const violations = await prisma.leaseViolation.findMany({
      where,
      include: { actions: { orderBy: { actionAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
    const hydrated = await hydrateViolations(violations, req.user.organizationId);
    return res.json({ violations: hydrated });
  } catch (error) {
    console.error('List violations error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/violations — manually log (outside of inspection) ──

router.post('/', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { propertyId, roomId, category, description, note } = req.body || {};

    if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
    if (!description?.trim()) return res.status(400).json({ error: 'description is required' });

    const property = await prisma.property.findFirst({
      where: { id: propertyId, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!property) return res.status(404).json({ error: 'Property not found' });

    let room = null;
    if (roomId) {
      room = await prisma.room.findFirst({
        where: { id: roomId, propertyId, deletedAt: null },
      });
      if (!room) return res.status(404).json({ error: 'Room not found' });
    }

    const violation = await prisma.leaseViolation.create({
      data: {
        organizationId: req.user.organizationId,
        propertyId,
        roomId: room?.id || null,
        inspectionId: null,
        inspectionItemId: null,
        description: description.trim(),
        category: category || null,
        note: note || null,
        reportedById: req.user.id,
        reportedByName: req.user.name,
      },
    });
    return res.status(201).json({ violation });
  } catch (error) {
    console.error('Create violation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/violations/:id ────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const v = await prisma.leaseViolation.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
      include: { actions: { orderBy: { actionAt: 'desc' } } },
    });
    if (!v) return res.status(404).json({ error: 'Violation not found' });
    const [hydrated] = await hydrateViolations([v], req.user.organizationId);
    return res.json({ violation: hydrated });
  } catch (error) {
    console.error('Get violation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/violations/:id (resolve / unresolve / edit note) ──

router.put('/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const v = await prisma.leaseViolation.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });
    if (!v) return res.status(404).json({ error: 'Violation not found' });
    const { note, resolved } = req.body || {};
    const data = {};
    if (note !== undefined) data.note = note || null;
    if (resolved === true && !v.resolvedAt) data.resolvedAt = new Date();
    if (resolved === false) data.resolvedAt = null;
    const updated = await prisma.leaseViolation.update({ where: { id: v.id }, data });
    return res.json({ violation: updated });
  } catch (error) {
    console.error('Update violation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/violations/:id/actions ───────────────────

// ─── POST /api/violations/:id/follow-up ─────────────────
// Creates a maintenance ticket linked back to this violation. Tagged
// `isLeaseFollowUp: true` so the kanban can mark it visually distinct.

router.post('/:id/follow-up', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const v = await prisma.leaseViolation.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });
    if (!v) return res.status(404).json({ error: 'Violation not found' });

    const { title, priority, note, dueAt, flagCategory } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    let parsedDueAt = null;
    if (dueAt) {
      const d = new Date(dueAt);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'dueAt is invalid' });
      parsedDueAt = d;
    }

    const created = await prisma.maintenanceItem.create({
      data: {
        organizationId: req.user.organizationId,
        propertyId: v.propertyId,
        roomId: v.roomId || null,
        inspectionId: v.inspectionId || null,
        inspectionItemId: null,
        description: String(title).trim(),
        zone: 'Lease follow-up',
        flagCategory: flagCategory || v.category || 'Lease Compliance',
        priority: priority || 'Medium',
        status: 'OPEN',
        note: note || `Lease violation recorded${v.createdAt ? ` on ${new Date(v.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}. Follow up to ensure compliance.`,
        reportedById: req.user.id,
        reportedByName: req.user.name,
        reportedByRole: req.user.role,
        isLeaseFollowUp: true,
        leaseViolationId: v.id,
        dueAt: parsedDueAt,
      },
    });

    await prisma.maintenanceEvent.create({
      data: {
        maintenanceItemId: created.id,
        type: 'created',
        toValue: 'OPEN',
        note: 'Created from lease violation follow-up',
        byUserId: req.user.id,
        byUserName: req.user.name,
      },
    });

    return res.status(201).json({ item: created });
  } catch (err) {
    console.error('Create violation follow-up error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/actions', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const v = await prisma.leaseViolation.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });
    if (!v) return res.status(404).json({ error: 'Violation not found' });

    const { method, description, actionAt } = req.body || {};
    if (!method || !METHODS.includes(method)) {
      return res.status(400).json({ error: `method must be one of ${METHODS.join(', ')}` });
    }
    if (!description?.trim()) {
      return res.status(400).json({ error: 'description is required' });
    }

    const action = await prisma.leaseViolationAction.create({
      data: {
        leaseViolationId: v.id,
        organizationId: req.user.organizationId,
        method,
        description: description.trim(),
        actionAt: actionAt ? new Date(actionAt) : new Date(),
        loggedById: req.user.id,
        loggedByName: req.user.name,
      },
    });
    return res.status(201).json({ action });
  } catch (error) {
    console.error('Create violation action error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
