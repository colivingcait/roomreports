import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import prisma from '../lib/prisma.js';
import { uploadFile, deleteFile, getSignedFileUrl } from '../lib/storage.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Multer: store in memory, max 10MB, images only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// ─── POST /api/inspections/:id/items/:itemId/photos ─────
// Upload a photo to an inspection item.
//
// curl -X POST http://localhost:3000/api/inspections/INSP_ID/items/ITEM_ID/photos \
//   -b cookies.txt -F "photo=@/path/to/image.jpg"

router.post(
  '/inspections/:id/items/:itemId/photos',
  upload.single('photo'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      // Verify inspection belongs to user's org
      const inspection = await prisma.inspection.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.user.organizationId,
          deletedAt: null,
        },
      });
      if (!inspection) {
        return res.status(404).json({ error: 'Inspection not found' });
      }

      // Verify item belongs to inspection
      const item = await prisma.inspectionItem.findFirst({
        where: { id: req.params.itemId, inspectionId: inspection.id },
      });
      if (!item) {
        return res.status(404).json({ error: 'Inspection item not found' });
      }

      // Normalize EXIF orientation first, then resize. sharp's .rotate()
      // with no args auto-rotates based on the EXIF Orientation tag, so
      // iPhone / Android photos land right-side-up regardless of how the
      // phone held the sensor.
      const resized = await sharp(req.file.buffer)
        .rotate()
        .resize(1920, null, { withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

      // Build S3 key: {orgId}/{propertyId}/{inspectionId}/{itemId}/{timestamp}.jpg
      const timestamp = Date.now();
      const key = `${inspection.organizationId}/${inspection.propertyId}/${inspection.id}/${item.id}/${timestamp}.jpg`;

      // Upload to DigitalOcean Spaces
      const { url } = await uploadFile(key, resized, 'image/jpeg');

      // Create database record
      const photo = await prisma.photo.create({
        data: {
          url,
          key,
          inspectionItemId: item.id,
        },
      });

      return res.status(201).json({ photo });
    } catch (error) {
      console.error('Photo upload error:', error);
      if (error.message === 'Only image files are allowed') {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ─── DELETE /api/inspections/:id/items/:itemId/photos/:photoId
// Delete a photo (remove from S3 + database).
//
// curl -X DELETE http://localhost:3000/api/inspections/INSP_ID/items/ITEM_ID/photos/PHOTO_ID \
//   -b cookies.txt

router.delete(
  '/inspections/:id/items/:itemId/photos/:photoId',
  async (req, res) => {
    try {
      // Verify inspection belongs to user's org
      const inspection = await prisma.inspection.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.user.organizationId,
          deletedAt: null,
        },
      });
      if (!inspection) {
        return res.status(404).json({ error: 'Inspection not found' });
      }

      // Verify photo belongs to the item
      const photo = await prisma.photo.findFirst({
        where: {
          id: req.params.photoId,
          inspectionItemId: req.params.itemId,
        },
      });
      if (!photo) {
        return res.status(404).json({ error: 'Photo not found' });
      }

      // Delete from S3
      try {
        await deleteFile(photo.key);
      } catch (err) {
        console.error('S3 delete error (continuing):', err.message);
      }

      // Delete from database
      await prisma.photo.delete({ where: { id: photo.id } });

      return res.json({ success: true });
    } catch (error) {
      console.error('Photo delete error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ─── GET /api/photos/:id — get signed URL ───────────────
// Returns a time-limited signed URL for the photo.
//
// curl http://localhost:3000/api/photos/PHOTO_ID -b cookies.txt

router.get('/photos/:id', async (req, res) => {
  try {
    const photo = await prisma.photo.findUnique({
      where: { id: req.params.id },
      include: {
        inspectionItem: {
          select: {
            inspection: {
              select: { organizationId: true },
            },
          },
        },
        maintenanceItem: {
          select: { organizationId: true },
        },
      },
    });

    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    // Verify org access
    const photoOrgId = photo.inspectionItem?.inspection?.organizationId
      || photo.maintenanceItem?.organizationId;

    if (photoOrgId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const signedUrl = await getSignedFileUrl(photo.key);

    return res.json({ photo: { ...photo, signedUrl } });
  } catch (error) {
    console.error('Get photo error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle multer errors
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large (max 10MB)' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message === 'Only image files are allowed') {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: 'Internal server error' });
});

export default router;
