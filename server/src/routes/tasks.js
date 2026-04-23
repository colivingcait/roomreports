import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { propertyIdScope } from '../lib/scope.js';
import { PRIORITIES } from '../../../shared/index.js';
import { notify, summaryList, esc } from '../lib/notifications.js';

const router = Router();
router.use(requireAuth);

const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'];

const TASK_INCLUDE = {
  assignedUser: { select: { id: true, name: true, role: true, customRole: true } },
  assignedVendor: { select: { id: true, name: true, company: true } },
  property: { select: { id: true, name: true } },
};

// Tasks don't have a direct Prisma relation to user/vendor/property (kept simple).
// We stitch the display fields in response. Include isn't supported here — so we
// manually fetch and hydrate.

async function hydrateTasks(tasks, orgId) {
  const userIds = [...new Set(tasks.map((t) => t.assignedUserId).filter(Boolean))];
  const vendorIds = [...new Set(tasks.map((t) => t.assignedVendorId).filter(Boolean))];
  const propIds = [...new Set(tasks.map((t) => t.propertyId).filter(Boolean))];

  const [users, vendors, properties] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds }, organizationId: orgId },
          select: { id: true, name: true, role: true, customRole: true },
        })
      : [],
    vendorIds.length
      ? prisma.vendor.findMany({
          where: { id: { in: vendorIds }, organizationId: orgId },
          select: { id: true, name: true, company: true },
        })
      : [],
    propIds.length
      ? prisma.property.findMany({
          where: { id: { in: propIds }, organizationId: orgId },
          select: { id: true, name: true },
        })
      : [],
  ]);
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v]));
  const propMap = Object.fromEntries(properties.map((p) => [p.id, p]));

  return tasks.map((t) => ({
    ...t,
    assignedUser: t.assignedUserId ? userMap[t.assignedUserId] || null : null,
    assignedVendor: t.assignedVendorId ? vendorMap[t.assignedVendorId] || null : null,
    property: t.propertyId ? propMap[t.propertyId] || null : null,
    isOverdue: t.status !== 'DONE' && t.dueAt && new Date(t.dueAt) < new Date(),
  }));
}

