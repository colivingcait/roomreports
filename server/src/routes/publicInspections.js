import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import prisma from '../lib/prisma.js';
import { uploadFile } from '../lib/storage.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function findPropertyBySlug(slug) {
  const properties = await prisma.property.findMany({
    where: { deletedAt: null },
    include: {
      rooms: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      organization: { select: { id: true, name: true } },
    },
  });

  return properties.find((p) => {
    if (slugify(p.name) === slug) return true;
    const addrNum = (p.address || '').match(/\d+/)?.[0] || '';
    if (addrNum && slugify(addrNum + p.name) === slug) return true;
    return slugify(p.address + p.name) === slug;
  });
}

// Rate limit: max 5 per room per day
const rateLimits = {};
function checkRateLimit(roomId) {
  const key = `${roomId}-${new Date().toISOString().slice(0, 10)}`;
  rateLimits[key] = (rateLimits[key] || 0) + 1;
  return rateLimits[key] <= 5;
}

// ─── GET /api/public/property/:slug — property + rooms (public) ──

router.get('/property/:slug', async (req, res) => {
  try {
    const property = await findPropertyBySlug(req.params.slug);
    if (!property) return res.status(404).json({ error: 'Property not found' });

    return res.json({
      propertyId: property.id,
      propertyName: property.name,
      organizationName: property.organization.name,
      rooms: property.rooms.map((r) => ({
        id: r.id,
        label: r.label,
        features: r.features,
      })),
    });
  } catch (error) {
    console.error('Public property error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/public/movein/:slug — create move-in inspection (no auth) ──

router.post('/movein/:slug', async (req, res) => {
  try {
    const { residentName, roomId, items } = req.body;
    if (!residentName || !roomId || !Array.isArray(items)) {
      return res.status(400).json({ error: 'residentName, roomId, and items are required' });
    }

    const property = await findPropertyBySlug(req.params.slug);
    if (!property) return res.status(404).json({ error: 'Property not found' });

    const room = property.rooms.find((r) => r.id === roomId);
    if (!room) return res.status(400).json({ error: 'Room not found in this property' });

    if (!checkRateLimit(roomId)) {
      return res.status(429).json({ error: 'Too many submissions for this room today' });
    }

    const inspection = await prisma.inspection.create({
      data: {
        type: 'MOVE_IN_OUT',
        status: 'SUBMITTED',
        propertyId: property.id,
        roomId: room.id,
        inspectorId: null,
        inspectorName: residentName,
        inspectorRole: 'RESIDENT',
        organizationId: property.organization.id,
        completedAt: new Date(),
        items: {
          create: items.map((item) => ({
            zone: item.zone || 'General',
            text: item.text,
            options: item.options || [],
            status: item.status || '',
            note: item.note || null,
            flagCategory: item.flagCategory || null,
            isMaintenance: !!item.isMaintenance,
          })),
        },
      },
    });

    console.log(`[NOTIFICATION] Move-In inspection submitted for ${property.name} / ${room.label} by ${residentName}`);

    return res.status(201).json({ inspectionId: inspection.id });
  } catch (error) {
    console.error('Public move-in error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/public/selfcheck/:slug — create self-check (no auth) ──

router.post('/selfcheck/:slug', async (req, res) => {
  try {
    const { residentName, roomId, items } = req.body;
    if (!residentName || !roomId || !Array.isArray(items)) {
      return res.status(400).json({ error: 'residentName, roomId, and items are required' });
    }

    const property = await findPropertyBySlug(req.params.slug);
    if (!property) return res.status(404).json({ error: 'Property not found' });

    const room = property.rooms.find((r) => r.id === roomId);
    if (!room) return res.status(400).json({ error: 'Room not found in this property' });

    if (!checkRateLimit(roomId)) {
      return res.status(429).json({ error: 'Too many submissions for this room today' });
    }

    const inspection = await prisma.inspection.create({
      data: {
        type: 'RESIDENT_SELF_CHECK',
        status: 'SUBMITTED',
        propertyId: property.id,
        roomId: room.id,
        inspectorId: null,
        inspectorName: residentName,
        inspectorRole: 'RESIDENT',
        organizationId: property.organization.id,
        completedAt: new Date(),
        items: {
          create: items.map((item) => ({
            zone: item.zone || 'General',
            text: item.text,
            options: item.options || [],
            status: item.status || '',
            note: item.note || null,
            flagCategory: item.flagCategory || null,
            isMaintenance: !!item.isMaintenance,
          })),
        },
      },
    });

    console.log(`[NOTIFICATION] Self-Check submitted for ${property.name} / ${room.label} by ${residentName}`);

    return res.status(201).json({ inspectionId: inspection.id });
  } catch (error) {
    console.error('Public self-check error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/public/photo — upload photo for public inspection (no auth) ──

router.post('/photo', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const { inspectionId, itemId, organizationId, propertyId } = req.body;

    const resized = await sharp(req.file.buffer)
      .resize(1920, null, { withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const timestamp = Date.now();
    const key = `${organizationId || 'public'}/${propertyId || 'unknown'}/${inspectionId || 'temp'}/${itemId || 'item'}/${timestamp}.jpg`;

    const { url } = await uploadFile(key, resized, 'image/jpeg');

    if (inspectionId && itemId) {
      const photo = await prisma.photo.create({
        data: { url, key, inspectionItemId: itemId },
      });
      return res.status(201).json({ photo });
    }

    return res.status(201).json({ url, key });
  } catch (error) {
    console.error('Public photo upload error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
