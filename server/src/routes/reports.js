import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole('OWNER', 'PM'));

const DAY_MS = 24 * 60 * 60 * 1000;

function parseRange(query) {
  const preset = query.preset; // this_month | this_quarter | ytd | annual | custom
  const now = new Date();
  let start, end = new Date();
  if (preset === 'this_month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (preset === 'this_quarter') {
    const q = Math.floor(now.getMonth() / 3);
    start = new Date(now.getFullYear(), q * 3, 1);
  } else if (preset === 'ytd') {
    start = new Date(now.getFullYear(), 0, 1);
  } else if (preset === 'annual') {
    start = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  } else if (query.start && query.end) {
    start = new Date(query.start);
    end = new Date(query.end);
  } else {
    start = new Date(now.getFullYear(), 0, 1);
  }
  return { start, end };
}

// ─── GET /api/reports — aggregated numbers ──────────────
// Query: start, end, preset, propertyId, flagCategory, vendorId, priority

router.get('/', async (req, res) => {
  try {
    const { start, end } = parseRange(req.query);
    const { propertyId, flagCategory, assignedVendorId, priority } = req.query;

    const where = {
      organizationId: req.user.organizationId,
      deletedAt: null,
      createdAt: { gte: start, lte: end },
    };
    if (propertyId) where.propertyId = propertyId;
    if (flagCategory) where.flagCategory = flagCategory;
    if (assignedVendorId) where.assignedVendorId = assignedVendorId;
    if (priority) where.priority = priority;

    const items = await prisma.maintenanceItem.findMany({
      where,
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
        assignedVendor: { select: { id: true, name: true, company: true } },
        events: {
          where: { type: { in: ['status', 'assigned'] } },
          orderBy: { createdAt: 'asc' },
          take: 5,
        },
      },
    });

    // Status totals
    const statusTotals = { OPEN: 0, ASSIGNED: 0, IN_PROGRESS: 0, RESOLVED: 0 };
    for (const m of items) statusTotals[m.status] = (statusTotals[m.status] || 0) + 1;

    // Response time (created → first `assigned` event) and resolution (created → resolvedAt)
    const responseMs = [], resolutionMs = [];
    for (const m of items) {
      const assignEvent = m.events.find((e) => e.type === 'assigned' || e.type === 'status');
      if (assignEvent) responseMs.push(new Date(assignEvent.createdAt) - new Date(m.createdAt));
      if (m.resolvedAt) resolutionMs.push(new Date(m.resolvedAt) - new Date(m.createdAt));
    }
    const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    // Cost breakdowns
    function sumBy(arr, keyFn) {
      const out = {};
      for (const m of arr) {
        const key = keyFn(m);
        if (!key) continue;
        if (!out[key]) out[key] = { key, total: 0, count: 0, label: null };
        out[key].total += m.actualCost || 0;
        out[key].count += 1;
      }
      return out;
    }

    const byCategoryMap = sumBy(items, (m) => m.flagCategory);
    for (const c of Object.values(byCategoryMap)) c.label = c.key;

    const byPropertyMap = sumBy(items, (m) => m.propertyId);
    for (const m of items) {
      if (m.propertyId && byPropertyMap[m.propertyId] && !byPropertyMap[m.propertyId].label) {
        byPropertyMap[m.propertyId].label = m.property?.name || m.propertyId;
      }
    }

    const byRoomMap = sumBy(items, (m) => m.roomId);
    for (const m of items) {
      if (m.roomId && byRoomMap[m.roomId] && !byRoomMap[m.roomId].label) {
        byRoomMap[m.roomId].label = `${m.property?.name || '?'} / ${m.room?.label || '?'}`;
      }
    }

    const byVendorMap = sumBy(items, (m) => m.assignedVendorId);
    for (const m of items) {
      if (m.assignedVendorId && byVendorMap[m.assignedVendorId] && !byVendorMap[m.assignedVendorId].label) {
        byVendorMap[m.assignedVendorId].label =
          m.assignedVendor?.company
            ? `${m.assignedVendor.name} (${m.assignedVendor.company})`
            : m.assignedVendor?.name || m.assignedVendorId;
      }
    }

    // Monthly cost trend
    const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const byMonth = {};
    for (const m of items) {
      const k = monthKey(new Date(m.createdAt));
      byMonth[k] = byMonth[k] || { key: k, total: 0, count: 0 };
      byMonth[k].total += m.actualCost || 0;
      byMonth[k].count += 1;
    }
    const trend = Object.values(byMonth).sort((a, b) => a.key.localeCompare(b.key));

    // Most common categories / rooms (by count)
    const commonCategories = Object.values(byCategoryMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const commonRooms = Object.values(byRoomMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return res.json({
      range: { start, end },
      totalTickets: items.length,
      statusTotals,
      avgResponseMs: avg(responseMs),
      avgResolutionMs: avg(resolutionMs),
      costByCategory: Object.values(byCategoryMap).sort((a, b) => b.total - a.total),
      costByProperty: Object.values(byPropertyMap).sort((a, b) => b.total - a.total),
      costByRoom: Object.values(byRoomMap).sort((a, b) => b.total - a.total),
      costByVendor: Object.values(byVendorMap).sort((a, b) => b.total - a.total),
      trend,
      commonCategories,
      commonRooms,
    });
  } catch (error) {
    console.error('Reports error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/reports/csv — downloadable spreadsheet ────

router.get('/csv', async (req, res) => {
  try {
    const { start, end } = parseRange(req.query);
    const { propertyId, flagCategory, assignedVendorId, priority } = req.query;
    const where = {
      organizationId: req.user.organizationId,
      deletedAt: null,
      createdAt: { gte: start, lte: end },
    };
    if (propertyId) where.propertyId = propertyId;
    if (flagCategory) where.flagCategory = flagCategory;
    if (assignedVendorId) where.assignedVendorId = assignedVendorId;
    if (priority) where.priority = priority;

    const items = await prisma.maintenanceItem.findMany({
      where,
      include: {
        property: { select: { name: true, address: true } },
        room: { select: { label: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const header = [
      'Created', 'Resolved', 'Property', 'Room', 'Category', 'Priority',
      'Status', 'Description', 'Assigned To', 'Vendor',
      'Estimated Cost', 'Actual Cost', 'Reported By', 'Reported Role',
    ];
    const q = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const rows = items.map((m) => [
      new Date(m.createdAt).toISOString(),
      m.resolvedAt ? new Date(m.resolvedAt).toISOString() : '',
      m.property?.name || '',
      m.room?.label || '',
      m.flagCategory || '',
      m.priority || '',
      m.status,
      m.description,
      m.assignedTo || '',
      m.vendor || '',
      m.estimatedCost ?? '',
      m.actualCost ?? '',
      m.reportedByName || '',
      m.reportedByRole || '',
    ].map(q).join(','));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="maintenance-report-${start.toISOString().slice(0, 10)}-${end.toISOString().slice(0, 10)}.csv"`);
    res.send([header.join(','), ...rows].join('\n'));
  } catch (error) {
    console.error('Reports CSV error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
