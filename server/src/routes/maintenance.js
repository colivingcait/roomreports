import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import prisma from '../lib/prisma.js';
import { uploadFile } from '../lib/storage.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { propertyIdScope } from '../lib/scope.js';
import { PRIORITIES, ATTACHMENT_LABELS } from '../../../shared/index.js';

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
  inspectionItem: { select: { id: true, text: true } },
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
      startDate, endDate, includeArchived, search,
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

    // Archive policy: drop RESOLVED items older than 7d from the default board view
    if (!includeArchived && !status) {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      where.OR = [
        { status: { not: 'RESOLVED' } },
        { resolvedAt: { gte: cutoff } },
        { resolvedAt: null },
      ];
    }

    const items = await prisma.maintenanceItem.findMany({
      where,
      include: MAINTENANCE_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
    });

    // Status counts reflect the same archive policy so the pills match the board
    const countWhere = {
      organizationId: req.user.organizationId,
      deletedAt: null,
      ...(propertyId ? { propertyId } : {}),
    };
    if (!includeArchived) {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      countWhere.OR = [
        { status: { not: 'RESOLVED' } },
        { resolvedAt: { gte: cutoff } },
        { resolvedAt: null },
      ];
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
      include: DETAIL_INCLUDE,
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

    return res.json({
      item: shapeItem(item),
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

router.post('/', requireRole('OWNER', 'PM'), async (req, res) => {
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

    return res.json({ item: shapeItem(updated) });
  } catch (error) {
    console.error('Update maintenance error:', error);
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
      .resize(1920, null, { withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const timestamp = Date.now();
    const key = `${item.organizationId}/${item.propertyId}/maintenance/${item.id}/${timestamp}.jpg`;
    const { url } = await uploadFile(key, resized, 'image/jpeg');
    const photo = await prisma.photo.create({
      data: { url, key, maintenanceItemId: item.id },
    });
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

export default router;
