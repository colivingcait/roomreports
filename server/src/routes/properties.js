import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { signPropertyInvite } from '../lib/propertyInvite.js';
import { propertyScope } from '../lib/scope.js';
import { computeHealth } from '../lib/healthGrade.js';
import { notifyMany, summaryList, esc } from '../lib/notifications.js';
import { planLimit, wouldExceed } from '../../../shared/features.js';
import { appOrigin } from '../lib/appUrl.js';
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
    const { name, address, metroArea } = req.body;

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
        metroArea: metroArea || null,
        organizationId: req.user.organizationId,
      },
    });

    // Auto-assign any team members marked "all current and future properties"
    const allOrgUsers = await prisma.user.findMany({
      where: {
        organizationId: req.user.organizationId,
        deletedAt: null,
        assignToAllProperties: true,
      },
      select: { id: true },
    });
    if (allOrgUsers.length > 0) {
      await prisma.propertyAssignment.createMany({
        data: allOrgUsers.map((u) => ({ userId: u.id, propertyId: property.id })),
        skipDuplicates: true,
      });
    }

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

    // Open maintenance items grouped by room. Excludes children of
    // merged tickets so a merged group of 4 reads as 1 in the room
    // counts (matches the dashboard / maintenance board behaviour).
    const maintenance = await prisma.maintenanceItem.findMany({
      where: {
        propertyId: property.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
        status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
        parentTicketId: null,
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

// GET /api/properties/:id/health — Property Health analytics
// Returns maintenance + inspection rollups for the Property Health tab.
// Comparison rows for the portfolio table come from the existing
// /api/financials/dashboard endpoint, which the client also fetches.
router.get('/:id/health', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const property = await prisma.property.findFirst({
      where: { id: req.params.id, organizationId: orgId, deletedAt: null },
      select: { id: true, name: true, metroArea: true, _count: { select: { rooms: { where: { deletedAt: null } } } } },
    });
    if (!property) return res.status(404).json({ error: 'Property not found' });

    const HOUR_MS = 60 * 60 * 1000;
    const DAY_MS = 24 * HOUR_MS;
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
    const twoMonthsAgo = new Date(now.getTime() - 60 * DAY_MS);
    const sixMonthsAgo = new Date(now.getTime() - 180 * DAY_MS);

    // Pull maintenance items (active + soft-resolved). Include events to
    // measure response time (first transition out of OPEN).
    const items = await prisma.maintenanceItem.findMany({
      where: { propertyId: property.id, organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        status: true,
        flagCategory: true,
        actualCost: true,
        roomId: true,
        createdAt: true,
        resolvedAt: true,
        events: {
          where: { type: { in: ['status', 'assigned'] } },
          orderBy: { createdAt: 'asc' },
          select: { type: true, createdAt: true, toValue: true },
        },
        room: { select: { id: true, label: true } },
      },
    });

    // Helper: average response/resolution times within a window. Response
    // = first event after createdAt that moves the ticket out of OPEN.
    function avgResponseHours(scope) {
      const samples = [];
      for (const it of scope) {
        const evt = it.events.find((e) => e.toValue && e.toValue !== 'OPEN');
        if (!evt) continue;
        const ms = new Date(evt.createdAt) - new Date(it.createdAt);
        if (ms > 0) samples.push(ms / HOUR_MS);
      }
      return samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
    }
    function avgResolutionDays(scope) {
      const samples = [];
      for (const it of scope) {
        if (!it.resolvedAt) continue;
        const ms = new Date(it.resolvedAt) - new Date(it.createdAt);
        if (ms > 0) samples.push(ms / DAY_MS);
      }
      return samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
    }

    const thisMonth = items.filter((i) => new Date(i.createdAt) >= monthAgo);
    const lastMonth = items.filter((i) => {
      const d = new Date(i.createdAt);
      return d >= twoMonthsAgo && d < monthAgo;
    });

    const avgResponse = avgResponseHours(thisMonth);
    const avgResponsePrev = avgResponseHours(lastMonth);
    const avgResolution = avgResolutionDays(items.filter((i) => i.resolvedAt && new Date(i.resolvedAt) >= monthAgo));
    const avgResolutionPrev = avgResolutionDays(items.filter((i) => {
      if (!i.resolvedAt) return false;
      const d = new Date(i.resolvedAt);
      return d >= twoMonthsAgo && d < monthAgo;
    }));

    // Maintenance by category (all-time on this property).
    const byCategoryMap = {};
    for (const it of items) {
      const c = it.flagCategory || 'Other';
      byCategoryMap[c] = (byCategoryMap[c] || 0) + 1;
    }
    const byCategory = Object.entries(byCategoryMap)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    // Cost per room per month. Total actualCost / rooms / months_observed.
    const totalCost = items.reduce((a, i) => a + (i.actualCost || 0), 0);
    const earliest = items.reduce((min, i) => {
      const d = new Date(i.createdAt);
      return min == null || d < min ? d : min;
    }, null);
    const monthsObserved = earliest
      ? Math.max(1, Math.round((now - earliest) / (30 * DAY_MS)))
      : 1;
    const roomsCount = property._count.rooms || 1;
    const costPerRoomPerMonth = totalCost / roomsCount / monthsObserved;

    // Metro average — same calc across all properties in the same metro.
    let metroAvgCostPerRoomPerMonth = null;
    if (property.metroArea) {
      const peerProps = await prisma.property.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          metroArea: property.metroArea,
        },
        select: {
          id: true,
          _count: { select: { rooms: { where: { deletedAt: null } } } },
        },
      });
      if (peerProps.length > 0) {
        const peerItems = await prisma.maintenanceItem.findMany({
          where: {
            organizationId: orgId,
            deletedAt: null,
            propertyId: { in: peerProps.map((p) => p.id) },
          },
          select: { propertyId: true, actualCost: true, createdAt: true },
        });
        let peerTotal = 0;
        for (const it of peerItems) peerTotal += (it.actualCost || 0);
        const peerEarliest = peerItems.reduce((min, i) => {
          const d = new Date(i.createdAt);
          return min == null || d < min ? d : min;
        }, null);
        const peerMonths = peerEarliest
          ? Math.max(1, Math.round((now - peerEarliest) / (30 * DAY_MS)))
          : 1;
        const peerRooms = peerProps.reduce((a, p) => a + (p._count.rooms || 0), 0) || 1;
        metroAvgCostPerRoomPerMonth = peerTotal / peerRooms / peerMonths;
      }
    }

    // Recurring patterns: room+category with 2+ tickets.
    const patternMap = {};
    for (const it of items) {
      if (!it.roomId) continue;
      const k = `${it.roomId}|${it.flagCategory || 'Other'}`;
      if (!patternMap[k]) {
        patternMap[k] = {
          roomId: it.roomId,
          roomLabel: it.room?.label || '—',
          category: it.flagCategory || 'Other',
          count: 0,
          totalCost: 0,
          lastOccurrence: null,
        };
      }
      const p = patternMap[k];
      p.count += 1;
      p.totalCost += (it.actualCost || 0);
      const d = new Date(it.createdAt);
      if (!p.lastOccurrence || d > new Date(p.lastOccurrence)) p.lastOccurrence = d;
    }
    const recurringPatterns = Object.values(patternMap)
      .filter((p) => p.count >= 2)
      .sort((a, b) => b.count - a.count);

    // Tickets by status (active items only; resolved counted separately).
    const byStatusMap = { OPEN: 0, ASSIGNED: 0, IN_PROGRESS: 0, RESOLVED: 0, DEFERRED: 0 };
    for (const it of items) {
      const s = it.status || 'OPEN';
      if (byStatusMap[s] !== undefined) byStatusMap[s] += 1;
    }
    const byStatus = byStatusMap;

    // Inspection compliance — last room (QUARTERLY) + last common area.
    const inspections = await prisma.inspection.findMany({
      where: {
        propertyId: property.id,
        organizationId: orgId,
        deletedAt: null,
        status: { in: ['SUBMITTED', 'REVIEWED'] },
        type: { in: ['QUARTERLY', 'COMMON_AREA'] },
        // 12-month window so the year-view compliance calendar can mark
        // every month it has signal for.
        createdAt: { gte: new Date(now.getTime() - 365 * DAY_MS) },
      },
      select: {
        id: true,
        type: true,
        createdAt: true,
        completedAt: true,
        items: {
          select: { status: true, zone: true, options: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const lastRoomInspection = inspections.find((i) => i.type === 'QUARTERLY')?.createdAt || null;
    const lastCommonInspection = inspections.find((i) => i.type === 'COMMON_AREA')?.createdAt || null;

    // Pass rate — across the last 6 months of inspections, count
    // items where status === 'Pass' vs items where status === 'Fail'.
    // Skip metadata zones (start with `_`) and section markers.
    function passRateFor(insps) {
      let pass = 0; let fail = 0;
      for (const insp of insps) {
        for (const it of (insp.items || [])) {
          if (it.zone?.startsWith('_')) continue;
          if (Array.isArray(it.options) && it.options.includes('_section')) continue;
          if (it.status === 'Pass') pass += 1;
          else if (it.status === 'Fail') fail += 1;
        }
      }
      const total = pass + fail;
      return total > 0 ? (pass / total) * 100 : null;
    }
    const passRateAll = passRateFor(inspections);
    const recentSplit = (() => {
      // First half (older) vs second half (newer) of the 6-month window.
      const cutoff = new Date(now.getTime() - 90 * DAY_MS);
      const older = inspections.filter((i) => new Date(i.createdAt) < cutoff);
      const newer = inspections.filter((i) => new Date(i.createdAt) >= cutoff);
      return { older: passRateFor(older), newer: passRateFor(newer) };
    })();

    return res.json({
      property: { id: property.id, name: property.name, metroArea: property.metroArea, roomCount: roomsCount },
      maintenance: {
        avgResponseHours: avgResponse,
        avgResponseHoursPrev: avgResponsePrev,
        avgResolutionDays: avgResolution,
        avgResolutionDaysPrev: avgResolutionPrev,
        byCategory,
        byStatus,
        recurringPatterns,
        costPerRoomPerMonth: Number(costPerRoomPerMonth.toFixed(2)),
        metroAvgCostPerRoomPerMonth: metroAvgCostPerRoomPerMonth != null
          ? Number(metroAvgCostPerRoomPerMonth.toFixed(2))
          : null,
        totalActiveOpen: byStatus.OPEN + byStatus.ASSIGNED + byStatus.IN_PROGRESS,
      },
      inspections: {
        lastRoomInspection,
        lastCommonInspection,
        timeline: inspections.map((i) => ({
          id: i.id,
          type: i.type,
          date: i.createdAt,
        })),
        passRate: passRateAll,
        passRateOlder: recentSplit.older,
        passRateNewer: recentSplit.newer,
      },
    });
  } catch (error) {
    console.error('Property health error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/properties/:id/insights — rule-based actionable insights
// Pulls maintenance items, financial records, occupancy intervals, and
// inspection history, then runs eight rules and returns a sorted list
// of insight cards.
router.get('/:id/insights', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const property = await prisma.property.findFirst({
      where: { id: req.params.id, organizationId: orgId, deletedAt: null },
      include: {
        rooms: { where: { deletedAt: null }, select: { id: true, label: true, features: true } },
      },
    });
    if (!property) return res.status(404).json({ error: 'Property not found' });

    const now = new Date();
    const DAY_MS = 86400000;
    const sixMonthsAgo = new Date(now.getTime() - 180 * DAY_MS);

    const [items, inspections, allCollected, mappings] = await Promise.all([
      prisma.maintenanceItem.findMany({
        where: { propertyId: property.id, organizationId: orgId, deletedAt: null },
        select: {
          id: true,
          status: true,
          flagCategory: true,
          actualCost: true,
          roomId: true,
          createdAt: true,
          resolvedAt: true,
          room: { select: { id: true, label: true } },
        },
      }),
      prisma.inspection.findMany({
        where: {
          propertyId: property.id,
          organizationId: orgId,
          deletedAt: null,
          status: { in: ['SUBMITTED', 'REVIEWED'] },
          type: 'QUARTERLY',
          createdAt: { gte: sixMonthsAgo },
        },
        select: {
          id: true,
          createdAt: true,
          items: { select: { status: true, zone: true, options: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.financialRecord.findMany({
        where: { organizationId: orgId, recordType: 'COLLECTED' },
        select: {
          earningsMonth: true,
          propertyAddress: true,
          roomNumber: true,
          memberId: true,
          memberName: true,
          billType: true,
          grossAmount: true,
          bookingFee: true,
          recordDate: true,
        },
      }),
      prisma.padSplitPropertyMapping.findMany({
        where: { organizationId: orgId, propertyId: property.id },
        select: { padsplitAddress: true },
      }),
    ]);

    // Resolve which PadSplit addresses belong to this property.
    const mappedNorms = new Set(mappings.map((m) => m.padsplitAddress));
    const propertyHistory = allCollected.filter((r) => {
      const norm = (r.propertyAddress || '').toLowerCase().replace(/[.,#]/g, '').replace(/\s+/g, ' ').trim();
      return mappedNorms.has(norm);
    });

    const insights = [];

    // ── Rule 1: recurring maintenance per room+category ──
    const sixMoMaint = items.filter((i) => new Date(i.createdAt) >= sixMonthsAgo);
    const patternMap = {};
    for (const it of sixMoMaint) {
      if (!it.roomId) continue;
      const k = `${it.roomId}|${it.flagCategory || 'Other'}`;
      if (!patternMap[k]) {
        patternMap[k] = { roomLabel: it.room?.label || '—', category: it.flagCategory || 'Other', count: 0, totalCost: 0 };
      }
      patternMap[k].count += 1;
      patternMap[k].totalCost += (it.actualCost || 0);
    }
    for (const p of Object.values(patternMap)) {
      if (p.count < 3) continue;
      const avgCost = p.totalCost / p.count;
      const fixCost = Math.round(avgCost * 2);
      const annualPace = Math.round((p.totalCost / 6) * 12);
      insights.push({
        kind: 'warning',
        priority: 1,
        roi: annualPace,
        headline: `${p.roomLabel} has a recurring ${p.category.toLowerCase()} problem`,
        detail: `${p.count} ${p.category.toLowerCase()} tickets in the last 6 months, costing $${Math.round(p.totalCost).toLocaleString()}.`,
        action: 'Consider a permanent fix instead of repeated repairs.',
        cost: fixCost > 0 ? `~$${fixCost.toLocaleString()} estimated for a permanent fix` : 'Cost varies',
        impact: `Current pace: ~$${annualPace.toLocaleString()} per year in repeat repairs`,
        link: '/maintenance',
        linkLabel: 'View tickets',
      });
    }

    // Build occupancy intervals + per-room turnover counts for rules 2/8.
    const grouped = {};
    const firstMonthByRoom = {};
    for (const r of propertyHistory) {
      const roomKey = (r.roomNumber || '').toString().trim();
      const memberId = (r.memberId || '').toString().trim();
      if (!roomKey || !memberId) continue;
      if (!firstMonthByRoom[roomKey] || r.earningsMonth < firstMonthByRoom[roomKey]) {
        firstMonthByRoom[roomKey] = r.earningsMonth;
      }
      if (!grouped[roomKey]) grouped[roomKey] = {};
      if (!grouped[roomKey][memberId]) grouped[roomKey][memberId] = { net: 0, name: r.memberName, firstDate: null, lastDate: null, bookingFeeSum: 0 };
      const slot = grouped[roomKey][memberId];
      slot.net += (r.grossAmount || 0);
      slot.bookingFeeSum += (r.bookingFee || 0);
      if (r.recordDate && (r.grossAmount || 0) > 0) {
        const d = new Date(r.recordDate);
        if (!isNaN(d)) {
          if (!slot.firstDate || d < slot.firstDate) slot.firstDate = d;
          if (!slot.lastDate || d > slot.lastDate) slot.lastDate = d;
        }
      }
    }
    const intervalsByRoom = {};
    const dataMonths = [...new Set(propertyHistory.map((r) => r.earningsMonth))].sort();
    const latestMonth = dataMonths[dataMonths.length - 1];
    for (const roomKey of Object.keys(grouped)) {
      const intervals = [];
      for (const memberId of Object.keys(grouped[roomKey])) {
        const m = grouped[roomKey][memberId];
        if (Math.round(m.net * 100) / 100 <= 1) continue;
        intervals.push({ memberId, memberName: m.name, firstDate: m.firstDate, lastDate: m.lastDate, bookingFeeSum: m.bookingFeeSum });
      }
      intervals.sort((a, b) => (a.firstDate || 0) - (b.firstDate || 0));
      intervalsByRoom[roomKey] = intervals;
    }

    // ── Rule 2: high-turnover room ──
    for (const roomKey of Object.keys(intervalsByRoom)) {
      const intervals = intervalsByRoom[roomKey];
      let turnovers = 0;
      for (let i = 1; i < intervals.length; i++) {
        if (intervals[i].memberId !== intervals[i - 1].memberId) turnovers += 1;
      }
      const fm = firstMonthByRoom[roomKey];
      let monthsOfData = 1;
      if (fm && latestMonth) {
        const [fy, fmn] = fm.split('-').map(Number);
        const [ly, lmn] = latestMonth.split('-').map(Number);
        monthsOfData = Math.max(1, (ly - fy) * 12 + (lmn - fmn) + 1);
      }
      const annualized = (turnovers / monthsOfData) * 12;
      if (annualized > 4) {
        const avgTenure = monthsOfData / Math.max(1, turnovers + 1);
        const perTurnCost = 600; // rough placeholder — vacancy + booking + cleaning
        const annualCost = Math.round(annualized * perTurnCost);
        insights.push({
          kind: 'warning',
          priority: 2,
          roi: annualCost,
          headline: `Room ${roomKey} has high turnover`,
          detail: `${turnovers} turnovers, avg tenure ${avgTenure.toFixed(1)} months, costing ~$${annualCost.toLocaleString()}/year.`,
          action: "Investigate what's driving move-outs — check room condition, pricing, and resident screening.",
          cost: 'No direct cost — requires investigation',
          impact: `Each avoided turnover saves ~$${perTurnCost.toLocaleString()}`,
          link: '/financials',
          linkLabel: 'View financials',
        });
      }
    }

    // ── Rule 3: slow maintenance resolution ──
    const resolved = items.filter((i) => i.resolvedAt);
    if (resolved.length > 0) {
      const avgDays = resolved.reduce(
        (a, i) => a + (new Date(i.resolvedAt) - new Date(i.createdAt)) / DAY_MS,
        0,
      ) / resolved.length;
      if (avgDays > 7) {
        insights.push({
          kind: 'warning',
          priority: 3,
          roi: 0,
          headline: 'Maintenance is taking too long to resolve',
          detail: `Average ${avgDays.toFixed(1)} days to resolve tickets at this property.`,
          action: 'Assign tickets within 24 hours and follow up on aging tickets weekly.',
          cost: 'No cost — process improvement',
          impact: 'Faster resolution correlates with higher resident satisfaction and lower turnover',
          link: '/maintenance',
          linkLabel: 'View maintenance',
        });
      }
    }

    // ── Rule 4: inspection overdue ──
    const lastQuarterly = inspections[0];
    const daysSinceInsp = lastQuarterly
      ? Math.floor((now - new Date(lastQuarterly.createdAt)) / DAY_MS)
      : null;
    if (daysSinceInsp == null || daysSinceInsp > 30) {
      insights.push({
        kind: 'warning',
        priority: 4,
        roi: 0,
        headline: 'Room inspection overdue',
        detail: lastQuarterly
          ? `Last inspected ${daysSinceInsp} days ago.`
          : 'No room inspection in the last 6 months.',
        action: 'Schedule a room inspection this week to catch issues early.',
        cost: '30-60 minutes of inspector time',
        impact: 'Regular inspections prevent small issues from becoming expensive repairs',
        link: '/inspections',
        linkLabel: 'Schedule inspection',
      });
    }

    // ── Rule 5: declining pass rate ──
    function passRate(insp) {
      let pass = 0; let fail = 0;
      for (const it of (insp?.items || [])) {
        if (it.zone?.startsWith('_')) continue;
        if (Array.isArray(it.options) && it.options.includes('_section')) continue;
        if (it.status === 'Pass') pass += 1;
        else if (it.status === 'Fail') fail += 1;
      }
      const total = pass + fail;
      return total > 0 ? (pass / total) * 100 : null;
    }
    if (inspections.length >= 2) {
      const newer = passRate(inspections[0]);
      const older = passRate(inspections[1]);
      if (newer != null && older != null && older - newer > 5) {
        insights.push({
          kind: 'warning',
          priority: 5,
          roi: 0,
          headline: 'Property condition is declining',
          detail: `Pass rate dropped from ${older.toFixed(0)}% to ${newer.toFixed(0)}% between the last two inspections.`,
          action: 'Review recent failed items and address root causes.',
          cost: 'Varies by issue',
          impact: 'Preventing condition decline protects property value and resident retention',
          link: '/inspections',
          linkLabel: 'View inspections',
        });
      }
    }

    // ── Rule 6: underperforming room ──
    // Net P&L per room = host earnings (latest month) minus maintenance.
    // We approximate using collected as proxy (host = collected - 8% service - booking).
    const latestRoomTotals = {}; // roomKey → gross
    for (const r of propertyHistory) {
      if (r.earningsMonth !== latestMonth) continue;
      const roomKey = (r.roomNumber || '').toString().trim();
      if (!roomKey) continue;
      latestRoomTotals[roomKey] = (latestRoomTotals[roomKey] || 0) + (r.grossAmount || 0);
    }
    const roomKeys = Object.keys(latestRoomTotals);
    if (roomKeys.length >= 3) {
      const avg = roomKeys.reduce((a, k) => a + latestRoomTotals[k], 0) / roomKeys.length;
      let lowKey = null; let lowVal = Infinity;
      for (const k of roomKeys) {
        if (latestRoomTotals[k] > 0 && latestRoomTotals[k] < lowVal) {
          lowVal = latestRoomTotals[k];
          lowKey = k;
        }
      }
      if (lowKey && avg > 0 && (avg - lowVal) / avg > 0.2) {
        const gap = Math.round(avg - lowVal);
        insights.push({
          kind: 'opportunity',
          priority: 6,
          roi: gap * 12,
          headline: `Room ${lowKey} is your lowest earner`,
          detail: `Earning $${Math.round(lowVal).toLocaleString()}/month vs property avg of $${Math.round(avg).toLocaleString()}/month.`,
          action: 'Consider: raise rent (if below market), add features (ensuite/AC), or investigate why turnover is high.',
          cost: 'Feature additions: $500-$2,000. Rent increase: $0',
          impact: `Closing the gap to average would add ~$${(gap * 12).toLocaleString()}/year`,
          link: '/financials',
          linkLabel: 'View financials',
        });
      }
    }

    // ── Rule 7: ensuite premium ──
    const ensuiteIds = new Set(
      property.rooms
        .filter((r) => Array.isArray(r.features) && r.features.some((f) => /ensuite|private bath/i.test(String(f))))
        .map((r) => {
          const m = String(r.label || '').match(/(\d+)/);
          return m ? m[1] : null;
        })
        .filter(Boolean),
    );
    const sharedIds = new Set(
      property.rooms
        .filter((r) => !(Array.isArray(r.features) && r.features.some((f) => /ensuite|private bath/i.test(String(f)))))
        .map((r) => {
          const m = String(r.label || '').match(/(\d+)/);
          return m ? m[1] : null;
        })
        .filter(Boolean),
    );
    if (ensuiteIds.size > 0 && sharedIds.size > 0) {
      let ensuiteSum = 0; let ensuiteCount = 0;
      let sharedSum = 0; let sharedCount = 0;
      for (const k of Object.keys(latestRoomTotals)) {
        const v = latestRoomTotals[k];
        if (v <= 0) continue;
        if (ensuiteIds.has(k)) { ensuiteSum += v; ensuiteCount += 1; }
        else if (sharedIds.has(k)) { sharedSum += v; sharedCount += 1; }
      }
      if (ensuiteCount > 0 && sharedCount > 0) {
        const ensAvg = ensuiteSum / ensuiteCount;
        const shAvg = sharedSum / sharedCount;
        if (ensAvg > shAvg) {
          const pct = ((ensAvg - shAvg) / shAvg) * 100;
          const monthlyDelta = ensAvg - shAvg;
          const yearly = Math.round(monthlyDelta * 12);
          const minPayback = Math.ceil(5000 / Math.max(monthlyDelta, 1));
          insights.push({
            kind: 'opportunity',
            priority: 7,
            roi: yearly,
            headline: `Private bath rooms earn ${pct.toFixed(0)}% more`,
            detail: `Avg ensuite: $${Math.round(ensAvg).toLocaleString()}/month vs shared: $${Math.round(shAvg).toLocaleString()}/month.`,
            action: 'If feasible, consider converting a shared bath room to ensuite on the next renovation.',
            cost: 'Bathroom addition: $5,000-$15,000 estimated',
            impact: `Additional ~$${yearly.toLocaleString()}/year per converted room. Payback ~${minPayback} months at low end.`,
            link: '/financials',
            linkLabel: 'View financials',
          });
        }
      }
    }

    // ── Rule 8: self-referral opportunity ──
    // Members with $0 lifetime booking fee = host-referred. Members with
    // any booking fee = PadSplit-sourced.
    let psSourced = 0; let total = 0; let psFeeTotal = 0;
    let dailyRateSum = 0; let dailyRateCount = 0;
    const seenMembers = new Set();
    for (const roomKey of Object.keys(grouped)) {
      for (const memberId of Object.keys(grouped[roomKey])) {
        if (seenMembers.has(memberId)) continue;
        seenMembers.add(memberId);
        const m = grouped[roomKey][memberId];
        if (Math.round(m.net * 100) / 100 <= 1) continue;
        total += 1;
        if ((m.bookingFeeSum || 0) > 0) {
          psSourced += 1;
          psFeeTotal += m.bookingFeeSum;
        }
      }
    }
    // Average daily rate across rooms (proxy for booking fee size).
    for (const k of Object.keys(latestRoomTotals)) {
      const v = latestRoomTotals[k];
      if (v <= 0) continue;
      dailyRateSum += v / 30;
      dailyRateCount += 1;
    }
    const avgDaily = dailyRateCount > 0 ? dailyRateSum / dailyRateCount : 0;
    if (total > 0 && (psSourced / total) > 0.5) {
      const perTurnSavings = Math.round(avgDaily * 10);
      insights.push({
        kind: 'opportunity',
        priority: 8,
        roi: perTurnSavings * 4,
        headline: "You're paying PadSplit to find most of your members",
        detail: `${psSourced} of ${total} members were PadSplit-sourced, costing ~$${Math.round(psFeeTotal).toLocaleString()} in booking fees.`,
        action: 'Market rooms directly — Facebook groups, Craigslist, local postings — to avoid the 10-day booking fee.',
        cost: 'Time investment: 1-2 hours per listing',
        impact: `Each self-referred member saves ~$${perTurnSavings.toLocaleString()} (10 days × daily rate)`,
        link: '/financials',
        linkLabel: 'View financials',
      });
    }

    insights.sort((a, b) => (b.roi || 0) - (a.roi || 0));

    return res.json({
      property: { id: property.id, name: property.name },
      insights,
    });
  } catch (error) {
    console.error('Property insights error:', error);
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

    const { name, address, metroArea, commonAreas } = req.body;
    const data = {
      ...(name !== undefined && { name }),
      ...(address !== undefined && { address }),
      ...(metroArea !== undefined && { metroArea: metroArea || null }),
    };
    if (commonAreas !== undefined) {
      // Trim, drop empties, dedupe — keep input forgiving.
      const cleaned = (Array.isArray(commonAreas) ? commonAreas : [])
        .map((s) => String(s || '').trim())
        .filter(Boolean);
      data.commonAreas = Array.from(new Set(cleaned));
    }
    const updated = await prisma.property.update({
      where: { id: property.id },
      data,
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

async function loadTurnoverContext(propertyId, roomId, organizationId) {
  const property = await findOrgProperty(propertyId, organizationId);
  if (!property) return { error: 'Property not found', status: 404 };
  const room = await prisma.room.findFirst({
    where: { id: roomId, propertyId: property.id, deletedAt: null },
  });
  if (!room) return { error: 'Room not found', status: 404 };

  const [deferredItems, activeViolations, cleaners] = await Promise.all([
    prisma.maintenanceItem.findMany({
      where: {
        roomId: room.id,
        organizationId,
        deletedAt: null,
        status: 'DEFERRED',
        deferType: 'ROOM_TURN',
      },
      orderBy: { deferredAt: 'asc' },
    }),
    prisma.leaseViolation.findMany({
      where: {
        roomId: room.id,
        organizationId,
        deletedAt: null,
        archivedAt: null,
        resolvedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.propertyAssignment.findMany({
      where: { propertyId: property.id, user: { role: 'CLEANER', deletedAt: null } },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  return { property, room, deferredItems, activeViolations, cleaners };
}

// GET /api/properties/:id/rooms/:roomId/turnover-plan
// Preview of what Turn Room will do. Lets the PM see the full picture
// before the confirmation button actually fires.
router.get('/:id/rooms/:roomId/turnover-plan', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const ctx = await loadTurnoverContext(req.params.id, req.params.roomId, req.user.organizationId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    return res.json({
      property: { id: ctx.property.id, name: ctx.property.name },
      room: { id: ctx.room.id, label: ctx.room.label },
      deferredItems: ctx.deferredItems.map((d) => ({
        id: d.id, description: d.description, flagCategory: d.flagCategory, deferReason: d.deferReason,
      })),
      activeViolations: ctx.activeViolations.map((v) => ({
        id: v.id, description: v.description, category: v.category,
      })),
      cleaners: ctx.cleaners.map((a) => ({
        id: a.user.id, name: a.user.name,
      })),
    });
  } catch (error) {
    console.error('turnover plan error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/properties/:id/rooms/:roomId/turnover
// Executes the turn: reactivate deferred (room-turn) items, archive
// active violations, create a Room Turn maintenance ticket, notify the
// assigned cleaner. Stamps the room's lastTurnoverAt so history pages
// know when the divider belongs.
router.post('/:id/rooms/:roomId/turnover', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const ctx = await loadTurnoverContext(req.params.id, req.params.roomId, req.user.organizationId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const { property, room, deferredItems, activeViolations, cleaners } = ctx;

    const turnoverAt = new Date();
    const primaryCleaner = cleaners[0]?.user || null;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Reactivate room-turn-deferred maintenance tickets.
      const reactivateNote = `Reactivated from deferred — room turn ${turnoverAt.toISOString().slice(0, 10)}`;
      if (deferredItems.length > 0) {
        await tx.maintenanceItem.updateMany({
          where: { id: { in: deferredItems.map((d) => d.id) } },
          data: {
            status: 'OPEN',
            reactivatedAt: turnoverAt,
            reactivatedReason: reactivateNote,
          },
        });
        // Event log rows so the timeline shows this on each ticket.
        await tx.maintenanceEvent.createMany({
          data: deferredItems.map((d) => ({
            maintenanceItemId: d.id,
            type: 'reactivated',
            fromValue: 'DEFERRED',
            toValue: 'OPEN',
            note: reactivateNote,
            byUserId: req.user.id,
            byUserName: req.user.name,
          })),
        });
      }

      // 2. Archive active lease violations.
      const archivedViolations = await tx.leaseViolation.updateMany({
        where: {
          roomId: room.id,
          organizationId: req.user.organizationId,
          archivedAt: null,
          deletedAt: null,
        },
        data: { archivedAt: turnoverAt, archivedReason: 'Room turnover' },
      });

      // 3. Create the Room Turn ticket, assigned High to the primary cleaner.
      const roomTurnTicket = await tx.maintenanceItem.create({
        data: {
          organizationId: req.user.organizationId,
          propertyId: property.id,
          roomId: room.id,
          description: `Room Turn — ${room.label}`,
          zone: 'Room Turn',
          flagCategory: 'Cleaning',
          priority: 'High',
          status: primaryCleaner ? 'ASSIGNED' : 'OPEN',
          assignedUserId: primaryCleaner?.id || null,
          assignedTo: primaryCleaner?.name || null,
          note: `Room turn initiated on ${turnoverAt.toISOString().slice(0, 10)}. Complete room turn inspection when cleaning is done.`,
          reportedById: req.user.id,
          reportedByName: req.user.name,
          reportedByRole: req.user.role,
        },
      });
      await tx.maintenanceEvent.create({
        data: {
          maintenanceItemId: roomTurnTicket.id,
          type: 'created',
          toValue: roomTurnTicket.status,
          note: 'Created by Turn Room',
          byUserId: req.user.id,
          byUserName: req.user.name,
        },
      });

      // 4. Stamp room turnover timestamp.
      const updatedRoom = await tx.room.update({
        where: { id: room.id },
        data: { lastTurnoverAt: turnoverAt },
      });

      return {
        violationsArchived: archivedViolations.count,
        reactivatedCount: deferredItems.length,
        room: updatedRoom,
        roomTurnTicketId: roomTurnTicket.id,
      };
    });

    // ── Notifications (best-effort, don't block response) ─────────
    try {
      const origin = appOrigin();
      const pmIds = (await prisma.user.findMany({
        where: { organizationId: req.user.organizationId, role: { in: ['OWNER', 'PM'] }, deletedAt: null },
        select: { id: true },
      })).map((u) => u.id);

      // Reactivated count to PMs
      if (result.reactivatedCount > 0 && pmIds.length > 0) {
        await notifyMany({
          userIds: pmIds,
          organizationId: req.user.organizationId,
          type: 'MAINTENANCE_STATUS_CHANGED',
          title: `${result.reactivatedCount} deferred item${result.reactivatedCount === 1 ? '' : 's'} reactivated — ${room.label}`,
          message: `${room.label} at ${property.name} was turned. Deferred maintenance is back on the board.`,
          link: '/maintenance',
          email: {
            subject: `Deferred maintenance reactivated — ${room.label}`,
            ctaLabel: 'Open maintenance board',
            ctaHref: `${origin}/maintenance`,
            bodyHtml: `
              <p style="margin:0 0 12px;">${result.reactivatedCount} deferred maintenance item${result.reactivatedCount === 1 ? '' : 's'} reactivated for <strong>${esc(room.label)}</strong> at ${esc(property.name)}.</p>
              <ul style="margin:0 0 12px;padding-left:20px;">${deferredItems.map((d) => `<li>${esc(d.description)}</li>`).join('')}</ul>
            `,
          },
        });
      }

      // Cleaner ping (ROOM_TURN_NEEDED reused — fits the semantics)
      if (cleaners.length > 0) {
        await notifyMany({
          userIds: cleaners.map((c) => c.user.id),
          organizationId: req.user.organizationId,
          type: 'ROOM_TURN_NEEDED',
          title: `Room turn — ${property.name} / ${room.label}`,
          message: `${property.name} ${room.label} is ready for a room turn.`,
          link: `/maintenance?open=${result.roomTurnTicketId}`,
          email: {
            subject: `Room turn — ${property.name} / ${room.label}`,
            ctaLabel: 'Open ticket',
            ctaHref: `${origin}/maintenance?open=${result.roomTurnTicketId}`,
            bodyHtml: `
              <p style="margin:0 0 12px;">${esc(property.name)} — <strong>${esc(room.label)}</strong> is ready for a room turn.</p>
              ${summaryList([
                ['Property', property.name],
                ['Room', room.label],
                ['Ticket', 'Room Turn'],
                ['Priority', 'High'],
              ])}
            `,
          },
        });
      }
    } catch (e) {
      console.error('turnover notification error:', e);
    }

    return res.json({
      room: result.room,
      violationsArchived: result.violationsArchived,
      reactivatedCount: result.reactivatedCount,
      roomTurnTicketId: result.roomTurnTicketId,
    });
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
