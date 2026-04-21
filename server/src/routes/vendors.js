import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { FLAG_CATEGORIES } from '../../../shared/index.js';

const router = Router();
router.use(requireAuth);

const VENDOR_INCLUDE = {};

function sanitizeSpecialties(input) {
  if (!Array.isArray(input)) return [];
  return input.filter((s) => FLAG_CATEGORIES.includes(s));
}

// ─── GET /api/vendors — list ────────────────────────────

router.get('/', async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const vendors = await prisma.vendor.findMany({
      where: {
        organizationId: req.user.organizationId,
        ...(includeArchived ? {} : { deletedAt: null }),
      },
      orderBy: [{ name: 'asc' }],
    });

    // Active-jobs count per vendor (OPEN + ASSIGNED + IN_PROGRESS)
    let activeCounts = [];
    if (vendors.length > 0) {
      activeCounts = await prisma.maintenanceItem.groupBy({
        by: ['assignedVendorId'],
        where: {
          organizationId: req.user.organizationId,
          deletedAt: null,
          status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
          assignedVendorId: { in: vendors.map((v) => v.id) },
        },
        _count: true,
      });
    }
    const countMap = {};
    for (const row of activeCounts) countMap[row.assignedVendorId] = row._count;

    return res.json({
      vendors: vendors.map((v) => ({ ...v, activeJobs: countMap[v.id] || 0 })),
    });
  } catch (error) {
    console.error('List vendors error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/vendors — create ─────────────────────────

router.post('/', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const { name, company, phone, email, specialties, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const vendor = await prisma.vendor.create({
      data: {
        organizationId: req.user.organizationId,
        name: name.trim(),
        company: company?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        specialties: sanitizeSpecialties(specialties),
        notes: notes?.trim() || null,
      },
    });
    return res.status(201).json({ vendor });
  } catch (error) {
    console.error('Create vendor error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/vendors/:id — detail + aggregates ─────────

router.get('/:id', async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    const maintenance = await prisma.maintenanceItem.findMany({
      where: {
        organizationId: req.user.organizationId,
        assignedVendorId: vendor.id,
        deletedAt: null,
      },
      include: {
        property: { select: { id: true, name: true, address: true } },
        room: { select: { id: true, label: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Aggregates
    const total = maintenance.length;
    const open = maintenance.filter((m) => m.status !== 'RESOLVED').length;
    const completed = maintenance.filter((m) => m.status === 'RESOLVED').length;
    const totalSpend = maintenance.reduce(
      (sum, m) => sum + (m.actualCost ?? 0),
      0,
    );

    // Average response time — created → first status change (non-OPEN)
    const firstEvents = await prisma.maintenanceEvent.findMany({
      where: {
        maintenanceItemId: { in: maintenance.map((m) => m.id) },
        type: 'status',
      },
      orderBy: { createdAt: 'asc' },
    });
    const responseMs = [];
    const seen = new Set();
    for (const ev of firstEvents) {
      if (seen.has(ev.maintenanceItemId)) continue;
      seen.add(ev.maintenanceItemId);
      const item = maintenance.find((m) => m.id === ev.maintenanceItemId);
      if (!item) continue;
      responseMs.push(new Date(ev.createdAt) - new Date(item.createdAt));
    }
    const avgResponseMs = responseMs.length
      ? responseMs.reduce((a, b) => a + b, 0) / responseMs.length
      : null;

    return res.json({
      vendor,
      stats: {
        total,
        open,
        completed,
        totalSpend,
        avgResponseMs,
      },
      maintenance,
    });
  } catch (error) {
    console.error('Get vendor error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/vendors/:id ───────────────────────────────

router.put('/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const existing = await prisma.vendor.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!existing) return res.status(404).json({ error: 'Vendor not found' });

    const { name, company, phone, email, specialties, notes } = req.body;
    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (company !== undefined) data.company = company?.trim() || null;
    if (phone !== undefined) data.phone = phone?.trim() || null;
    if (email !== undefined) data.email = email?.trim() || null;
    if (specialties !== undefined) data.specialties = sanitizeSpecialties(specialties);
    if (notes !== undefined) data.notes = notes?.trim() || null;

    const vendor = await prisma.vendor.update({
      where: { id: existing.id },
      data,
    });
    return res.json({ vendor });
  } catch (error) {
    console.error('Update vendor error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/vendors/:id — soft archive ─────────────

router.delete('/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    await prisma.vendor.update({
      where: { id: vendor.id },
      data: { deletedAt: new Date() },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('Archive vendor error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/vendors/:id/restore ──────────────────────

router.post('/:id/restore', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    await prisma.vendor.update({
      where: { id: vendor.id },
      data: { deletedAt: null },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('Restore vendor error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
