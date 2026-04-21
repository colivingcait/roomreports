import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { signPropertyInvite } from '../lib/propertyInvite.js';
import { propertyScope } from '../lib/scope.js';
import { computeHealth } from '../lib/healthGrade.js';
import { planLimit, wouldExceed } from '../../../shared/features.js';
import { uploadFile, deleteFile } from '../lib/storage.js';

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

const DAY_MS = 24 * 60 * 60 * 1000;

async function gradePropertyIds(orgId, propertyIds) {
  if (propertyIds.length === 0) return {};

  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY_MS);

  // Open maintenance counts per property (excluding RESOLVED)
  const openMaint = await prisma.maintenanceItem.groupBy({
    by: ['propertyId'],
    where: {
      organizationId: orgId,
      propertyId: { in: propertyIds },
      deletedAt: null,
      status: { not: 'RESOLVED' },
    },
    _count: true,
  });
  const openMap = {};
  for (const row of openMaint) openMap[row.propertyId] = row._count;

  // Resolved maintenance in the last 90 days — for resolution-time average
  const resolvedRecent = await prisma.maintenanceItem.findMany({
    where: {
      organizationId: orgId,
      propertyId: { in: propertyIds },
      status: 'RESOLVED',
      deletedAt: null,
      resolvedAt: { gte: ninetyDaysAgo },
    },
    select: { propertyId: true, createdAt: true, resolvedAt: true },
  });
  const resMap = {};
  for (const r of resolvedRecent) {
    const days = (new Date(r.resolvedAt) - new Date(r.createdAt)) / DAY_MS;
    if (!resMap[r.propertyId]) resMap[r.propertyId] = [];
    resMap[r.propertyId].push(days);
  }

  // Recent inspections for fail ratio — and last-inspection per property
  const recentInspections = await prisma.inspection.findMany({
    where: {
      organizationId: orgId,
      propertyId: { in: propertyIds },
      createdAt: { gte: ninetyDaysAgo },
      status: { in: ['SUBMITTED', 'REVIEWED'] },
      deletedAt: null,
    },
    include: {
      items: {
        where: { NOT: { zone: { startsWith: '_' } } },
        select: { status: true },
      },
    },
  });
  const failMap = {}; // { propertyId: { total, failed } }
  for (const insp of recentInspections) {
    const bucket = failMap[insp.propertyId] || { total: 0, failed: 0 };
    for (const it of insp.items) {
      bucket.total += 1;
      if (it.status === 'Fail') bucket.failed += 1;
    }
    failMap[insp.propertyId] = bucket;
  }

  // Active violations (non-archived, unresolved) — for escalation badges
  const activeViolations = await prisma.leaseViolation.groupBy({
    by: ['propertyId'],
    where: {
      organizationId: orgId,
      propertyId: { in: propertyIds },
      deletedAt: null,
      archivedAt: null,
      resolvedAt: null,
    },
    _count: true,
  });
  const violationMap = {};
  for (const row of activeViolations) violationMap[row.propertyId] = row._count;

  // Overdue inspection schedules
  const schedules = await prisma.inspectionSchedule.findMany({
    where: {
      organizationId: orgId,
      propertyId: { in: propertyIds },
      active: true,
    },
  });
  const lastByKey = await prisma.inspection.findMany({
    where: {
      organizationId: orgId,
      propertyId: { in: propertyIds },
      status: { in: ['SUBMITTED', 'REVIEWED'] },
      deletedAt: null,
    },
    select: { propertyId: true, type: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const lastMap = {};
  for (const r of lastByKey) {
    const key = `${r.propertyId}:${r.type}`;
    if (!lastMap[key]) lastMap[key] = r.createdAt;
  }
  const overdueMap = {};
  for (const s of schedules) {
    const last = lastMap[`${s.propertyId}:${s.inspectionType}`];
    const baseline = last || s.startsOn;
    const nextDue = new Date(new Date(baseline).getTime() + s.frequencyDays * DAY_MS);
    if (nextDue < now) overdueMap[s.propertyId] = (overdueMap[s.propertyId] || 0) + 1;
  }

  // Last inspection (any type) per property — for the card display
  const lastAnyInspection = {};
  for (const r of lastByKey) {
    if (!lastAnyInspection[r.propertyId] || new Date(r.createdAt) > new Date(lastAnyInspection[r.propertyId].date)) {
      lastAnyInspection[r.propertyId] = { date: r.createdAt, type: r.type };
    }
  }

  const out = {};
  for (const pid of propertyIds) {
    const resolutionDays = resMap[pid]?.length
      ? resMap[pid].reduce((a, b) => a + b, 0) / resMap[pid].length
      : null;
    const fails = failMap[pid];
    const failRatio = fails?.total ? fails.failed / fails.total : 0;
    const { score, grade } = computeHealth({
      openMaintenanceCount: openMap[pid] || 0,
      overdueInspectionCount: overdueMap[pid] || 0,
      failRatio,
      avgResolutionDays: resolutionDays,
    });
    out[pid] = {
      score,
      grade,
      openMaintenanceCount: openMap[pid] || 0,
      overdueInspectionCount: overdueMap[pid] || 0,
      avgResolutionDays: resolutionDays,
      activeViolationCount: violationMap[pid] || 0,
      lastInspection: lastAnyInspection[pid] || null,
    };
  }
  return out;
}

const router = Router();

// All property routes require authentication
router.use(requireAuth);

// ─── Helpers ────────────────────────────────────────────

async function findOrgProperty(propertyId, organizationId) {
  return prisma.property.findFirst({
    where: { id: propertyId, organizationId, deletedAt: null },
  });
}

// ─── Properties CRUD ────────────────────────────────────

// GET /api/properties — list all properties for the user's org
// ?withHealth=true → returns a health grade per property
router.get('/', async (req, res) => {
  try {
    const scope = await propertyScope(req.user);
    const properties = await prisma.property.findMany({
      where: { organizationId: req.user.organizationId, deletedAt: null, ...scope },
      include: {
        _count: {
          select: {
            rooms: { where: { deletedAt: null } },
            kitchens: { where: { deletedAt: null } },
            bathrooms: { where: { deletedAt: null } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    let out = properties;
    if (req.query.withHealth === 'true' && properties.length > 0) {
      const grades = await gradePropertyIds(
        req.user.organizationId,
        properties.map((p) => p.id),
      );
      out = properties.map((p) => ({ ...p, health: grades[p.id] || null }));
    }

    return res.json({ properties: out });
  } catch (error) {
    console.error('List properties error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/properties — create property
router.post('/', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { name, address } = req.body;

    if (!name || !address) {
      return res.status(400).json({ error: 'name and address are required' });
    }

    // Enforce property limit for this org's plan (beta bypasses via planLimit → Infinity)
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { plan: true, isBeta: true },
    });
    const currentCount = await prisma.property.count({
      where: { organizationId: req.user.organizationId, deletedAt: null },
    });
    if (wouldExceed(org, 'properties', currentCount)) {
      return res.status(403).json({
        error: 'Property limit reached for your plan',
        code: 'PLAN_LIMIT_PROPERTIES',
        limit: planLimit(org, 'properties'),
        currentCount,
      });
    }

    const property = await prisma.property.create({
      data: {
        name,
        address,
        organizationId: req.user.organizationId,
      },
    });

    return res.status(201).json({ property });
  } catch (error) {
    console.error('Create property error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/properties/:id/overview — single-property mini-dashboard
router.get('/:id/overview', async (req, res) => {
  try {
    const property = await prisma.property.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
      include: {
        rooms: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        kitchens: { where: { deletedAt: null } },
        bathrooms: { where: { deletedAt: null } },
      },
    });

    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    // Open maintenance items grouped by room
    const maintenance = await prisma.maintenanceItem.findMany({
      where: {
        propertyId: property.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
        status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
      },
      include: {
        room: { select: { id: true, label: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Per-room maintenance counts
    const roomMaintCounts = {};
    const commonAreaMaint = [];
    for (const m of maintenance) {
      if (m.roomId) {
        roomMaintCounts[m.roomId] = (roomMaintCounts[m.roomId] || 0) + 1;
      } else {
        commonAreaMaint.push(m);
      }
    }

    // Recent inspections for this property
    const inspections = await prisma.inspection.findMany({
      where: {
        propertyId: property.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
      include: {
        room: { select: { id: true, label: true } },
        inspector: { select: { name: true, role: true, customRole: true } },
        items: {
          where: { flagCategory: { not: null } },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Per-room last inspection
    const roomLastInspection = {};
    for (const insp of inspections) {
      if (insp.roomId && !roomLastInspection[insp.roomId]) {
        roomLastInspection[insp.roomId] = {
          date: insp.createdAt,
          type: insp.type,
          status: insp.status,
        };
      }
    }

    // Common area last inspection
    const lastCommonArea = inspections.find((i) => i.type === 'COMMON_AREA');
    const daysSinceCommonArea = lastCommonArea
      ? Math.floor((Date.now() - new Date(lastCommonArea.createdAt)) / (1000 * 60 * 60 * 24))
      : null;

    // Overdue rooms: last quarterly > 90 days ago or never
    const overdueRooms = [];
    for (const room of property.rooms) {
      const lastQuarterly = inspections.find(
        (i) => i.roomId === room.id && i.type === 'QUARTERLY',
      );
      const daysSince = lastQuarterly
        ? Math.floor((Date.now() - new Date(lastQuarterly.createdAt)) / (1000 * 60 * 60 * 24))
        : null;
      if (daysSince === null || daysSince >= 90) {
        overdueRooms.push({
          id: room.id,
          label: room.label,
          daysSince,
        });
      }
    }

    // Active (non-archived, unresolved) violations per room — used for
    // escalation badges on room cards
    const activeViolations = await prisma.leaseViolation.findMany({
      where: {
        propertyId: property.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
        archivedAt: null,
        resolvedAt: null,
      },
      select: { roomId: true },
    });
    const violationsByRoom = {};
    for (const v of activeViolations) {
      if (!v.roomId) continue;
      violationsByRoom[v.roomId] = (violationsByRoom[v.roomId] || 0) + 1;
    }

    // Build room cards data
    const roomCards = property.rooms.map((r) => ({
      id: r.id,
      label: r.label,
      features: r.features,
      furniture: r.furniture,
      openMaintenanceCount: roomMaintCounts[r.id] || 0,
      activeViolationCount: violationsByRoom[r.id] || 0,
      lastInspection: roomLastInspection[r.id] || null,
      lastTurnoverAt: r.lastTurnoverAt || null,
    }));

    // Overall health
    const totalOpen = maintenance.length;
    const health = totalOpen >= 6 ? 'red' : totalOpen >= 3 ? 'yellow' : 'green';

    // Maintenance grouped by room for display
    const maintByRoom = {};
    for (const m of maintenance) {
      const key = m.roomId || '_common';
      const label = m.room?.label || 'Common Areas';
      if (!maintByRoom[key]) maintByRoom[key] = { label, items: [] };
      maintByRoom[key].items.push({
        id: m.id,
        description: m.description,
        zone: m.zone,
        status: m.status,
        flagCategory: m.flagCategory,
        priority: m.priority,
        assignedTo: m.assignedTo,
        createdAt: m.createdAt,
      });
    }

    return res.json({
      property: {
        id: property.id,
        name: property.name,
        address: property.address,
        roomCount: property.rooms.length,
        kitchenCount: property.kitchens.length,
        bathroomCount: property.bathrooms.length,
      },
      health,
      totalOpenMaintenance: totalOpen,
      roomCards,
      maintenanceByRoom: maintByRoom,
      recentInspections: inspections.map((i) => ({
        id: i.id,
        type: i.type,
        status: i.status,
        createdAt: i.createdAt,
        completedAt: i.completedAt,
        roomId: i.roomId || null,
        roomLabel: i.room?.label || null,
        inspectorName: i.inspector?.name,
        flagCount: i.items.length,
      })),
      commonArea: {
        lastInspectionDate: lastCommonArea?.createdAt || null,
        daysSince: daysSinceCommonArea,
        openFlags: commonAreaMaint.length,
      },
      overdueRooms,
    });
  } catch (error) {
    console.error('Property overview error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/properties/:id/qr-token — signed token for resident QR code
router.get('/:id/qr-token', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const property = await prisma.property.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!property) return res.status(404).json({ error: 'Property not found' });

    const token = signPropertyInvite(property.id, req.user.organizationId);
    return res.json({ token });
  } catch (error) {
    console.error('QR token error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/properties/:id — get property with rooms, kitchens, bathrooms
router.get('/:id', async (req, res) => {
  try {
    const scope = await propertyScope(req.user);
    const property = await prisma.property.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
        ...scope,
      },
      include: {
        rooms: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        kitchens: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        bathrooms: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });

    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    return res.json({ property });
  } catch (error) {
    console.error('Get property error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/properties/:id — update property
router.put('/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const property = await findOrgProperty(req.params.id, req.user.organizationId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const { name, address } = req.body;
    const updated = await prisma.property.update({
      where: { id: property.id },
      data: {
        ...(name !== undefined && { name }),
        ...(address !== undefined && { address }),
      },
    });

    return res.json({ property: updated });
  } catch (error) {
    console.error('Update property error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/properties/:id — soft delete
router.delete('/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const property = await findOrgProperty(req.params.id, req.user.organizationId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    await prisma.property.update({
      where: { id: property.id },
      data: { deletedAt: new Date() },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete property error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Property image ─────────────────────────────────────

// POST /api/properties/:id/image — upload a property cover image (OWNER/PM)
router.post(
  '/:id/image',
  requireRole('OWNER', 'PM'),
  uploadImage.single('photo'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const property = await findOrgProperty(req.params.id, req.user.organizationId);
      if (!property) return res.status(404).json({ error: 'Property not found' });

      // Resize to a reasonable cover size, keep aspect ratio, center-crop-ish.
      const resized = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 1200, height: 800, fit: 'cover', position: 'centre' })
        .jpeg({ quality: 85 })
        .toBuffer();

      const key = `property-images/${property.id}/${Date.now()}.jpg`;
      const { url } = await uploadFile(key, resized, 'image/jpeg');

      // If there was a previous image in our bucket, best-effort delete it so
      // we don't accumulate orphans. Silent on failure.
      const previous = property.imageUrl;
      if (previous) {
        const match = previous.match(/property-images\/[^?]+/);
        if (match) deleteFile(match[0]).catch(() => {});
      }

      const updated = await prisma.property.update({
        where: { id: property.id },
        data: { imageUrl: url },
      });
      return res.status(201).json({ property: updated });
    } catch (error) {
      console.error('Property image upload error:', error);
      if (error.message === 'Only image files are allowed') {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// DELETE /api/properties/:id/image — clear the property image
router.delete('/:id/image', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const property = await findOrgProperty(req.params.id, req.user.organizationId);
    if (!property) return res.status(404).json({ error: 'Property not found' });

    if (property.imageUrl) {
      const match = property.imageUrl.match(/property-images\/[^?]+/);
      if (match) deleteFile(match[0]).catch(() => {});
    }

    const updated = await prisma.property.update({
      where: { id: property.id },
      data: { imageUrl: null },
    });
    return res.json({ property: updated });
  } catch (error) {
    console.error('Property image delete error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Rooms CRUD ─────────────────────────────────────────

// POST /api/properties/:id/rooms
router.post('/:id/rooms', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const property = await findOrgProperty(req.params.id, req.user.organizationId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const { label, features, furniture } = req.body;
    if (!label) {
      return res.status(400).json({ error: 'label is required' });
    }

    const room = await prisma.room.create({
      data: {
        label,
        features: features || [],
        furniture: furniture || [],
        propertyId: property.id,
      },
    });

    return res.status(201).json({ room });
  } catch (error) {
    console.error('Create room error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/properties/:id/rooms/:roomId
router.put('/:id/rooms/:roomId', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const property = await findOrgProperty(req.params.id, req.user.organizationId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const room = await prisma.room.findFirst({
      where: { id: req.params.roomId, propertyId: property.id, deletedAt: null },
    });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const { label, features, furniture } = req.body;
    const updated = await prisma.room.update({
      where: { id: room.id },
      data: {
        ...(label !== undefined && { label }),
        ...(features !== undefined && { features }),
        ...(furniture !== undefined && { furniture }),
      },
    });

    return res.json({ room: updated });
  } catch (error) {
    console.error('Update room error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/properties/:id/rooms/:roomId/turnover
// Archives all active lease violations for this room (they stay visible in
// history but don't count toward active tallies or health) and stamps the
// room's lastTurnoverAt. Full historical record preserved.
router.post('/:id/rooms/:roomId/turnover', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const property = await findOrgProperty(req.params.id, req.user.organizationId);
    if (!property) return res.status(404).json({ error: 'Property not found' });

    const room = await prisma.room.findFirst({
      where: { id: req.params.roomId, propertyId: property.id, deletedAt: null },
    });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const turnoverAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const archived = await tx.leaseViolation.updateMany({
        where: {
          roomId: room.id,
          organizationId: req.user.organizationId,
          archivedAt: null,
          deletedAt: null,
        },
        data: { archivedAt: turnoverAt, archivedReason: 'Room turnover' },
      });
      const updatedRoom = await tx.room.update({
        where: { id: room.id },
        data: { lastTurnoverAt: turnoverAt },
      });
      return { violationsArchived: archived.count, room: updatedRoom };
    });

    return res.json(result);
  } catch (error) {
    console.error('Room turnover error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/properties/:id/rooms/:roomId
router.delete('/:id/rooms/:roomId', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const property = await findOrgProperty(req.params.id, req.user.organizationId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const room = await prisma.room.findFirst({
      where: { id: req.params.roomId, propertyId: property.id, deletedAt: null },
    });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    await prisma.room.update({
      where: { id: room.id },
      data: { deletedAt: new Date() },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete room error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Kitchens CRUD ──────────────────────────────────────

// POST /api/properties/:id/kitchens
router.post('/:id/kitchens', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const property = await findOrgProperty(req.params.id, req.user.organizationId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const { label } = req.body;
    if (!label) {
      return res.status(400).json({ error: 'label is required' });
    }

    const kitchen = await prisma.kitchen.create({
      data: { label, propertyId: property.id },
    });

    return res.status(201).json({ kitchen });
  } catch (error) {
    console.error('Create kitchen error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/properties/:id/kitchens/:kitchenId
router.put('/:id/kitchens/:kitchenId', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const property = await findOrgProperty(req.params.id, req.user.organizationId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const kitchen = await prisma.kitchen.findFirst({
      where: { id: req.params.kitchenId, propertyId: property.id, deletedAt: null },
    });
    if (!kitchen) {
      return res.status(404).json({ error: 'Kitchen not found' });
    }

    const { label } = req.body;
    const updated = await prisma.kitchen.update({
      where: { id: kitchen.id },
      data: { ...(label !== undefined && { label }) },
    });

    return res.json({ kitchen: updated });
  } catch (error) {
    console.error('Update kitchen error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/properties/:id/kitchens/:kitchenId
router.delete('/:id/kitchens/:kitchenId', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const property = await findOrgProperty(req.params.id, req.user.organizationId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const kitchen = await prisma.kitchen.findFirst({
      where: { id: req.params.kitchenId, propertyId: property.id, deletedAt: null },
    });
    if (!kitchen) {
      return res.status(404).json({ error: 'Kitchen not found' });
    }

    await prisma.kitchen.update({
      where: { id: kitchen.id },
      data: { deletedAt: new Date() },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete kitchen error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Bathrooms CRUD ─────────────────────────────────────

// POST /api/properties/:id/bathrooms
router.post('/:id/bathrooms', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const property = await findOrgProperty(req.params.id, req.user.organizationId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const { label } = req.body;
    if (!label) {
      return res.status(400).json({ error: 'label is required' });
    }

    const bathroom = await prisma.bathroom.create({
      data: { label, propertyId: property.id },
    });

    return res.status(201).json({ bathroom });
  } catch (error) {
    console.error('Create bathroom error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/properties/:id/bathrooms/:bathroomId
router.put('/:id/bathrooms/:bathroomId', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const property = await findOrgProperty(req.params.id, req.user.organizationId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const bathroom = await prisma.bathroom.findFirst({
      where: { id: req.params.bathroomId, propertyId: property.id, deletedAt: null },
    });
    if (!bathroom) {
      return res.status(404).json({ error: 'Bathroom not found' });
    }

    const { label } = req.body;
    const updated = await prisma.bathroom.update({
      where: { id: bathroom.id },
      data: { ...(label !== undefined && { label }) },
    });

    return res.json({ bathroom: updated });
  } catch (error) {
    console.error('Update bathroom error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/properties/:id/bathrooms/:bathroomId
router.delete('/:id/bathrooms/:bathroomId', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const property = await findOrgProperty(req.params.id, req.user.organizationId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const bathroom = await prisma.bathroom.findFirst({
      where: { id: req.params.bathroomId, propertyId: property.id, deletedAt: null },
    });
    if (!bathroom) {
      return res.status(404).json({ error: 'Bathroom not found' });
    }

    await prisma.bathroom.update({
      where: { id: bathroom.id },
      data: { deletedAt: new Date() },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete bathroom error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
