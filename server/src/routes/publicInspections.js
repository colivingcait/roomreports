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

async function findOrganizationBySlug(slug) {
  return prisma.organization.findFirst({
    where: { slug, deletedAt: null },
  });
}

// Legacy property-slug lookup — kept so old per-property QR codes keep working.
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
    if (addrNum && slugify(`${addrNum}-${p.name}`) === slug) return true;
    return slugify(`${p.address}-${p.name}`) === slug;
  });
}

// Rate limit: max 5 per room per day
const rateLimits = {};
function checkRateLimit(roomId) {
  const key = `${roomId}-${new Date().toISOString().slice(0, 10)}`;
  rateLimits[key] = (rateLimits[key] || 0) + 1;
  return rateLimits[key] <= 5;
}

async function resolveOrgAndProperty(slug, propertyId) {
  // Try org-slug lookup first
  const org = await findOrganizationBySlug(slug);
  if (org) {
    if (!propertyId) return { error: 'propertyId is required', status: 400 };
    const property = await prisma.property.findFirst({
      where: { id: propertyId, organizationId: org.id, deletedAt: null },
      include: {
        rooms: { where: { deletedAt: null } },
        organization: { select: { id: true, name: true } },
      },
    });
    if (!property) return { error: 'Property not found', status: 404 };
    return { property };
  }
  // Fall back to legacy per-property slug
  const property = await findPropertyBySlug(slug);
  if (!property) return { error: 'Not found', status: 404 };
  return { property };
}

// ─── GET /api/public/org/:slug — org info (public, no auth) ──

