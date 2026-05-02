import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import prisma from '../lib/prisma.js';
import { uploadFile } from '../lib/storage.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { propertyIdScope } from '../lib/scope.js';
import { PRIORITIES, ATTACHMENT_LABELS } from '../../../shared/index.js';
import {
  notify,
  notifyMany,
  pmAndOwnerIds,
  summaryList,
  esc,
  residentEmailShell,
} from '../lib/notifications.js';
import { sendEmail } from '../lib/email.js';

const router = Router();
router.use(requireAuth);

// Legacy category mapping (unchanged from prior behavior)
const LEGACY_CATEGORY_MAP = {
  'Maintenance': 'General',
  'Pest': 'Pest Control',
  'Lease Violation': 'General',
  'Cleanliness': 'Cleaning',
  'Other': 'General',
};
const normalizeCategory = (c) => LEGACY_CATEGORY_MAP[c] || c;

function matchingCategories(newCategory) {
  const legacy = Object.entries(LEGACY_CATEGORY_MAP)
    .filter(([, newCat]) => newCat === newCategory)
    .map(([oldCat]) => oldCat);
  return [newCategory, ...legacy];
}

// ─── File upload (photos + attachments) ─────────────────

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const ATTACHMENT_MIME = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
];
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ATTACHMENT_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

// ─── Helpers ────────────────────────────────────────────

async function logEvent(itemId, user, type, fromValue, toValue, note) {
  return prisma.maintenanceEvent.create({
    data: {
      maintenanceItemId: itemId,
      type,
      fromValue: fromValue != null ? String(fromValue) : null,
      toValue: toValue != null ? String(toValue) : null,
      note: note || null,
      byUserId: user?.id || null,
      byUserName: user?.name || null,
    },
  });
}

const MAINTENANCE_INCLUDE = {
  property: { select: { id: true, name: true, address: true } },
  room: { select: { id: true, label: true } },
  inspection: { select: { id: true, type: true } },
  // The user-facing modal needs the photos that were taken during the
  // source inspection. Tickets don't get their own copy of those
  // images — they live on the InspectionItem.
  inspectionItem: {
    select: {
      id: true,
      text: true,
      note: true,
      photos: { select: { id: true, url: true } },
    },
  },
  photos: true,
  attachments: { orderBy: { createdAt: 'desc' } },
  assignedUser: { select: { id: true, name: true, role: true, customRole: true } },
  assignedVendor: { select: { id: true, name: true, company: true } },
};

const DETAIL_INCLUDE = {
  ...MAINTENANCE_INCLUDE,
  events: { orderBy: { createdAt: 'asc' } },
};

function shapeItem(item) {
  return { ...item, flagCategory: normalizeCategory(item.flagCategory) };
}

// ─── GET /api/maintenance — list with filters + archive policy ──
// Resolved items older than 7d are hidden from the default board but remain
// accessible when ?includeArchived=true or when a specific status filter is set.

