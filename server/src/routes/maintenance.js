import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import prisma from '../lib/prisma.js';
import { uploadFile, deleteFile } from '../lib/storage.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// ─── GET /api/maintenance — list with filters ───────────

router.get('/', async (req, res) => {
  try {
    const { propertyId, status, flagCategory, startDate, endDate } = req.query;

    const where = {
      organizationId: req.user.organizationId,
      deletedAt: null,
    };

    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;
    if (flagCategory) where.flagCategory = flagCategory;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const items = await prisma.maintenanceItem.findMany({
      where,
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
        inspection: { select: { id: true, type: true } },
        inspectionItem: { select: { id: true, text: true } },
        photos: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get status counts for filter badges
    const counts = await prisma.maintenanceItem.groupBy({
      by: ['status'],
      where: { organizationId: req.user.organizationId, deletedAt: null },
      _count: true,
    });

    const statusCounts = { OPEN: 0, ASSIGNED: 0, IN_PROGRESS: 0, RESOLVED: 0 };
    for (const c of counts) {
      statusCounts[c.status] = c._count;
    }

    return res.json({ items, statusCounts });
  } catch (error) {
    console.error('List maintenance error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/maintenance/:id — update item ─────────────

router.put('/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const item = await prisma.maintenanceItem.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });

    if (!item) {
      return res.status(404).json({ error: 'Maintenance item not found' });
    }

    const { status, assignedTo, note, priority } = req.body;

    const data = {};
    if (status !== undefined) data.status = status;
    if (assignedTo !== undefined) data.assignedTo = assignedTo;
    if (note !== undefined) data.note = note;
    if (priority !== undefined) data.priority = priority;

    // Auto-set resolvedAt
    if (status === 'RESOLVED') data.resolvedAt = new Date();
    if (status && status !== 'RESOLVED') data.resolvedAt = null;

    const updated = await prisma.maintenanceItem.update({
      where: { id: item.id },
      data,
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
        inspection: { select: { id: true, type: true } },
        inspectionItem: { select: { id: true, text: true } },
        photos: true,
      },
    });

    return res.json({ item: updated });
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

    if (!item) {
      return res.status(404).json({ error: 'Maintenance item not found' });
    }

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

    if (!item) {
      return res.status(404).json({ error: 'Maintenance item not found' });
    }

    const updated = await prisma.maintenanceItem.update({
      where: { id: item.id },
      data: { status: 'OPEN', resolvedAt: null },
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
        inspection: { select: { id: true, type: true } },
        inspectionItem: { select: { id: true, text: true } },
        photos: true,
      },
    });

    return res.json({ item: updated });
  } catch (error) {
    console.error('Reopen maintenance error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/maintenance/:id/photos ───────────────────

router.post('/:id/photos', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const item = await prisma.maintenanceItem.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
      },
    });

    if (!item) {
      return res.status(404).json({ error: 'Maintenance item not found' });
    }

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

export default router;
