import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';

import prisma from '../lib/prisma.js';
import { uploadFile } from '../lib/storage.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { propertyIdScope } from '../lib/scope.js';
import { notify, notifyMany, pmAndOwnerIds, esc, emailShell, summaryList } from '../lib/notifications.js';
import { appOrigin } from '../lib/appUrl.js';

const router = Router();
router.use(requireAuth);

// ─── Constants ──────────────────────────────────────────

export const VIOLATION_TYPES = [
  'MESSY', 'BAD_ODOR', 'SMOKING', 'UNAUTHORIZED_GUESTS', 'PETS',
  'OPEN_FOOD', 'PESTS', 'OPEN_FLAMES', 'KITCHEN_APPLIANCES',
  'LITHIUM_BATTERIES', 'MODIFICATIONS', 'DRUG_PARAPHERNALIA',
  'WEAPONS', 'NOISE', 'OTHER',
];

export const VIOLATION_TYPE_LABELS = {
  MESSY: 'Messy',
  BAD_ODOR: 'Bad odor',
  SMOKING: 'Smoking',
  UNAUTHORIZED_GUESTS: 'Unauthorized guests',
  PETS: 'Pets',
  OPEN_FOOD: 'Open food',
  PESTS: 'Pests/bugs',
  OPEN_FLAMES: 'Open flames/candles',
  KITCHEN_APPLIANCES: 'Kitchen appliances in room',
  LITHIUM_BATTERIES: 'Lithium batteries',
  MODIFICATIONS: 'Modifications (paint, holes, etc.)',
  DRUG_PARAPHERNALIA: 'Drug paraphernalia',
  WEAPONS: 'Weapons',
  NOISE: 'Noise',
  OTHER: 'Other',
};

const ESCALATION_ORDER = ['FLAGGED', 'FIRST_WARNING', 'SECOND_WARNING', 'FINAL_NOTICE'];
const ESCALATION_LABELS = {
  FLAGGED: 'Flagged',
  FIRST_WARNING: '1st Warning',
  SECOND_WARNING: '2nd Warning',
  FINAL_NOTICE: 'Final Notice',
};
const RESOLVED_TYPE_LABELS = {
  RESOLVED_BY_RESIDENT: 'Resolved by resident',
  WARNING_ISSUED: 'Warning issued',
  FINE_ASSESSED: 'Fine assessed',
  LEASE_TERMINATION: 'Lease termination',
  DISMISSED: 'Dismissed / false flag',
};
const TIMELINE_METHOD_LABELS = {
  VERBAL: 'Verbal',
  TEXT: 'Text message',
  EMAIL: 'Email',
  POSTED_NOTICE: 'Posted notice',
  PADSPLIT_MESSAGE: 'PadSplit message',
  OTHER: 'Other',
};

// ─── Photo upload ────────────────────────────────────────

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

