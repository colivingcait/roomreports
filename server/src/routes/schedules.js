import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { propertyIdScope } from '../lib/scope.js';

const router = Router();
router.use(requireAuth);

const DAY_MS = 24 * 60 * 60 * 1000;

const INSPECTION_TYPES = [
  'COMMON_AREA', 'ROOM_TURN', 'QUARTERLY',
  'RESIDENT_SELF_CHECK', 'MOVE_IN_OUT',
];

function nextDue(startsOn, lastCompletedAt, frequencyDays) {
  const baseline = lastCompletedAt ? new Date(lastCompletedAt) : new Date(startsOn);
  return new Date(baseline.getTime() + frequencyDays * DAY_MS);
}

// ─── GET /api/schedules — list schedules (optionally per property) ──

router.get('/', async (req, res) => {
  try {
    const { propertyId } = req.query;
    const scope = await propertyIdScope(req.user);

    const where = { organizationId: req.user.organizationId, ...scope };
    if (propertyId) where.propertyId = propertyId;

    const schedules = await prisma.inspectionSchedule.findMany({
      where,
      orderBy: [{ propertyId: 'asc' }, { inspectionType: 'asc' }],
    });

    // Hydrate the next-due date from the most recent completed inspection per (property, type)
    const keys = schedules.map((s) => ({ propertyId: s.propertyId, type: s.inspectionType }));
    const lastMap = {};
    if (keys.length > 0) {
      const inspections = await prisma.inspection.findMany({
        where: {
          organizationId: req.user.organizationId,
          propertyId: { in: keys.map((k) => k.propertyId) },
          type: { in: [...new Set(keys.map((k) => k.type))] },
          status: { in: ['SUBMITTED', 'REVIEWED'] },
          deletedAt: null,
        },
        select: { propertyId: true, type: true, createdAt: true, completedAt: true },
        orderBy: { createdAt: 'desc' },
      });
      for (const i of inspections) {
        const k = `${i.propertyId}:${i.type}`;
        if (!lastMap[k]) lastMap[k] = i.completedAt || i.createdAt;
      }
    }

    const out = schedules.map((s) => {
      const last = lastMap[`${s.propertyId}:${s.inspectionType}`] || null;
      const due = nextDue(s.startsOn, last, s.frequencyDays);
      return {
        ...s,
        lastCompletedAt: last,
        nextDueAt: due,
        isOverdue: s.active && due < new Date(),
      };
    });

    return res.json({ schedules: out });
  } catch (error) {
    console.error('List schedules error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/schedules ────────────────────────────────

router.post('/', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { propertyId, inspectionType, frequencyDays, startsOn, notes } = req.body || {};
    if (!propertyId || !inspectionType || !frequencyDays) {
      return res.status(400).json({ error: 'propertyId, inspectionType, and frequencyDays are required' });
    }
    if (!INSPECTION_TYPES.includes(inspectionType)) {
      return res.status(400).json({ error: 'invalid inspectionType' });
    }
    const freq = Number(frequencyDays);
    if (!freq || freq < 1) return res.status(400).json({ error: 'frequencyDays must be positive' });

    const property = await prisma.property.findFirst({
      where: { id: propertyId, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!property) return res.status(404).json({ error: 'Property not found' });

    // Upsert on (propertyId, inspectionType) so it's idempotent
    const schedule = await prisma.inspectionSchedule.upsert({
      where: { propertyId_inspectionType: { propertyId, inspectionType } },
      create: {
        organizationId: req.user.organizationId,
        propertyId,
        inspectionType,
        frequencyDays: freq,
        startsOn: startsOn ? new Date(startsOn) : new Date(),
        notes: notes || null,
      },
      update: {
        frequencyDays: freq,
        ...(startsOn !== undefined ? { startsOn: startsOn ? new Date(startsOn) : new Date() } : {}),
        notes: notes ?? null,
        active: true,
      },
    });
    return res.status(201).json({ schedule });
  } catch (error) {
    console.error('Create schedule error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/schedules/:id ─────────────────────────────

router.put('/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const existing = await prisma.inspectionSchedule.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!existing) return res.status(404).json({ error: 'Schedule not found' });
    const { frequencyDays, startsOn, notes, active } = req.body || {};
    const data = {};
    if (frequencyDays !== undefined) data.frequencyDays = Number(frequencyDays);
    if (startsOn !== undefined) data.startsOn = startsOn ? new Date(startsOn) : new Date();
    if (notes !== undefined) data.notes = notes || null;
    if (active !== undefined) data.active = !!active;
    const updated = await prisma.inspectionSchedule.update({
      where: { id: existing.id }, data,
    });
    return res.json({ schedule: updated });
  } catch (error) {
    console.error('Update schedule error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/schedules/:id ──────────────────────────

router.delete('/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const existing = await prisma.inspectionSchedule.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!existing) return res.status(404).json({ error: 'Schedule not found' });
    await prisma.inspectionSchedule.delete({ where: { id: existing.id } });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete schedule error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/schedules/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD ──
// Returns:
//   completed: inspections in that range
//   upcoming: next-due dates for active schedules that fall in the range
//             (+ include today's overdue even if older)

router.get('/calendar', async (req, res) => {
  try {
    const start = req.query.start ? new Date(req.query.start) : new Date(Date.now() - 30 * DAY_MS);
    const end = req.query.end ? new Date(req.query.end) : new Date(Date.now() + 60 * DAY_MS);
    const scope = await propertyIdScope(req.user);

    const completed = await prisma.inspection.findMany({
      where: {
        organizationId: req.user.organizationId,
        deletedAt: null,
        status: { in: ['SUBMITTED', 'REVIEWED'] },
        completedAt: { gte: start, lte: end },
        ...scope,
      },
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
      },
      orderBy: { completedAt: 'asc' },
    });

    const schedules = await prisma.inspectionSchedule.findMany({
      where: {
        organizationId: req.user.organizationId,
        active: true,
        ...scope,
      },
      include: { /* none */ },
    });

    // Next-due per schedule
    const lastMap = {};
    if (schedules.length > 0) {
      const latest = await prisma.inspection.findMany({
        where: {
          organizationId: req.user.organizationId,
          propertyId: { in: schedules.map((s) => s.propertyId) },
          type: { in: [...new Set(schedules.map((s) => s.inspectionType))] },
          status: { in: ['SUBMITTED', 'REVIEWED'] },
          deletedAt: null,
        },
        select: { propertyId: true, type: true, completedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      for (const i of latest) {
        const k = `${i.propertyId}:${i.type}`;
        if (!lastMap[k]) lastMap[k] = i.completedAt || i.createdAt;
      }
    }

    const propIds = [...new Set(schedules.map((s) => s.propertyId))];
    const propMap = {};
    if (propIds.length > 0) {
      const props = await prisma.property.findMany({
        where: { id: { in: propIds } },
        select: { id: true, name: true },
      });
      for (const p of props) propMap[p.id] = p;
    }

    const upcoming = schedules.map((s) => {
      const last = lastMap[`${s.propertyId}:${s.inspectionType}`] || null;
      const due = nextDue(s.startsOn, last, s.frequencyDays);
      return {
        scheduleId: s.id,
        propertyId: s.propertyId,
        property: propMap[s.propertyId] || null,
        inspectionType: s.inspectionType,
        frequencyDays: s.frequencyDays,
        nextDueAt: due,
        isOverdue: due < new Date(),
      };
    }).filter((u) => u.nextDueAt >= start && u.nextDueAt <= end);

    return res.json({ completed, upcoming });
  } catch (error) {
    console.error('Calendar error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
