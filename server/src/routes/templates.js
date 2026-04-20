import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { generateChecklist } from '../lib/checklist.js';

const router = Router();
router.use(requireAuth);

const INSPECTION_TYPES = [
  'COMMON_AREA', 'ROOM_TURN', 'QUARTERLY', 'RESIDENT_SELF_CHECK', 'MOVE_IN_OUT',
];

function stubProperty() {
  // A minimal property + room so generateChecklist can produce a representative default.
  return {
    name: 'Template',
    kitchens: [{ label: 'Kitchen' }],
    bathrooms: [{ label: 'Bathroom' }],
    rooms: [],
  };
}
function stubRoom() {
  return { label: 'Room', features: [], furniture: [] };
}

async function ensureTemplate(organizationId, inspectionType) {
  const existing = await prisma.inspectionTemplate.findUnique({
    where: { organizationId_inspectionType: { organizationId, inspectionType } },
    include: { items: { orderBy: { position: 'asc' } } },
  });
  if (existing) return existing;

  // Seed from defaults so the editor opens to something the host can modify
  const defaults = generateChecklist(inspectionType, stubProperty(), stubRoom(), { direction: 'Move-In' });
  const created = await prisma.inspectionTemplate.create({
    data: {
      organizationId,
      inspectionType,
      items: {
        create: defaults.map((d, i) => ({
          zone: d.zone,
          text: d.text,
          options: d.options || [],
          position: i,
        })),
      },
    },
    include: { items: { orderBy: { position: 'asc' } } },
  });
  return created;
}

// ─── GET /api/templates — list (one per type, creating on demand) ──

router.get('/', async (req, res) => {
  try {
    const rows = await Promise.all(
      INSPECTION_TYPES.map((t) => ensureTemplate(req.user.organizationId, t)),
    );
    return res.json({ templates: rows });
  } catch (error) {
    console.error('List templates error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/templates/:type ───────────────────────────

router.get('/:type', async (req, res) => {
  try {
    if (!INSPECTION_TYPES.includes(req.params.type)) {
      return res.status(400).json({ error: 'Unknown inspection type' });
    }
    const tpl = await ensureTemplate(req.user.organizationId, req.params.type);
    return res.json({ template: tpl });
  } catch (error) {
    console.error('Get template error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/templates/:type/reset — re-seed from defaults ──

router.post('/:type/reset', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    if (!INSPECTION_TYPES.includes(req.params.type)) {
      return res.status(400).json({ error: 'Unknown inspection type' });
    }
    const defaults = generateChecklist(req.params.type, stubProperty(), stubRoom(), { direction: 'Move-In' });
    const tpl = await prisma.$transaction(async (tx) => {
      const existing = await tx.inspectionTemplate.upsert({
        where: {
          organizationId_inspectionType: {
            organizationId: req.user.organizationId,
            inspectionType: req.params.type,
          },
        },
        update: {},
        create: {
          organizationId: req.user.organizationId,
          inspectionType: req.params.type,
        },
      });
      await tx.inspectionTemplateItem.deleteMany({ where: { templateId: existing.id } });
      await tx.inspectionTemplateItem.createMany({
        data: defaults.map((d, i) => ({
          templateId: existing.id,
          zone: d.zone,
          text: d.text,
          options: d.options || [],
          position: i,
        })),
      });
      return tx.inspectionTemplate.findUnique({
        where: { id: existing.id },
        include: { items: { orderBy: { position: 'asc' } } },
      });
    });
    return res.json({ template: tpl });
  } catch (error) {
    console.error('Reset template error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/templates/:type/items — add item ─────────

router.post('/:type/items', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { zone, text, options } = req.body || {};
    if (!zone?.trim() || !text?.trim()) {
      return res.status(400).json({ error: 'zone and text are required' });
    }
    const tpl = await ensureTemplate(req.user.organizationId, req.params.type);
    const maxPos = tpl.items.reduce((m, it) => Math.max(m, it.position), -1);
    const item = await prisma.inspectionTemplateItem.create({
      data: {
        templateId: tpl.id,
        zone: zone.trim(),
        text: text.trim(),
        options: Array.isArray(options) ? options : ['Pass', 'Fail', 'N/A'],
        position: maxPos + 1,
      },
    });
    return res.status(201).json({ item });
  } catch (error) {
    console.error('Add template item error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/templates/:type/items/:id ─────────────────

router.put('/:type/items/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const tpl = await ensureTemplate(req.user.organizationId, req.params.type);
    const item = await prisma.inspectionTemplateItem.findFirst({
      where: { id: req.params.id, templateId: tpl.id },
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const { zone, text, options } = req.body || {};
    const data = {};
    if (zone !== undefined) data.zone = zone.trim();
    if (text !== undefined) data.text = text.trim();
    if (options !== undefined) data.options = Array.isArray(options) ? options : [];
    const updated = await prisma.inspectionTemplateItem.update({
      where: { id: item.id }, data,
    });
    return res.json({ item: updated });
  } catch (error) {
    console.error('Update template item error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/templates/:type/items/:id ──────────────

router.delete('/:type/items/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const tpl = await ensureTemplate(req.user.organizationId, req.params.type);
    const item = await prisma.inspectionTemplateItem.findFirst({
      where: { id: req.params.id, templateId: tpl.id },
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    await prisma.inspectionTemplateItem.delete({ where: { id: item.id } });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete template item error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/templates/:type/reorder — apply new ordering ──
// Body: { order: [itemId, itemId, ...] }

router.post('/:type/reorder', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { order } = req.body || {};
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
    const tpl = await ensureTemplate(req.user.organizationId, req.params.type);
    const idSet = new Set(tpl.items.map((i) => i.id));
    for (const id of order) {
      if (!idSet.has(id)) return res.status(400).json({ error: 'order contains unknown item id' });
    }
    await prisma.$transaction(
      order.map((id, idx) =>
        prisma.inspectionTemplateItem.update({
          where: { id }, data: { position: idx },
        }),
      ),
    );
    const refreshed = await prisma.inspectionTemplate.findUnique({
      where: { id: tpl.id },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    return res.json({ template: refreshed });
  } catch (error) {
    console.error('Reorder template error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
