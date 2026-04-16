import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

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
router.get('/', async (req, res) => {
  try {
    const properties = await prisma.property.findMany({
      where: { organizationId: req.user.organizationId, deletedAt: null },
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

    return res.json({ properties });
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

// GET /api/properties/:id — get property with rooms, kitchens, bathrooms
router.get('/:id', async (req, res) => {
  try {
    const property = await prisma.property.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user.organizationId,
        deletedAt: null,
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