router.get('/org/:slug', async (req, res) => {
  try {
    const org = await findOrganizationBySlug(req.params.slug);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    return res.json({
      organizationId: org.id,
      organizationName: org.name,
    });
  } catch (error) {
    console.error('Public org lookup error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/public/org/:slug/properties?search=... — street name search ──

router.get('/org/:slug/properties', async (req, res) => {
  try {
    const org = await findOrganizationBySlug(req.params.slug);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const search = (req.query.search || '').trim().toLowerCase();
    if (!search || search.length < 3) return res.json({ properties: [] });

    const properties = await prisma.property.findMany({
      where: {
        organizationId: org.id,
        deletedAt: null,
        OR: [
          { address: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, address: true },
      orderBy: { address: 'asc' },
      take: 10,
    });

    return res.json({
      properties: properties.map((p) => ({
        id: p.id,
        address: p.address,
        // Do not include name or organization name — keep it anonymous
      })),
    });
  } catch (error) {
    console.error('Public property search error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/public/org/:slug/property/:propertyId — rooms for selected property ──

router.get('/org/:slug/property/:propertyId', async (req, res) => {
  try {
    const org = await findOrganizationBySlug(req.params.slug);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const property = await prisma.property.findFirst({
      where: { id: req.params.propertyId, organizationId: org.id, deletedAt: null },
      include: { rooms: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
    });
    if (!property) return res.status(404).json({ error: 'Property not found' });

    return res.json({
      propertyId: property.id,
      address: property.address,
      rooms: property.rooms.map((r) => ({ id: r.id, label: r.label, features: r.features })),
    });
  } catch (error) {
    console.error('Public property rooms error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/public/property/:slug — LEGACY per-property lookup ──

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

async function createResidentInspection(type, resolved, body, res) {
  const { property } = resolved;
  const { residentName, roomId, items } = body;

  if (!residentName || !roomId || !Array.isArray(items)) {
    return res.status(400).json({ error: 'residentName, roomId, and items are required' });
  }
  const room = property.rooms.find((r) => r.id === roomId);
  if (!room) return res.status(400).json({ error: 'Room not found in this property' });
  if (!checkRateLimit(roomId)) {
    return res.status(429).json({ error: 'Too many submissions for this room today' });
  }

  const owner = await prisma.user.findFirst({
    where: { organizationId: property.organization.id, role: 'OWNER', deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) return res.status(500).json({ error: 'No owner found for this organization' });

  const inspection = await prisma.inspection.create({
    data: {
      type,
      status: 'SUBMITTED',
      propertyId: property.id,
      roomId: room.id,
      inspectorId: owner.id,
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

  console.log(`[NOTIFICATION] ${type} submitted for ${property.name} / ${room.label} by ${residentName}`);

  return res.status(201).json({ inspectionId: inspection.id });
}

// ─── POST /api/public/movein/:slug ──

router.post('/movein/:slug', async (req, res) => {
  try {
    const resolved = await resolveOrgAndProperty(req.params.slug, req.body?.propertyId);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    return createResidentInspection('MOVE_IN_OUT', resolved, req.body, res);
  } catch (error) {
    console.error('Public move-in error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/public/selfcheck/:slug ──

router.post('/selfcheck/:slug', async (req, res) => {
  try {
    const resolved = await resolveOrgAndProperty(req.params.slug, req.body?.propertyId);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    return createResidentInspection('RESIDENT_SELF_CHECK', resolved, req.body, res);
  } catch (error) {
    console.error('Public self-check error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/public/report/:orgSlug — resident reports a maintenance issue ──

router.post('/report/:slug', async (req, res) => {
  try {
    const {
      propertyId,
      roomId,
      description,
      flagCategory,
      note,
      reporterName,
    } = req.body || {};

    if (!propertyId || !description?.trim()) {
      return res.status(400).json({ error: 'propertyId and description are required' });
    }

    const resolved = await resolveOrgAndProperty(req.params.slug, propertyId);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    const { property } = resolved;

    if (!checkRateLimit(roomId || property.id)) {
      return res.status(429).json({ error: 'Too many submissions today' });
    }

    const owner = await prisma.user.findFirst({
      where: { organizationId: property.organization.id, role: 'OWNER', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) return res.status(500).json({ error: 'No owner found for this organization' });

    // Create a synthetic inspection + inspection item so the maintenance item
    // satisfies the existing schema (maintenance items require an inspection item).
    const result = await prisma.$transaction(async (tx) => {
      const inspection = await tx.inspection.create({
        data: {
          type: 'RESIDENT_SELF_CHECK',
          status: 'SUBMITTED',
          propertyId: property.id,
          roomId: roomId || null,
          inspectorId: owner.id,
          inspectorName: reporterName || 'Resident',
          inspectorRole: 'RESIDENT',
          organizationId: property.organization.id,
          completedAt: new Date(),
        },
      });
      const item = await tx.inspectionItem.create({
        data: {
          inspectionId: inspection.id,
          zone: 'Reported Issue',
          text: description.trim(),
          options: [],
          status: 'Fail',
          flagCategory: flagCategory || 'General',
          note: note || null,
          isMaintenance: true,
        },
      });
      const maintenance = await tx.maintenanceItem.create({
        data: {
          inspectionItemId: item.id,
          inspectionId: inspection.id,
          propertyId: property.id,
          roomId: roomId || null,
          organizationId: property.organization.id,
          description: description.trim(),
          zone: 'Reported Issue',
          flagCategory: flagCategory || 'General',
          note: note || null,
          reportedByName: reporterName || 'Resident',
          reportedByRole: 'RESIDENT',
        },
      });
      return { maintenance };
    });

    console.log(
      `[NOTIFICATION] Maintenance report for ${property.name} by ${reporterName || 'Resident'}: ${description.trim()}`
    );

    return res.status(201).json({
      maintenanceItemId: result.maintenance.id,
      organizationId: property.organization.id,
      propertyId: property.id,
    });
  } catch (error) {
    console.error('Public report error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/public/photo — upload photo for public inspection (no auth) ──

router.post('/photo', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const { inspectionId, itemId, organizationId, propertyId, maintenanceItemId } = req.body;

    // Validate that the target exists in a known org before uploading
    let relatedOrgId = organizationId;
    if (maintenanceItemId) {
      const m = await prisma.maintenanceItem.findUnique({
        where: { id: maintenanceItemId },
        select: { organizationId: true },
      });
      if (!m) return res.status(400).json({ error: 'maintenanceItemId not found' });
      relatedOrgId = m.organizationId;
    }

    const resized = await sharp(req.file.buffer)
      .rotate()
      .resize(1920, null, { withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const timestamp = Date.now();
    const key = maintenanceItemId
      ? `${relatedOrgId}/${propertyId || 'unknown'}/maintenance/${maintenanceItemId}/${timestamp}.jpg`
      : `${relatedOrgId || 'public'}/${propertyId || 'unknown'}/${inspectionId || 'temp'}/${itemId || 'item'}/${timestamp}.jpg`;

    const { url } = await uploadFile(key, resized, 'image/jpeg');

    if (maintenanceItemId) {
      const photo = await prisma.photo.create({
        data: { url, key, maintenanceItemId },
      });
      return res.status(201).json({ photo });
    }
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
