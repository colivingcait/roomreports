import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { signPropertyInvite } from '../lib/propertyInvite.js';

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
        inspector: { select: { name: true, role: true } },
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

    // Build room cards data
    const roomCards = property.rooms.map((r) => ({
      id: r.id,
      label: r.label,
      features: r.features,
      furniture: r.furniture,
      openMaintenanceCount: roomMaintCounts[r.id] || 0,
      lastInspection: roomLastInspection[r.id] || null,
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