// ─── GET /api/tasks ─────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { status, priority, propertyId, assignedUserId, assignedVendorId, mine } = req.query;
    const scope = await propertyIdScope(req.user);

    const where = {
      organizationId: req.user.organizationId,
      deletedAt: null,
    };
    // Property scope should include NULL (org-wide tasks) for non-restricted users.
    if (scope.propertyId) {
      where.OR = [{ propertyId: null }, { propertyId: scope.propertyId }];
    }
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (propertyId) where.propertyId = propertyId;
    if (assignedUserId) where.assignedUserId = assignedUserId;
    if (assignedVendorId) where.assignedVendorId = assignedVendorId;
    if (mine === 'true') where.assignedUserId = req.user.id;

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
    });

    const hydrated = await hydrateTasks(tasks, req.user.organizationId);

    // Status counts (same scope)
    const counts = await prisma.task.groupBy({
      by: ['status'],
      where: {
        organizationId: req.user.organizationId,
        deletedAt: null,
        ...(scope.propertyId ? { OR: [{ propertyId: null }, { propertyId: scope.propertyId }] } : {}),
      },
      _count: true,
    });
    const statusCounts = { TODO: 0, IN_PROGRESS: 0, DONE: 0 };
    for (const c of counts) statusCounts[c.status] = c._count;

    return res.json({ tasks: hydrated, statusCounts });
  } catch (error) {
    console.error('List tasks error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/tasks ────────────────────────────────────

router.post('/', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const {
      title, description, propertyId, dueAt, priority,
      assignedUserId, assignedVendorId, assignedTo,
    } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    if (priority && !PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
    }

    // Resolve assignment to canonical FKs + display string
    let resolvedUserId = null, resolvedVendorId = null, resolvedDisplay = assignedTo?.trim() || null;
    if (assignedUserId) {
      const u = await prisma.user.findFirst({
        where: { id: assignedUserId, organizationId: req.user.organizationId },
        select: { id: true, name: true },
      });
      if (!u) return res.status(400).json({ error: 'assignedUserId not found' });
      resolvedUserId = u.id;
      resolvedDisplay = u.name;
    } else if (assignedVendorId) {
      const v = await prisma.vendor.findFirst({
        where: { id: assignedVendorId, organizationId: req.user.organizationId },
        select: { id: true, name: true, company: true },
      });
      if (!v) return res.status(400).json({ error: 'assignedVendorId not found' });
      resolvedVendorId = v.id;
      resolvedDisplay = v.company ? `${v.name} (${v.company})` : v.name;
    }

    if (propertyId) {
      const p = await prisma.property.findFirst({
        where: { id: propertyId, organizationId: req.user.organizationId, deletedAt: null },
      });
      if (!p) return res.status(400).json({ error: 'propertyId not found' });
    }

    const task = await prisma.task.create({
      data: {
        organizationId: req.user.organizationId,
        title: title.trim(),
        description: description?.trim() || null,
        propertyId: propertyId || null,
        dueAt: dueAt ? new Date(dueAt) : null,
        priority: priority || null,
        assignedUserId: resolvedUserId,
        assignedVendorId: resolvedVendorId,
        assignedTo: resolvedDisplay,
        createdById: req.user.id,
        createdByName: req.user.name,
      },
    });
    const [hydrated] = await hydrateTasks([task], req.user.organizationId);

    if (resolvedUserId) {
      try {
        await notifyTaskAssigned({ task: hydrated, actor: req.user });
      } catch (e) {
        console.error('task assign notification error:', e);
      }
    }

    return res.status(201).json({ task: hydrated });
  } catch (error) {
    console.error('Create task error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/tasks/:id ─────────────────────────────────

router.put('/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    const {
      title, description, propertyId, dueAt, priority, status,
      assignedUserId, assignedVendorId, assignedTo,
    } = req.body || {};

    const data = {};
    if (title !== undefined) data.title = title.trim();
    if (description !== undefined) data.description = description || null;
    if (propertyId !== undefined) data.propertyId = propertyId || null;
    if (dueAt !== undefined) data.dueAt = dueAt ? new Date(dueAt) : null;
    if (priority !== undefined) {
      if (priority !== null && !PRIORITIES.includes(priority)) {
        return res.status(400).json({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
      }
      data.priority = priority;
    }
    if (status !== undefined) {
      if (!TASK_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'invalid status' });
      }
      data.status = status;
      if (status === 'DONE' && existing.status !== 'DONE') data.completedAt = new Date();
      if (status !== 'DONE' && existing.status === 'DONE') data.completedAt = null;
    }

    // Assignment mutations (mirror maintenance logic)
    if (assignedUserId !== undefined) {
      if (assignedUserId) {
        const u = await prisma.user.findFirst({
          where: { id: assignedUserId, organizationId: req.user.organizationId },
          select: { id: true, name: true },
        });
        if (!u) return res.status(400).json({ error: 'assignedUserId not found' });
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
        if (!v) return res.status(400).json({ error: 'assignedVendorId not found' });
        data.assignedVendorId = v.id;
        data.assignedUserId = null;
        data.assignedTo = v.company ? `${v.name} (${v.company})` : v.name;
      } else {
        data.assignedVendorId = null;
      }
    }
    if (assignedTo !== undefined && assignedUserId === undefined && assignedVendorId === undefined) {
      data.assignedTo = assignedTo || null;
      data.assignedUserId = null;
      data.assignedVendorId = null;
    }

    const updated = await prisma.task.update({ where: { id: existing.id }, data });
    const [hydrated] = await hydrateTasks([updated], req.user.organizationId);
    return res.json({ task: hydrated });
  } catch (error) {
    console.error('Update task error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/tasks/:id ──────────────────────────────

router.delete('/:id', requireRole('OWNER', 'PM'), async (req, res) => {
  try {
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    await prisma.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete task error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

async function notifyTaskAssigned({ task, actor }) {
  if (!task.assignedUserId) return;
  const origin = (process.env.APP_URL || '').replace(/\/$/, '');
  await notify({
    userId: task.assignedUserId,
    organizationId: task.organizationId,
    type: 'TASK_ASSIGNED',
    title: `Task assigned — ${task.title}`,
    message: `${actor.name} assigned you "${task.title}"${task.priority ? ` (${task.priority})` : ''}.`,
    link: '/tasks',
    email: {
      subject: `Task assigned — ${task.title}`,
      ctaLabel: 'Open tasks',
      ctaHref: `${origin}/tasks`,
      bodyHtml: `
        <p style="margin:0 0 12px;">${esc(actor.name)} just assigned you a task.</p>
        ${summaryList([
          ['Task', task.title],
          ['Property', task.property?.name || '—'],
          ['Priority', task.priority || '—'],
          ['Due', task.dueAt ? new Date(task.dueAt).toLocaleDateString() : '—'],
          ['Description', task.description || '—'],
        ])}
      `,
    },
  });
}

export default router;