router.get('/', async (req, res) => {
  try {
    const {
      propertyId, status, flagCategory, priority, assignedTo,
      assignedUserId, assignedVendorId,
      startDate, endDate, includeArchived, includeDeferred,
      deferredOnly, search,
    } = req.query;

    const scope = await propertyIdScope(req.user);
    const where = {
      organizationId: req.user.organizationId,
      deletedAt: null,
      ...scope,
    };

    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;
    if (flagCategory) where.flagCategory = { in: matchingCategories(flagCategory) };
    if (priority) where.priority = priority;
    if (assignedTo) where.assignedTo = assignedTo;
    if (assignedUserId) where.assignedUserId = assignedUserId;
    if (assignedVendorId) where.assignedVendorId = assignedVendorId;
    if (search) where.description = { contains: search, mode: 'insensitive' };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    // Archive policy: explicit archivedAt flag is authoritative.
    // Items with archivedAt set are hidden from the board unless
    // includeArchived=true. Reports still query without this filter.
    if (!includeArchived) {
      where.archivedAt = null;
    }

    // Deferred tickets live off the active kanban board. Callers that
    // need them pass `includeDeferred=true` (the "Show deferred" toggle
    // on the maintenance page) or `deferredOnly=true` (the Deferred
    // section + property overview). `status=DEFERRED` as a filter also
    // forces deferred results regardless of the toggle.
    if (deferredOnly === 'true') {
      where.status = 'DEFERRED';
    } else if (status !== 'DEFERRED' && includeDeferred !== 'true' && !status) {
      where.status = { not: 'DEFERRED' };
    }

    // Children of merged tickets are hidden from the board — only the
    // parent surfaces. Callers that explicitly want to pick from any
    // open ticket (e.g. the "Merge with..." picker) pass
    // includeChildren=true.
    if (req.query.includeChildren !== 'true') {
      where.parentTicketId = null;
    }

    const items = await prisma.maintenanceItem.findMany({
      where,
      include: {
        ...MAINTENANCE_INCLUDE,
        _count: { select: { children: true } },
        // Lightweight children info so kanban cards can render
        // "Rooms 5, 8" on parents that span multiple rooms.
        children: {
          where: { deletedAt: null },
          select: { id: true, room: { select: { id: true, label: true } } },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    // Status counts reflect the same archive policy so the pills match the board
    const countWhere = {
      organizationId: req.user.organizationId,
      deletedAt: null,
      ...(propertyId ? { propertyId } : {}),
    };
    if (!includeArchived) {
      countWhere.archivedAt = null;
    }
    const counts = await prisma.maintenanceItem.groupBy({
      by: ['status'],
      where: countWhere,
      _count: true,
    });
    const statusCounts = { OPEN: 0, ASSIGNED: 0, IN_PROGRESS: 0, RESOLVED: 0 };
    for (const c of counts) statusCounts[c.status] = c._count;

    return res.json({ items: items.map(shapeItem), statusCounts });
  } catch (error) {
    console.error('List maintenance error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/maintenance/:id — full detail ─────────────

router.get('/:id', async (req, res) => {
  try {
    const item = await prisma.maintenanceItem.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
      include: {
        ...DETAIL_INCLUDE,
        children: {
          where: { deletedAt: null },
          include: {
            room: { select: { id: true, label: true } },
            photos: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        parent: { select: { id: true, description: true } },
      },
    });
    if (!item) return res.status(404).json({ error: 'Maintenance item not found' });

    // Previous issues in this room (same category first, then all)
    const prevRoomItems = item.roomId
      ? await prisma.maintenanceItem.findMany({
          where: {
            organizationId: req.user.organizationId,
            roomId: item.roomId,
            id: { not: item.id },
            deletedAt: null,
          },
          orderBy: [{ createdAt: 'desc' }],
          take: 20,
          select: {
            id: true, description: true, flagCategory: true, status: true,
            priority: true, createdAt: true, resolvedAt: true,
          },
        })
      : [];
    const sortedRoom = [
      ...prevRoomItems.filter((i) => i.flagCategory === item.flagCategory),
      ...prevRoomItems.filter((i) => i.flagCategory !== item.flagCategory),
    ];

    // Related issues in this property (same category)
    const relatedProperty = await prisma.maintenanceItem.findMany({
      where: {
        organizationId: req.user.organizationId,
        propertyId: item.propertyId,
        flagCategory: { in: matchingCategories(item.flagCategory) },
        id: { not: item.id },
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, description: true, status: true, priority: true,
        createdAt: true, resolvedAt: true, roomId: true,
        room: { select: { id: true, label: true } },
      },
    });

    // Surface children + parent at the top level of the response so the
    // client can read `data.children` and `data.parent` directly. Keep
    // the included copies on `item` too (for backwards compat / future
    // callers that expect them nested).
    return res.json({
      item: shapeItem(item),
      children: item.children || [],
      parent: item.parent || null,
      previousInRoom: sortedRoom,
      relatedInProperty: relatedProperty,
    });
  } catch (error) {
    console.error('Get maintenance error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/maintenance — create manually (not from an inspection) ──
// Body: { propertyId, roomId?, description, flagCategory?, priority?, note?, zone? }

router.post('/', async (req, res) => {
  try {
    const {
      propertyId, roomId,
      description, flagCategory, priority, note, zone,
    } = req.body || {};

    if (!propertyId || !description?.trim()) {
      return res.status(400).json({ error: 'propertyId and description are required' });
    }
    if (priority && !PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
    }

    // Any authenticated team member can file an issue report, but
    // cleaners / handypeople / other scoped roles must be assigned to
    // the property they're reporting on. Owner and PM bypass.
    if (!['OWNER', 'PM'].includes(req.user.role)) {
      const assignment = await prisma.propertyAssignment.findFirst({
        where: { userId: req.user.id, propertyId },
      });
      if (!assignment) {
        return res.status(403).json({ error: 'Not assigned to this property' });
      }
    }

    const property = await prisma.property.findFirst({
      where: {
        id: propertyId,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });
    if (!property) return res.status(404).json({ error: 'Property not found' });

    // Verify room (if given) belongs to this property
    if (roomId) {
      const room = await prisma.room.findFirst({
        where: { id: roomId, propertyId, deletedAt: null },
      });
      if (!room) return res.status(400).json({ error: 'Room not found in this property' });
    }

    const created = await prisma.maintenanceItem.create({
      data: {
        organizationId: req.user.organizationId,
        propertyId,
        roomId: roomId || null,
        description: description.trim(),
        zone: zone || 'Reported Issue',
        flagCategory: flagCategory || 'General',
        priority: priority || null,
        note: note?.trim() || null,
        reportedById: req.user.id,
        reportedByName: req.user.name,
        reportedByRole: req.user.role,
        // inspectionItemId / inspectionId stay null — this is a manual ticket
      },
      include: MAINTENANCE_INCLUDE,
    });

    await logEvent(created.id, req.user, 'created', null, 'OPEN', 'Manually created');

    return res.status(201).json({ item: shapeItem(created) });
  } catch (error) {
    console.error('Create maintenance error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/maintenance/:id — update ──────────────────

router.put('/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const existing = await prisma.maintenanceItem.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });
    if (!existing) return res.status(404).json({ error: 'Maintenance item not found' });

    const {
      status, assignedTo, assignedUserId, assignedVendorId,
      note, priority,
      estimatedCost, actualCost, vendor,
      entryApproved, entryCode,
      description,
    } = req.body;

    const data = {};
    if (status !== undefined) data.status = status;
    if (assignedTo !== undefined) data.assignedTo = assignedTo;
    if (note !== undefined) data.note = note;
    if (description !== undefined) data.description = description;

    // Structured assignment: verify ownership then resolve display name
    if (assignedUserId !== undefined) {
      if (assignedUserId) {
        const u = await prisma.user.findFirst({
          where: { id: assignedUserId, organizationId: req.user.organizationId },
          select: { id: true, name: true },
        });
        if (!u) return res.status(400).json({ error: 'assignedUserId not found in this org' });
        data.assignedUserId = u.id;
        data.assignedVendorId = null;
        data.assignedTo = u.name;
      } else {
        data.assignedUserId = null;
      }
    }
    if (assignedVendorId !== undefined) {
      if (assignedVendorId) {
        const v = await prisma.vendor.findFirst({
          where: { id: assignedVendorId, organizationId: req.user.organizationId },
          select: { id: true, name: true, company: true },
        });
        if (!v) return res.status(400).json({ error: 'assignedVendorId not found in this org' });
        data.assignedVendorId = v.id;
        data.assignedUserId = null;
        data.assignedTo = v.company ? `${v.name} (${v.company})` : v.name;
      } else {
        data.assignedVendorId = null;
      }
    }
    // If assignedTo was set directly (custom text) without vendor/user ids, clear the FKs
    if (assignedTo !== undefined && assignedUserId === undefined && assignedVendorId === undefined) {
      data.assignedUserId = null;
      data.assignedVendorId = null;
    }
    if (priority !== undefined) {
      if (priority !== null && !PRIORITIES.includes(priority)) {
        return res.status(400).json({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
      }
      data.priority = priority;
    }
    if (estimatedCost !== undefined) data.estimatedCost = estimatedCost === null ? null : Number(estimatedCost);
    if (actualCost !== undefined) data.actualCost = actualCost === null ? null : Number(actualCost);
    if (vendor !== undefined) data.vendor = vendor;
    if (entryCode !== undefined) data.entryCode = entryCode;
    if (entryApproved !== undefined) {
      data.entryApproved = !!entryApproved;
      data.entryApprovedAt = entryApproved ? new Date() : null;
    }

    // Auto-set resolvedAt on status transitions
    if (status === 'RESOLVED' && existing.status !== 'RESOLVED') data.resolvedAt = new Date();
    if (status && status !== 'RESOLVED' && existing.status === 'RESOLVED') data.resolvedAt = null;

    const updated = await prisma.maintenanceItem.update({
      where: { id: existing.id },
      data,
      include: MAINTENANCE_INCLUDE,
    });

    // Propagate parent-level changes to all children. Status, priority,
    // and assignment apply to every merged item; cost stays per-child
    // (handled by /children/:id/cost) so vendor invoices can be split.
    const childPropagation = {};
    if (status !== undefined) childPropagation.status = status;
    if (status === 'RESOLVED' && existing.status !== 'RESOLVED') childPropagation.resolvedAt = new Date();
    if (status && status !== 'RESOLVED' && existing.status === 'RESOLVED') childPropagation.resolvedAt = null;
    if (priority !== undefined) childPropagation.priority = priority;
    if (assignedUserId !== undefined) childPropagation.assignedUserId = data.assignedUserId;
    if (assignedVendorId !== undefined) childPropagation.assignedVendorId = data.assignedVendorId;
    if (assignedTo !== undefined) childPropagation.assignedTo = data.assignedTo ?? assignedTo;
    if (vendor !== undefined) childPropagation.vendor = vendor;
    if (Object.keys(childPropagation).length > 0) {
      await prisma.maintenanceItem.updateMany({
        where: { parentTicketId: existing.id, deletedAt: null },
        data: childPropagation,
      });
    }

    // Event log
    const events = [];
    if (status !== undefined && status !== existing.status) {
      events.push(logEvent(existing.id, req.user, 'status', existing.status, status));
    }
    if (
      (assignedTo !== undefined && assignedTo !== existing.assignedTo) ||
      (assignedUserId !== undefined && assignedUserId !== existing.assignedUserId) ||
      (assignedVendorId !== undefined && assignedVendorId !== existing.assignedVendorId)
    ) {
      events.push(logEvent(existing.id, req.user, 'assigned', existing.assignedTo, data.assignedTo ?? assignedTo));
    }
    if (priority !== undefined && priority !== existing.priority) {
      events.push(logEvent(existing.id, req.user, 'priority', existing.priority, priority));
    }
    if (note !== undefined && note !== existing.note) {
      events.push(logEvent(existing.id, req.user, 'note', null, null, note));
    }
    if (estimatedCost !== undefined && Number(estimatedCost) !== existing.estimatedCost) {
      events.push(logEvent(existing.id, req.user, 'cost', existing.estimatedCost, estimatedCost, 'estimated'));
    }
    if (actualCost !== undefined && Number(actualCost) !== existing.actualCost) {
      events.push(logEvent(existing.id, req.user, 'cost', existing.actualCost, actualCost, 'actual'));
    }
    if (vendor !== undefined && vendor !== existing.vendor) {
      events.push(logEvent(existing.id, req.user, 'vendor', existing.vendor, vendor));
    }
    await Promise.all(events);

    try {
      await runPMUpdateNotifications({ existing, updated, body: req.body, actor: req.user });
    } catch (e) {
      console.error('pm update notification error:', e);
    }

    try {
      await sendResidentStatusEmail({ existing, updated });
    } catch (e) {
      console.error('resident status email error:', e);
    }

    return res.json({ item: shapeItem(updated) });
  } catch (error) {
    console.error('Update maintenance error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/maintenance/:id/archive — archive / unarchive ─

// ─── POST /api/maintenance/merge ────────────────────────
// Body: { ticketIds: [...], title, flagCategory, priority, assignedUserId,
//         assignedTo, assignedVendorId }
// Creates a new parent ticket and links all selected tickets as children.
// All selected tickets must belong to the same property and the same org.

router.post('/merge', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { ticketIds, title, flagCategory, priority, assignedUserId, assignedTo, assignedVendorId, vendor } = req.body;
    if (!Array.isArray(ticketIds) || ticketIds.length < 2) {
      return res.status(400).json({ error: 'Select at least two tickets to merge' });
    }
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const tickets = await prisma.maintenanceItem.findMany({
      where: {
        id: { in: ticketIds },
        organizationId: req.user.organizationId,
        deletedAt: null,
        archivedAt: null,
      },
    });
    if (tickets.length !== ticketIds.length) {
      return res.status(400).json({ error: 'Some tickets are missing or unavailable' });
    }
    const propertyIds = [...new Set(tickets.map((t) => t.propertyId))];
    if (propertyIds.length > 1) {
      return res.status(400).json({ error: 'All tickets to merge must belong to the same property' });
    }
    if (tickets.some((t) => t.parentTicketId)) {
      return res.status(400).json({ error: 'One or more tickets are already merged into another parent' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const parent = await tx.maintenanceItem.create({
        data: {
          organizationId: req.user.organizationId,
          propertyId: propertyIds[0],
          description: String(title).trim(),
          zone: 'Merged',
          flagCategory: flagCategory || tickets[0].flagCategory || 'General',
          priority: priority || tickets[0].priority || null,
          status: 'OPEN',
          assignedUserId: assignedUserId || null,
          assignedTo: assignedTo || null,
          assignedVendorId: assignedVendorId || null,
          vendor: vendor || null,
          reportedById: req.user.id,
          reportedByName: req.user.name,
          reportedByRole: req.user.role,
        },
      });
      await tx.maintenanceItem.updateMany({
        where: { id: { in: ticketIds } },
        data: {
          parentTicketId: parent.id,
          mergedAt: new Date(),
          // Inherit parent status so kanban moves are consistent.
          status: 'OPEN',
        },
      });
      await tx.maintenanceEvent.create({
        data: {
          maintenanceItemId: parent.id,
          type: 'merged',
          note: `Merged ${ticketIds.length} tickets`,
          byUserId: req.user.id,
          byUserName: req.user.name,
        },
      });
      for (const t of tickets) {
        await tx.maintenanceEvent.create({
          data: {
            maintenanceItemId: t.id,
            type: 'merged',
            note: `Merged into "${parent.description}"`,
            byUserId: req.user.id,
            byUserName: req.user.name,
          },
        });
      }
      return parent;
    });

    const full = await prisma.maintenanceItem.findUnique({
      where: { id: result.id },
      include: { ...DETAIL_INCLUDE, children: { where: { deletedAt: null }, include: { room: true, photos: true } } },
    });
    return res.json({ item: shapeItem(full) });
  } catch (err) {
    console.error('Merge tickets error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/maintenance/:id/add-children ──────────────
// Body: { ticketIds: [...] } — attach more tickets to an existing parent.

router.post('/:id/add-children', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const parent = await prisma.maintenanceItem.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!parent) return res.status(404).json({ error: 'Parent ticket not found' });
    if (parent.parentTicketId) {
      return res.status(400).json({ error: 'Cannot add children to a child ticket' });
    }
    const { ticketIds } = req.body;
    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      return res.status(400).json({ error: 'ticketIds required' });
    }
    const tickets = await prisma.maintenanceItem.findMany({
      where: {
        id: { in: ticketIds },
        organizationId: req.user.organizationId,
        deletedAt: null,
        archivedAt: null,
        propertyId: parent.propertyId,
        parentTicketId: null,
      },
    });
    if (tickets.length !== ticketIds.length) {
      return res.status(400).json({ error: 'Some tickets are unavailable or in a different property' });
    }
    await prisma.maintenanceItem.updateMany({
      where: { id: { in: ticketIds } },
      data: { parentTicketId: parent.id, mergedAt: new Date(), status: parent.status },
    });
    for (const t of tickets) {
      await prisma.maintenanceEvent.create({
        data: {
          maintenanceItemId: t.id,
          type: 'merged',
          note: `Merged into "${parent.description}"`,
          byUserId: req.user.id,
          byUserName: req.user.name,
        },
      });
    }
    return res.json({ ok: true, added: tickets.length });
  } catch (err) {
    console.error('Add children error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/maintenance/:id/unmerge ───────────────────
// Splits a parent ticket back into its children. The parent record is
// soft-deleted; children regain their independence with original data.

router.post('/:id/unmerge', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const parent = await prisma.maintenanceItem.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
      include: { children: { where: { deletedAt: null } } },
    });
    if (!parent) return res.status(404).json({ error: 'Ticket not found' });
    if (parent.parentTicketId) {
      return res.status(400).json({ error: 'This is a child ticket; unmerge from its parent' });
    }
    if (parent.children.length === 0) {
      return res.status(400).json({ error: 'No children to unmerge' });
    }
    await prisma.$transaction(async (tx) => {
      await tx.maintenanceItem.updateMany({
        where: { parentTicketId: parent.id },
        data: { parentTicketId: null, mergedAt: null },
      });
      // Only soft-delete the parent if it was a SYNTHETIC merge
      // container (created by POST /merge, identified by zone =
      // 'Merged'). Real tickets that were promoted to a parent via the
      // older buggy "Merge with..." flow must be preserved — deleting
      // them would lose the user's original ticket data.
      if (parent.zone === 'Merged') {
        await tx.maintenanceItem.update({
          where: { id: parent.id },
          data: { deletedAt: new Date() },
        });
      }
      for (const child of parent.children) {
        await tx.maintenanceEvent.create({
          data: {
            maintenanceItemId: child.id,
            type: 'unmerged',
            note: `Unmerged from "${parent.description}"`,
            byUserId: req.user.id,
            byUserName: req.user.name,
          },
        });
      }
    });
    return res.json({ ok: true, count: parent.children.length });
  } catch (err) {
    console.error('Unmerge tickets error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/maintenance/children/:childId/cost ─────────
// Update an individual child's estimatedCost / actualCost (so vendor
// invoices can be split across the merged items). The parent's cost
// auto-rolls up to the sum across children.

router.put('/children/:childId/cost', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const child = await prisma.maintenanceItem.findFirst({
      where: {
        id: req.params.childId,
        organizationId: req.user.organizationId,
        deletedAt: null,
        parentTicketId: { not: null },
      },
    });
    if (!child) return res.status(404).json({ error: 'Child ticket not found' });
    const data = {};
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'estimatedCost')) {
      const v = req.body.estimatedCost;
      data.estimatedCost = v === '' || v == null ? null : Number(v);
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'actualCost')) {
      const v = req.body.actualCost;
      data.actualCost = v === '' || v == null ? null : Number(v);
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'estimatedCost or actualCost required' });
    }
    const updated = await prisma.maintenanceItem.update({
      where: { id: child.id },
      data,
    });
    // Roll up parent costs as the sum across children.
    const sumRow = await prisma.maintenanceItem.aggregate({
      where: { parentTicketId: child.parentTicketId, deletedAt: null },
      _sum: { actualCost: true, estimatedCost: true },
    });
    await prisma.maintenanceItem.update({
      where: { id: child.parentTicketId },
      data: {
        actualCost: sumRow._sum.actualCost || 0,
        estimatedCost: sumRow._sum.estimatedCost || 0,
      },
    });
    return res.json({
      child: updated,
      parentActualTotal: sumRow._sum.actualCost || 0,
      parentEstimatedTotal: sumRow._sum.estimatedCost || 0,
    });
  } catch (err) {
    console.error('Update child cost error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/maintenance/deleted ────────────────────────
// Lists soft-deleted maintenance tickets so users can recover ones
// that were unintentionally removed (e.g. the buggy "Merge with..."
// flow that briefly soft-deleted real tickets during unmerge).

router.get('/deleted', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const items = await prisma.maintenanceItem.findMany({
      where: {
        organizationId: req.user.organizationId,
        deletedAt: { not: null },
      },
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
      },
      orderBy: { deletedAt: 'desc' },
      take: 100,
    });
    return res.json({ items });
  } catch (err) {
    console.error('List deleted error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/maintenance/:id/restore ───────────────────
// Un-soft-delete a ticket. Clears any leftover parent linkage so the
// restored ticket lands back on the kanban as a regular item.

router.post('/:id/restore', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const item = await prisma.maintenanceItem.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: { not: null },
      },
    });
    if (!item) return res.status(404).json({ error: 'Deleted ticket not found' });
    const updated = await prisma.maintenanceItem.update({
      where: { id: item.id },
      data: {
        deletedAt: null,
        // Drop the merged linkage too — restored tickets should be
        // independent on the kanban.
        parentTicketId: null,
        mergedAt: null,
      },
    });
    await prisma.maintenanceEvent.create({
      data: {
        maintenanceItemId: item.id,
        type: 'restored',
        note: 'Restored from deleted',
        byUserId: req.user.id,
        byUserName: req.user.name,
      },
    });
    return res.json({ item: updated });
  } catch (err) {
    console.error('Restore ticket error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/archive', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const item = await prisma.maintenanceItem.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!item) return res.status(404).json({ error: 'Maintenance item not found' });
    const updated = await prisma.maintenanceItem.update({
      where: { id: item.id },
      data: { archivedAt: new Date() },
    });
    return res.json({ item: updated });
  } catch (error) {
    console.error('Archive maintenance error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/unarchive', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const item = await prisma.maintenanceItem.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!item) return res.status(404).json({ error: 'Maintenance item not found' });
    const updated = await prisma.maintenanceItem.update({
      where: { id: item.id },
      data: { archivedAt: null },
    });
    return res.json({ item: updated });
  } catch (error) {
    console.error('Unarchive maintenance error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/maintenance/:id — soft delete ──────────

router.delete('/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const item = await prisma.maintenanceItem.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });
    if (!item) return res.status(404).json({ error: 'Maintenance item not found' });

    await prisma.maintenanceItem.update({
      where: { id: item.id },
      data: { deletedAt: new Date() },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete maintenance error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/maintenance/:id/reopen ────────────────────

router.put('/:id/reopen', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const item = await prisma.maintenanceItem.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });
    if (!item) return res.status(404).json({ error: 'Maintenance item not found' });

    const updated = await prisma.maintenanceItem.update({
      where: { id: item.id },
      data: { status: 'OPEN', resolvedAt: null },
      include: MAINTENANCE_INCLUDE,
    });
    await logEvent(item.id, req.user, 'reopened', 'RESOLVED', 'OPEN');

    return res.json({ item: shapeItem(updated) });
  } catch (error) {
    console.error('Reopen maintenance error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /api/maintenance/:id/progress ────────────────
// Handyperson-friendly status update: they can move a ticket to
// IN_PROGRESS / RESOLVED and add notes, without getting the full PUT
// surface (which covers assignments, costs, priority, etc.).

router.patch('/:id/progress', async (req, res) => {
  try {
    const existing = await prisma.maintenanceItem.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });
    if (!existing) return res.status(404).json({ error: 'Maintenance item not found' });

    // OWNER / PM go through PUT; scoped roles need property assignment.
    if (!['OWNER', 'PM'].includes(req.user.role)) {
      const assignment = await prisma.propertyAssignment.findFirst({
        where: { userId: req.user.id, propertyId: existing.propertyId },
      });
      if (!assignment) {
        return res.status(403).json({ error: 'Not assigned to this property' });
      }
    }

    const { status, note } = req.body || {};
    const allowed = ['IN_PROGRESS', 'RESOLVED'];
    const data = {};
    if (status !== undefined) {
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });
      }
      data.status = status;
      if (status === 'RESOLVED') data.resolvedAt = new Date();
    }
    if (note !== undefined) data.note = String(note).trim() || null;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const updated = await prisma.maintenanceItem.update({
      where: { id: existing.id },
      data,
      include: MAINTENANCE_INCLUDE,
    });

    if (data.status && data.status !== existing.status) {
      await logEvent(existing.id, req.user, 'status', existing.status, data.status);
    }
    if (data.note !== undefined && data.note !== existing.note) {
      await logEvent(existing.id, req.user, 'note', existing.note, data.note);
    }

    // Handyperson-triggered status changes notify PMs/Owners per spec.
    // PM-triggered status changes (via PUT) are intentionally silent.
    if (req.user.role === 'HANDYPERSON' && data.status && data.status !== existing.status) {
      try {
        await sendHandypersonStatusChangeNotification({
          existing,
          updated,
          actor: req.user,
          note: data.note,
        });
      } catch (e) {
        console.error('handyperson status notification error:', e);
      }
    }

    // Resident "Your ticket is in progress / resolved" email, if opted in.
    try {
      await sendResidentStatusEmail({ existing, updated });
    } catch (e) {
      console.error('resident status email error:', e);
    }

    return res.json({ item: shapeItem(updated) });
  } catch (error) {
    console.error('Progress update error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/maintenance/:id/photos ───────────────────

router.post('/:id/photos', photoUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const item = await prisma.maintenanceItem.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });
    if (!item) return res.status(404).json({ error: 'Maintenance item not found' });

    const resized = await sharp(req.file.buffer)
      .rotate()
      .resize(1920, null, { withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const timestamp = Date.now();
    const key = `${item.organizationId}/${item.propertyId}/maintenance/${item.id}/${timestamp}.jpg`;
    const { url } = await uploadFile(key, resized, 'image/jpeg');
    const photo = await prisma.photo.create({
      data: { url, key, maintenanceItemId: item.id },
    });

    try {
      await notifyPMPhotoAdded({ item, actor: req.user });
    } catch (e) {
      console.error('pm photo notification error:', e);
    }

    return res.status(201).json({ photo });
  } catch (error) {
    console.error('Maintenance photo upload error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/maintenance/:id/attachments ──────────────

router.post('/:id/attachments', attachmentUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const label = (req.body.label || 'other').toLowerCase();
    if (!ATTACHMENT_LABELS.includes(label)) {
      return res.status(400).json({ error: `label must be one of ${ATTACHMENT_LABELS.join(', ')}` });
    }

    const item = await prisma.maintenanceItem.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });
    if (!item) return res.status(404).json({ error: 'Maintenance item not found' });

    const ext = (req.file.originalname.match(/\.[^.]+$/) || [''])[0];
    const timestamp = Date.now();
    const key = `${item.organizationId}/${item.propertyId}/maintenance/${item.id}/attachments/${timestamp}-${label}${ext}`;
    const { url } = await uploadFile(key, req.file.buffer, req.file.mimetype);

    const attachment = await prisma.maintenanceAttachment.create({
      data: {
        maintenanceItemId: item.id,
        url,
        key,
        label,
        originalName: req.file.originalname,
        contentType: req.file.mimetype,
      },
    });
    await logEvent(item.id, req.user, 'attachment', null, label, req.file.originalname);
    return res.status(201).json({ attachment });
  } catch (error) {
    console.error('Maintenance attachment upload error:', error);
    if (error.message === 'File type not allowed') {
      return res.status(400).json({ error: 'File type not allowed (PDF, JPG, PNG, WebP only)' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/maintenance/:id/attachments/:attachmentId

router.delete(
  '/:id/attachments/:attachmentId',
  requireRole('OWNER', 'PM'),
  async (req, res) => {
    try {
      const item = await prisma.maintenanceItem.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.user.organizationId,
          deletedAt: null,
        },
      });
      if (!item) return res.status(404).json({ error: 'Maintenance item not found' });

      const attachment = await prisma.maintenanceAttachment.findFirst({
        where: { id: req.params.attachmentId, maintenanceItemId: item.id },
      });
      if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

      await prisma.maintenanceAttachment.delete({ where: { id: attachment.id } });
      return res.json({ success: true });
    } catch (error) {
      console.error('Delete attachment error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ─── PDF generation ─────────────────────────────────────

async function fetchItemsForPdf(ids, orgId) {
  return prisma.maintenanceItem.findMany({
    where: {
      id: { in: ids },
      organizationId: orgId,
      deletedAt: null,
    },
    include: {
      property: { select: { name: true, address: true } },
      room: { select: { label: true } },
      photos: true,
      attachments: true,
      events: { orderBy: { createdAt: 'asc' } },
    },
  });
}

function writeTicketToPdf(doc, item, index, total) {
  if (index > 0) doc.addPage();

  doc
    .fontSize(18).fillColor('#4A4543')
    .text(item.description, { continued: false });

  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#8A8583')
    .text(`${item.property?.name || ''} — ${item.property?.address || ''}`);
  if (item.room?.label) doc.text(`Room: ${item.room.label}`);
  doc.text(`Category: ${item.flagCategory}`);
  if (item.priority) doc.text(`Priority: ${item.priority}`);
  doc.text(`Status: ${item.status}`);
  doc.text(`Created: ${new Date(item.createdAt).toLocaleString('en-US')}`);
  if (item.reportedByName) doc.text(`Reported by: ${item.reportedByName}${item.reportedByRole ? ` (${item.reportedByRole})` : ''}`);
  if (item.assignedTo) doc.text(`Assigned to: ${item.assignedTo}`);
  if (item.vendor) doc.text(`Vendor: ${item.vendor}`);
  if (item.estimatedCost != null) doc.text(`Estimated cost: $${item.estimatedCost.toFixed(2)}`);
  if (item.actualCost != null) doc.text(`Actual cost: $${item.actualCost.toFixed(2)}`);
  if (item.entryCode) doc.text(`Entry code: ${item.entryCode}`);
  if (item.entryApproved) doc.text(`Resident has approved entry: Yes${item.entryApprovedAt ? ` (${new Date(item.entryApprovedAt).toLocaleDateString('en-US')})` : ''}`);

  if (item.note) {
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#4A4543').text('Notes', { underline: true });
    doc.fontSize(10).fillColor('#4A4543').text(item.note);
  }

  if (item.events?.length) {
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#4A4543').text('Timeline', { underline: true });
    doc.fontSize(9).fillColor('#4A4543');
    for (const e of item.events) {
      const when = new Date(e.createdAt).toLocaleString('en-US');
      const who = e.byUserName ? ` by ${e.byUserName}` : '';
      let line = `${when}${who} — ${e.type}`;
      if (e.fromValue || e.toValue) line += `: ${e.fromValue || '—'} → ${e.toValue || '—'}`;
      if (e.note) line += ` (${e.note})`;
      doc.text(line);
    }
  }

  doc.moveDown(0.5);
  doc.fontSize(9).fillColor('#8A8583')
    .text(`Ticket ${index + 1} of ${total} — ID ${item.id}`, { align: 'right' });
}

// GET /api/maintenance/:id/pdf — single-ticket PDF
router.get('/:id/pdf', async (req, res) => {
  try {
    const items = await fetchItemsForPdf([req.params.id], req.user.organizationId);
    if (!items.length) return res.status(404).json({ error: 'Maintenance item not found' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ticket-${items[0].id}.pdf"`);

    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    doc.pipe(res);
    writeTicketToPdf(doc, items[0], 0, 1);
    doc.end();
  } catch (error) {
    console.error('Single PDF error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/maintenance/batch-pdf — combined work order
// Body: { ids: [...] } OR { propertyId, assignedTo }
router.post('/batch-pdf', async (req, res) => {
  try {
    const { ids, propertyId, assignedTo, assignedUserId, assignedVendorId } = req.body || {};

    let items;
    if (Array.isArray(ids) && ids.length > 0) {
      items = await fetchItemsForPdf(ids, req.user.organizationId);
    } else {
      const where = { organizationId: req.user.organizationId, deletedAt: null };
      if (propertyId) where.propertyId = propertyId;
      if (assignedTo) where.assignedTo = assignedTo;
      if (assignedUserId) where.assignedUserId = assignedUserId;
      if (assignedVendorId) where.assignedVendorId = assignedVendorId;
      items = await prisma.maintenanceItem.findMany({
        where,
        include: {
          property: { select: { name: true, address: true } },
          room: { select: { label: true } },
          photos: true,
          attachments: true,
          events: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      });
    }
    if (!items.length) return res.status(404).json({ error: 'No tickets match' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="work-order-${Date.now()}.pdf"`);

    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    doc.pipe(res);

    // Cover
    const firstProp = items[0].property;
    const assignee = assignedTo || items.find((i) => i.assignedTo)?.assignedTo || '—';
    doc.fontSize(22).fillColor('#4A4543').text('Maintenance Work Order');
    doc.moveDown(0.2);
    doc.fontSize(11).fillColor('#8A8583')
      .text(`${firstProp?.name || ''}${firstProp?.address ? ' — ' + firstProp.address : ''}`);
    doc.text(`Assigned to: ${assignee}`);
    doc.text(`Generated: ${new Date().toLocaleString('en-US')}`);
    doc.text(`${items.length} ticket${items.length === 1 ? '' : 's'}`);

    items.forEach((item, i) => writeTicketToPdf(doc, item, i + 1, items.length + 1));
    doc.end();
  } catch (error) {
    console.error('Batch PDF error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/maintenance/:id/defer ────────────────────
// Push a ticket off the active board until either the next room turn
// or a specific calendar date. Records who deferred, why, and logs an
// event so the timeline reads cleanly.

router.post('/:id/defer', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { type, reason, untilDate } = req.body || {};
    if (!['ROOM_TURN', 'DATE'].includes(type)) {
      return res.status(400).json({ error: 'type must be ROOM_TURN or DATE' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'reason is required' });
    }
    let parsedDate = null;
    if (type === 'DATE') {
      if (!untilDate) return res.status(400).json({ error: 'untilDate is required for type=DATE' });
      parsedDate = new Date(untilDate);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ error: 'untilDate is not a valid date' });
      }
      // Use the start of that day in UTC so the daily job reactivates it
      // when the calendar date arrives regardless of TZ drift.
      parsedDate = new Date(Date.UTC(
        parsedDate.getUTCFullYear(),
        parsedDate.getUTCMonth(),
        parsedDate.getUTCDate(),
      ));
    }

    const existing = await prisma.maintenanceItem.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!existing) return res.status(404).json({ error: 'Maintenance item not found' });
    if (existing.status === 'DEFERRED') {
      return res.status(400).json({ error: 'Ticket is already deferred' });
    }
    if (existing.status === 'RESOLVED') {
      return res.status(400).json({ error: 'Cannot defer a resolved ticket' });
    }

    const updated = await prisma.maintenanceItem.update({
      where: { id: existing.id },
      data: {
        status: 'DEFERRED',
        deferType: type,
        deferUntil: type === 'DATE' ? parsedDate : null,
        deferReason: String(reason).trim(),
        deferredAt: new Date(),
        deferredById: req.user.id,
        deferredByName: req.user.name,
        reactivatedAt: null,
        reactivatedReason: null,
      },
      include: MAINTENANCE_INCLUDE,
    });

    const humanTarget = type === 'ROOM_TURN'
      ? 'room turn'
      : `until ${parsedDate.toISOString().slice(0, 10)}`;
    await logEvent(existing.id, req.user, 'deferred', existing.status, 'DEFERRED', `${humanTarget}: ${String(reason).trim()}`);

    return res.json({ item: shapeItem(updated) });
  } catch (error) {
    console.error('Defer maintenance error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/maintenance/:id/reactivate ───────────────
// Manual reactivation of a deferred ticket — flips it back to OPEN,
// clears the defer metadata, logs why (auto-filled if the caller omits).

router.post('/:id/reactivate', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const existing = await prisma.maintenanceItem.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!existing) return res.status(404).json({ error: 'Maintenance item not found' });
    if (existing.status !== 'DEFERRED') {
      return res.status(400).json({ error: 'Ticket is not deferred' });
    }

    const note = `Reactivated from deferred — manual on ${new Date().toISOString().slice(0, 10)}`;
    const updated = await prisma.maintenanceItem.update({
      where: { id: existing.id },
      data: {
        status: 'OPEN',
        reactivatedAt: new Date(),
        reactivatedReason: note,
      },
      include: MAINTENANCE_INCLUDE,
    });

    await logEvent(existing.id, req.user, 'reactivated', 'DEFERRED', 'OPEN', note);
    return res.json({ item: shapeItem(updated) });
  } catch (error) {
    console.error('Reactivate maintenance error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Notification helpers ──────────────────────────────

function originFromEnv() {
  return (process.env.APP_URL || '').replace(/\/$/, '');
}

async function sendHandypersonStatusChangeNotification({ existing, updated, actor, note }) {
  const ids = await pmAndOwnerIds(existing.organizationId);
  if (ids.length === 0) return;

  const locationStr = [updated.property?.name, updated.room?.label].filter(Boolean).join(' · ');
  const costs = [];
  if (updated.estimatedCost != null) costs.push(`Estimated: $${Number(updated.estimatedCost).toFixed(2)}`);
  if (updated.actualCost != null) costs.push(`Actual: $${Number(updated.actualCost).toFixed(2)}`);

  const bodyHtml = `
    <p style="margin:0 0 12px;">${esc(actor.name)} (Handyperson) updated a ticket:</p>
    ${summaryList([
      ['Ticket', updated.description],
      ['Location', locationStr],
      ['Status', `${existing.status} → ${updated.status}`],
      ['Note', note || '—'],
      ['Cost', costs.join(' · ') || '—'],
    ])}
  `;

  const link = `/maintenance?open=${updated.id}`;
  await notifyMany({
    userIds: ids,
    organizationId: existing.organizationId,
    type: 'MAINTENANCE_STATUS_CHANGED',
    title: `Ticket ${updated.status.toLowerCase()} — ${updated.description.slice(0, 60)}`,
    message: `${actor.name} moved "${updated.description}" to ${updated.status}${note ? `: ${note}` : ''}`,
    link,
    email: {
      subject: `${updated.property?.name || 'Ticket'} — ${existing.status} → ${updated.status}`,
      ctaLabel: 'Open ticket',
      ctaHref: `${originFromEnv()}${link}`,
      bodyHtml,
    },
  });
}

async function runPMUpdateNotifications({ existing, updated, body, actor }) {
  if (!updated.assignedUserId) return;
  if (!['OWNER', 'PM'].includes(actor.role)) return;

  const assignee = await prisma.user.findUnique({
    where: { id: updated.assignedUserId },
    select: { id: true, role: true, organizationId: true },
  });
  if (!assignee || assignee.role !== 'HANDYPERSON') return;

  const locationStr = [updated.property?.name, updated.room?.label].filter(Boolean).join(' · ');
  const link = `/maintenance?open=${updated.id}`;

  // New assignment: the ticket wasn't assigned to them before.
  if (body.assignedUserId !== undefined && updated.assignedUserId !== existing.assignedUserId) {
    await notify({
      userId: assignee.id,
      organizationId: assignee.organizationId,
      type: 'MAINTENANCE_ASSIGNED',
      title: `New ticket assigned — ${updated.property?.name || ''}`,
      message: `${updated.description}${updated.priority ? ` · ${updated.priority}` : ''}`,
      link,
      email: {
        subject: `New ticket assigned — ${updated.property?.name || ''}`,
        ctaLabel: 'Open ticket',
        ctaHref: `${originFromEnv()}${link}`,
        bodyHtml: `
          <p style="margin:0 0 12px;">${esc(actor.name)} just assigned you a new ticket.</p>
          ${summaryList([
            ['Property', updated.property?.name],
            ['Task', updated.description],
            ['Location', locationStr],
            ['Priority', updated.priority || '—'],
          ])}
        `,
      },
    });
  }

  // Priority change
  if (body.priority !== undefined && body.priority !== existing.priority) {
    await notify({
      userId: assignee.id,
      organizationId: assignee.organizationId,
      type: 'MAINTENANCE_PRIORITY_CHANGED',
      title: `Ticket priority changed — ${updated.description.slice(0, 60)}`,
      message: `Priority is now ${updated.priority || 'unset'}.`,
      link,
      email: {
        subject: `Ticket priority changed — ${updated.description.slice(0, 60)}`,
        ctaLabel: 'Open ticket',
        ctaHref: `${originFromEnv()}${link}`,
        bodyHtml: `
          <p style="margin:0 0 12px;">${esc(actor.name)} changed the priority on a ticket assigned to you.</p>
          ${summaryList([
            ['Ticket', updated.description],
            ['Location', locationStr],
            ['Priority', `${existing.priority || '—'} → ${updated.priority || '—'}`],
          ])}
        `,
      },
    });
  }

  // Note update
  if (body.note !== undefined && body.note !== existing.note && body.note) {
    await notify({
      userId: assignee.id,
      organizationId: assignee.organizationId,
      type: 'MAINTENANCE_PM_UPDATE',
      title: `New note on your ticket — ${updated.description.slice(0, 60)}`,
      message: body.note,
      link,
      email: {
        subject: `New note on your ticket — ${updated.description.slice(0, 60)}`,
        ctaLabel: 'Open ticket',
        ctaHref: `${originFromEnv()}${link}`,
        bodyHtml: `
          <p style="margin:0 0 12px;">${esc(actor.name)} left a note on your ticket.</p>
          <p style="margin:0 0 12px;padding:12px;background:#F5F2EF;border-radius:6px;">${esc(body.note)}</p>
          ${summaryList([
            ['Ticket', updated.description],
            ['Location', locationStr],
          ])}
        `,
      },
    });
  }
}

export async function notifyPMPhotoAdded({ item, actor }) {
  if (!item.assignedUserId) return;
  if (!['OWNER', 'PM'].includes(actor.role)) return;
  const assignee = await prisma.user.findUnique({
    where: { id: item.assignedUserId },
    select: { id: true, role: true, organizationId: true },
  });
  if (!assignee || assignee.role !== 'HANDYPERSON') return;
  const link = `/maintenance?open=${item.id}`;
  await notify({
    userId: assignee.id,
    organizationId: assignee.organizationId,
    type: 'MAINTENANCE_PM_UPDATE',
    title: `New photo on your ticket — ${item.description.slice(0, 60)}`,
    message: `${actor.name} attached a photo to your ticket.`,
    link,
    email: {
      subject: `New photo on your ticket — ${item.description.slice(0, 60)}`,
      ctaLabel: 'Open ticket',
      ctaHref: `${originFromEnv()}${link}`,
      bodyHtml: `<p style="margin:0 0 12px;">${esc(actor.name)} attached a new photo to your ticket "<strong>${esc(item.description)}</strong>".</p>`,
    },
  });
}

async function sendResidentStatusEmail({ existing, updated }) {
  if (!existing.reporterEmail || !existing.reporterNotifyOptIn || existing.reporterUnsubscribed) {
    return;
  }
  if (updated.status === existing.status) return;

  const trackingUrl = `${originFromEnv()}/track/${existing.trackingToken}`;
  const unsubUrl = `${trackingUrl}?unsubscribe=1`;

  let subject;
  let title;
  let bodyHtml;
  if (updated.status === 'IN_PROGRESS') {
    subject = 'Your maintenance report is being worked on';
    title = 'Your maintenance report is being worked on';
    bodyHtml = `<p style="margin:0 0 12px;">${esc(updated.description)} at ${esc(updated.property?.name || 'your property')} is now being addressed.</p>`;
  } else if (updated.status === 'RESOLVED') {
    subject = 'Your maintenance report has been resolved';
    title = 'Your maintenance report has been resolved';
    bodyHtml = `<p style="margin:0 0 12px;">${esc(updated.description)} at ${esc(updated.property?.name || 'your property')} has been resolved. If you're still experiencing issues, you can submit a new report.</p>`;
  } else {
    return;
  }

  const html = residentEmailShell({
    title,
    bodyHtml,
    ctaLabel: 'Track your report',
    ctaHref: trackingUrl,
    unsubscribeHref: unsubUrl,
  });

  await sendEmail({
    to: existing.reporterEmail,
    subject,
    html,
    text: `${title}\n\n${updated.description} at ${updated.property?.name || 'your property'}.\nTrack: ${trackingUrl}`,
  });
}

export default router;