async function compressAndUpload(orgId, violationId, buffer) {
  const resized = await sharp(buffer)
    .resize({ width: 1920, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  const timestamp = Date.now();
  const key = `${orgId}/violations/${violationId}/${timestamp}.jpg`;
  const { url } = await uploadFile(key, resized, 'image/jpeg');
  return { url, key };
}

// ─── Helpers ─────────────────────────────────────────────

async function hydrateViolations(violations, orgId) {
  if (violations.length === 0) return [];
  const propIds = [...new Set(violations.map((v) => v.propertyId).filter(Boolean))];
  const roomIds = [...new Set(violations.map((v) => v.roomId).filter(Boolean))];
  const [props, rooms] = await Promise.all([
    propIds.length ? prisma.property.findMany({
      where: { id: { in: propIds }, organizationId: orgId },
      select: { id: true, name: true, address: true },
    }) : [],
    roomIds.length ? prisma.room.findMany({
      where: { id: { in: roomIds } },
      select: { id: true, label: true, propertyId: true },
    }) : [],
  ]);
  const propMap = Object.fromEntries(props.map((p) => [p.id, p]));
  const roomMap = Object.fromEntries(rooms.map((r) => [r.id, r]));
  return violations.map((v) => ({
    ...v,
    property: v.propertyId ? propMap[v.propertyId] || null : null,
    room: v.roomId ? roomMap[v.roomId] || null : null,
    typeLabel: v.violationType ? VIOLATION_TYPE_LABELS[v.violationType] || v.violationType : (v.category || 'Violation'),
  }));
}

function nextEscalation(current) {
  const idx = ESCALATION_ORDER.indexOf(current || 'FLAGGED');
  if (idx < 0 || idx >= ESCALATION_ORDER.length - 1) return ESCALATION_ORDER[ESCALATION_ORDER.length - 1];
  return ESCALATION_ORDER[idx + 1];
}

async function findRepeatViolations(orgId, residentName, violationType, excludeId) {
  if (!residentName || !violationType) return [];
  return prisma.leaseViolation.findMany({
    where: {
      organizationId: orgId,
      residentName: { equals: residentName, mode: 'insensitive' },
      violationType,
      id: { not: excludeId },
      deletedAt: null,
    },
    select: { id: true, createdAt: true, resolvedAt: true, escalationLevel: true },
    orderBy: { createdAt: 'desc' },
  });
}

// ─── Notifications ───────────────────────────────────────

async function notifyEscalation(violation, escalationLevel, property, room) {
  if (!['SECOND_WARNING', 'FINAL_NOTICE'].includes(escalationLevel)) return;
  try {
    const ids = await pmAndOwnerIds(violation.organizationId);
    if (!ids.length) return;
    const typeLabel = violation.violationType ? VIOLATION_TYPE_LABELS[violation.violationType] : (violation.category || 'Lease violation');
    const location = [property?.name, room?.label].filter(Boolean).join(' · ');
    const escalLabel = ESCALATION_LABELS[escalationLevel];
    const link = `/violations/${violation.id}`;
    await notifyMany({
      userIds: ids,
      organizationId: violation.organizationId,
      type: 'VIOLATION_ESCALATED',
      title: `Violation escalated to ${escalLabel} — ${location}`,
      message: `${typeLabel}${violation.residentName ? ` (${violation.residentName})` : ''} at ${location} reached ${escalLabel}.`,
      link,
      email: {
        subject: `Violation ${escalLabel} — ${location}`,
        ctaLabel: 'View violation',
        ctaHref: `${appOrigin()}${link}`,
        bodyHtml: `
          <p style="margin:0 0 12px;">A lease violation has escalated to <strong>${esc(escalLabel)}</strong>.</p>
          ${summaryList([
            ['Resident', violation.residentName || '—'],
            ['Location', location],
            ['Violation', typeLabel],
            ['Level', escalLabel],
          ])}
        `,
      },
    });
  } catch (e) {
    console.error('Violation escalation notification error:', e);
  }
}

// ─── GET /api/violations ─────────────────────────────────

router.get('/', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { propertyId, roomId, status, violationType, escalationLevel, includeArchived } = req.query;
    const scope = await propertyIdScope(req.user);
    const where = {
      organizationId: req.user.organizationId,
      deletedAt: null,
      ...scope,
    };
    if (propertyId) where.propertyId = propertyId;
    if (roomId) where.roomId = roomId;
    if (violationType) where.violationType = violationType;
    if (escalationLevel) where.escalationLevel = escalationLevel;
    if (status === 'ACTIVE') where.resolvedAt = null;
    if (status === 'RESOLVED') where.resolvedAt = { not: null };
    if (includeArchived !== 'true') where.archivedAt = null;

    const violations = await prisma.leaseViolation.findMany({
      where,
      include: {
        timelineEntries: { orderBy: { date: 'desc' }, take: 1 },
        photos: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [
        // Sort active violations by escalation level desc, then date desc
        { createdAt: 'desc' },
      ],
    });

    // Sort by escalation level desc (FINAL_NOTICE first)
    const sorted = violations.sort((a, b) => {
      if (a.resolvedAt && !b.resolvedAt) return 1;
      if (!a.resolvedAt && b.resolvedAt) return -1;
      const ai = ESCALATION_ORDER.indexOf(a.escalationLevel || 'FLAGGED');
      const bi = ESCALATION_ORDER.indexOf(b.escalationLevel || 'FLAGGED');
      if (bi !== ai) return bi - ai;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    const hydrated = await hydrateViolations(sorted, req.user.organizationId);

    // Attach repeat flags: same resident + same type previously flagged
    const withRepeat = await Promise.all(hydrated.map(async (v) => {
      const repeats = await findRepeatViolations(req.user.organizationId, v.residentName, v.violationType, v.id);
      return { ...v, isRepeat: repeats.length > 0, repeatCount: repeats.length };
    }));

    return res.json({ violations: withRepeat });
  } catch (error) {
    console.error('List violations error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/violations ────────────────────────────────

router.post('/', requireRole('OWNER', 'PM'), photoUpload.array('photos', 5), async (req, res) => {
  try {
    const { propertyId, roomId, residentName, violationType, otherDescription, notes, category } = req.body || {};
    if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
    if (!violationType && !category) return res.status(400).json({ error: 'violationType is required' });

    const property = await prisma.property.findFirst({
      where: { id: propertyId, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!property) return res.status(404).json({ error: 'Property not found' });

    let room = null;
    if (roomId) {
      room = await prisma.room.findFirst({ where: { id: roomId, propertyId, deletedAt: null } });
      if (!room) return res.status(404).json({ error: 'Room not found' });
    }

    const resolvedType = violationType || 'OTHER';
    const typeLabel = VIOLATION_TYPE_LABELS[resolvedType] || resolvedType;

    const violation = await prisma.leaseViolation.create({
      data: {
        organizationId: req.user.organizationId,
        propertyId,
        roomId: room?.id || null,
        residentName: residentName?.trim() || null,
        violationType: resolvedType,
        otherDescription: resolvedType === 'OTHER' ? (otherDescription?.trim() || null) : null,
        category: category || typeLabel,
        description: typeLabel,
        note: notes?.trim() || null,
        escalationLevel: 'FLAGGED',
        reportedById: req.user.id,
        reportedByName: req.user.name,
      },
    });

    const timelineEntry = await prisma.violationTimelineEntry.create({
      data: {

        violationId: violation.id,
        actionType: 'FLAGGED',
        date: new Date(),
        notes: notes?.trim() || null,
        loggedById: req.user.id,
        loggedByName: req.user.name,
      },
    });

    // Upload photos
    if (req.files?.length) {
      await Promise.all(req.files.map(async (file) => {
        const { url, key } = await compressAndUpload(req.user.organizationId, violation.id, file.buffer);
        await prisma.violationPhoto.create({
          data: { violationId: violation.id, timelineEntryId: timelineEntry.id, url, key },
        });
      }));
    }

    return res.status(201).json({ violation });
  } catch (error) {
    console.error('Create violation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/violations/:id ─────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const v = await prisma.leaseViolation.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
      include: {
        timelineEntries: {
          orderBy: { date: 'desc' },
          include: { photos: true },
        },
        photos: { orderBy: { createdAt: 'asc' } },
        actions: { orderBy: { actionAt: 'desc' } },
      },
    });
    if (!v) return res.status(404).json({ error: 'Violation not found' });
    const [hydrated] = await hydrateViolations([v], req.user.organizationId);

    // Source inspection
    let sourceInspection = null;
    if (v.inspectionId) {
      sourceInspection = await prisma.inspection.findFirst({
        where: { id: v.inspectionId, organizationId: req.user.organizationId },
        select: { id: true, type: true, createdAt: true, completedAt: true, inspectorName: true },
      });
    }
    let sourceItem = null;
    if (v.inspectionItemId) {
      sourceItem = await prisma.inspectionItem.findFirst({
        where: { id: v.inspectionItemId },
        select: { id: true, text: true, note: true, flagCategory: true, photos: { select: { id: true, url: true } } },
      });
    }
    const followUp = await prisma.maintenanceItem.findFirst({
      where: { leaseViolationId: v.id, organizationId: req.user.organizationId, deletedAt: null },
      select: { id: true, description: true, status: true, dueAt: true },
    });

    // Repeat violation check
    const repeats = await findRepeatViolations(req.user.organizationId, v.residentName, v.violationType, v.id);
    const previousResolved = repeats.filter((r) => r.resolvedAt);
    const previousActive = repeats.filter((r) => !r.resolvedAt);

    // Other active violations for this resident
    let residentViolations = [];
    if (v.residentName) {
      residentViolations = await prisma.leaseViolation.findMany({
        where: {
          organizationId: req.user.organizationId,
          residentName: { equals: v.residentName, mode: 'insensitive' },
          id: { not: v.id },
          deletedAt: null,
        },
        select: { id: true, violationType: true, escalationLevel: true, resolvedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
    }

    return res.json({
      violation: {
        ...hydrated,
        typeLabel: v.violationType ? VIOLATION_TYPE_LABELS[v.violationType] : (v.category || 'Violation'),
        escalationLabel: ESCALATION_LABELS[v.escalationLevel] || v.escalationLevel,
        suggestedNextEscalation: nextEscalation(v.escalationLevel),
        sourceInspection,
        sourceItem,
        followUp,
        isRepeat: repeats.length > 0,
        repeatCount: repeats.length,
        previousResolved,
        previousActive,
        residentViolations: residentViolations.map((rv) => ({
          ...rv,
          typeLabel: VIOLATION_TYPE_LABELS[rv.violationType] || rv.violationType,
        })),
      },
    });
  } catch (error) {
    console.error('Get violation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/violations/:id/timeline ───────────────────
// Log a warning or a plain note. actionType = FIRST_WARNING | SECOND_WARNING | FINAL_NOTICE | NOTE

router.post('/:id/timeline', requireRole('OWNER', 'PM'), photoUpload.array('photos', 5), async (req, res) => {
  try {
    const v = await prisma.leaseViolation.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
      include: { timelineEntries: { orderBy: { date: 'asc' } } },
    });
    if (!v) return res.status(404).json({ error: 'Violation not found' });
    if (v.resolvedAt) return res.status(400).json({ error: 'Violation is already resolved' });

    const { actionType, method, notes, date } = req.body || {};
    const validActionTypes = ['FIRST_WARNING', 'SECOND_WARNING', 'FINAL_NOTICE', 'NOTE'];
    if (!actionType || !validActionTypes.includes(actionType)) {
      return res.status(400).json({ error: `actionType must be one of ${validActionTypes.join(', ')}` });
    }
    if (!notes?.trim()) return res.status(400).json({ error: 'notes is required' });

    const entryDate = date ? new Date(date) : new Date();
    if (isNaN(entryDate.getTime())) return res.status(400).json({ error: 'date is invalid' });

    const entry = await prisma.violationTimelineEntry.create({
      data: {

        violationId: v.id,
        actionType,
        date: entryDate,
        method: method || null,
        notes: notes.trim(),
        loggedById: req.user.id,
        loggedByName: req.user.name,
      },
    });

    // Upload photos
    if (req.files?.length) {
      await Promise.all(req.files.map(async (file) => {
        const { url, key } = await compressAndUpload(req.user.organizationId, v.id, file.buffer);
        await prisma.violationPhoto.create({
          data: { violationId: v.id, timelineEntryId: entry.id, url, key },
        });
      }));
    }

    // Update escalation level if this is a warning (not a NOTE)
    let updatedViolation = v;
    if (actionType !== 'NOTE') {
      const warningOrder = ESCALATION_ORDER.indexOf(actionType);
      const currentOrder = ESCALATION_ORDER.indexOf(v.escalationLevel || 'FLAGGED');
      if (warningOrder > currentOrder) {
        updatedViolation = await prisma.leaseViolation.update({
          where: { id: v.id },
          data: { escalationLevel: actionType },
        });

        // Fetch property/room for notification
        const [property, room] = await Promise.all([
          prisma.property.findFirst({ where: { id: v.propertyId }, select: { name: true } }),
          v.roomId ? prisma.room.findFirst({ where: { id: v.roomId }, select: { label: true } }) : Promise.resolve(null),
        ]);
        await notifyEscalation(updatedViolation, actionType, property, room);
      }
    }

    const entryWithPhotos = await prisma.violationTimelineEntry.findUnique({
      where: { id: entry.id },
      include: { photos: true },
    });

    return res.status(201).json({ entry: entryWithPhotos, violation: updatedViolation });
  } catch (error) {
    console.error('Timeline entry error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/violations/:id/resolve ───────────────────

router.post('/:id/resolve', requireRole('OWNER', 'PM'), photoUpload.array('photos', 5), async (req, res) => {
  try {
    const v = await prisma.leaseViolation.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!v) return res.status(404).json({ error: 'Violation not found' });

    const { resolvedType, resolvedNote, date } = req.body || {};
    const validTypes = ['RESOLVED_BY_RESIDENT', 'WARNING_ISSUED', 'FINE_ASSESSED', 'LEASE_TERMINATION', 'DISMISSED'];
    if (!resolvedType || !validTypes.includes(resolvedType)) {
      return res.status(400).json({ error: `resolvedType must be one of ${validTypes.join(', ')}` });
    }

    const resolvedAt = date ? new Date(date) : new Date();
    if (isNaN(resolvedAt.getTime())) return res.status(400).json({ error: 'date is invalid' });

    const entry = await prisma.violationTimelineEntry.create({
      data: {

        violationId: v.id,
        actionType: 'RESOLVED',
        date: resolvedAt,
        notes: resolvedNote?.trim() || `Resolved: ${RESOLVED_TYPE_LABELS[resolvedType]}`,
        loggedById: req.user.id,
        loggedByName: req.user.name,
      },
    });

    if (req.files?.length) {
      await Promise.all(req.files.map(async (file) => {
        const { url, key } = await compressAndUpload(req.user.organizationId, v.id, file.buffer);
        await prisma.violationPhoto.create({
          data: { violationId: v.id, timelineEntryId: entry.id, url, key },
        });
      }));
    }

    const updated = await prisma.leaseViolation.update({
      where: { id: v.id },
      data: {
        resolvedAt,
        resolvedType,
        resolvedNote: resolvedNote?.trim() || null,
        resolvedById: req.user.id,
      },
    });

    return res.json({ violation: updated });
  } catch (error) {
    console.error('Resolve violation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/violations/:id/unresolve ─────────────────

router.post('/:id/unresolve', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const v = await prisma.leaseViolation.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!v) return res.status(404).json({ error: 'Violation not found' });
    const updated = await prisma.leaseViolation.update({
      where: { id: v.id },
      data: { resolvedAt: null, resolvedType: null, resolvedNote: null, resolvedById: null },
    });
    return res.json({ violation: updated });
  } catch (error) {
    console.error('Unresolve violation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/violations/:id ─────────────────────────────
// Legacy update endpoint — kept for backward compat.

router.put('/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const v = await prisma.leaseViolation.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!v) return res.status(404).json({ error: 'Violation not found' });
    const { note, resolved } = req.body || {};
    const data = {};
    if (note !== undefined) data.note = note || null;
    if (resolved === true && !v.resolvedAt) data.resolvedAt = new Date();
    if (resolved === false) { data.resolvedAt = null; data.resolvedType = null; }
    const updated = await prisma.leaseViolation.update({ where: { id: v.id }, data });
    return res.json({ violation: updated });
  } catch (error) {
    console.error('Update violation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/violations/:id/follow-up ─────────────────

router.post('/:id/follow-up', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const v = await prisma.leaseViolation.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!v) return res.status(404).json({ error: 'Violation not found' });
    const { title, priority, note, dueAt, flagCategory } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
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
        description: String(title).trim(),
        zone: 'Lease follow-up',
        flagCategory: flagCategory || v.category || 'Lease Compliance',
        priority: priority || 'Medium',
        status: 'OPEN',
        note: note || null,
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

// ─── POST /api/violations/:id/actions (legacy) ──────────

router.post('/:id/actions', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const v = await prisma.leaseViolation.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!v) return res.status(404).json({ error: 'Violation not found' });
    const { method, description, actionAt } = req.body || {};
    if (!description?.trim()) return res.status(400).json({ error: 'description is required' });
    const action = await prisma.leaseViolationAction.create({
      data: {
        leaseViolationId: v.id,
        organizationId: req.user.organizationId,
        method: method || 'other',
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

// ─── GET /api/violations/:id/pdf ─────────────────────────

router.get('/:id/pdf', async (req, res) => {
  try {
    const v = await prisma.leaseViolation.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
      include: {
        timelineEntries: { orderBy: { date: 'asc' }, include: { photos: true } },
        photos: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!v) return res.status(404).json({ error: 'Violation not found' });
    const [hydrated] = await hydrateViolations([v], req.user.organizationId);
    const property = hydrated.property;
    const room = hydrated.room;
    const typeLabel = v.violationType ? (VIOLATION_TYPE_LABELS[v.violationType] || v.violationType) : (v.category || 'Violation');

    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const filename = `violation-${v.id.slice(0, 8)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    const BRAND = '#6B8F71';
    const DARK = '#4A4543';
    const MUTED = '#8A8583';

    // Header
    doc.fontSize(18).fillColor(BRAND).text('RoomReport', 50, 50);
    doc.fontSize(14).fillColor(DARK).text('Lease Violation Record', 50, 75);
    doc.moveTo(50, 100).lineTo(560, 100).strokeColor('#E8E4E1').stroke();

    // Violation summary
    let y = 115;
    doc.fontSize(12).fillColor(DARK);
    const pairs = [
      ['Violation Type', typeLabel + (v.otherDescription ? ` — ${v.otherDescription}` : '')],
      ['Location', [property?.name, room?.label].filter(Boolean).join(' · ') || '—'],
      ['Resident', v.residentName || '—'],
      ['Escalation Level', ESCALATION_LABELS[v.escalationLevel] || v.escalationLevel || 'Flagged'],
      ['Date Flagged', new Date(v.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })],
      ['Status', v.resolvedAt ? `Resolved — ${RESOLVED_TYPE_LABELS[v.resolvedType] || v.resolvedType}` : 'Active'],
    ];
    for (const [label, value] of pairs) {
      doc.fontSize(9).fillColor(MUTED).text(label.toUpperCase(), 50, y);
      doc.fontSize(11).fillColor(DARK).text(String(value), 160, y);
      y += 18;
    }
    y += 10;

    // Timeline
    doc.moveTo(50, y).lineTo(560, y).strokeColor('#E8E4E1').stroke();
    y += 12;
    doc.fontSize(13).fillColor(BRAND).text('Timeline', 50, y);
    y += 20;

    const actionColors = {
      FLAGGED: '#8A8583',
      FIRST_WARNING: '#B45309',
      SECOND_WARNING: '#C2410C',
      FINAL_NOTICE: '#991B1B',
      RESOLVED: '#6B8F71',
      NOTE: '#4A4543',
    };
    const actionLabels = {
      FLAGGED: 'Flagged',
      FIRST_WARNING: '1st Warning',
      SECOND_WARNING: '2nd Warning',
      FINAL_NOTICE: 'Final Notice',
      RESOLVED: 'Resolved',
      NOTE: 'Note',
    };

    for (const entry of v.timelineEntries) {
      if (y > 700) { doc.addPage(); y = 50; }
      const color = actionColors[entry.actionType] || DARK;
      const label = actionLabels[entry.actionType] || entry.actionType;
      const dateStr = new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      doc.fontSize(10).fillColor(color).text(`[${label}]`, 50, y, { continued: true });
      doc.fontSize(10).fillColor(MUTED).text(`  ${dateStr}${entry.method ? `  ·  ${TIMELINE_METHOD_LABELS[entry.method] || entry.method}` : ''}  ·  ${entry.loggedByName}`, { continued: false });
      y += 14;
      if (entry.notes) {
        doc.fontSize(10).fillColor(DARK).text(entry.notes, 65, y, { width: 480 });
        y += doc.heightOfString(entry.notes, { width: 480 }) + 6;
      }
      if (entry.photos?.length) {
        doc.fontSize(9).fillColor(MUTED).text(`${entry.photos.length} photo${entry.photos.length === 1 ? '' : 's'} attached`, 65, y);
        y += 14;
      }
      y += 6;
    }

    doc.end();
  } catch (error) {
    console.error('Violation PDF error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
