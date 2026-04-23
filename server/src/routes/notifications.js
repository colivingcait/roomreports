import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import {
  NOTIFICATION_TYPES,
  typesForRole,
  defaultEmailFor,
} from '../../../shared/notifications.js';

const router = Router();
router.use(requireAuth);

function shape(n) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    link: n.link,
    read: n.read,
    createdAt: n.createdAt,
  };
}

// ─── GET /api/notifications — paged list + unread count ─

router.get('/', async (req, res) => {
  try {
    const take = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const cursor = req.query.cursor;
    const where = { userId: req.user.id };

    const items = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > take;
    const slice = hasMore ? items.slice(0, take) : items;

    const unread = await prisma.notification.count({
      where: { userId: req.user.id, read: false },
    });

    return res.json({
      notifications: slice.map(shape),
      nextCursor: hasMore ? slice[slice.length - 1].id : null,
      unread,
    });
  } catch (error) {
    console.error('List notifications error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/notifications/unread-count ────────────────
// Lightweight endpoint the bell can poll without dragging the list.

router.get('/unread-count', async (req, res) => {
  try {
    const unread = await prisma.notification.count({
      where: { userId: req.user.id, read: false },
    });
    return res.json({ unread });
  } catch (error) {
    console.error('Unread count error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/notifications/:id/read ──

router.post('/:id/read', async (req, res) => {
  try {
    const n = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!n) return res.status(404).json({ error: 'Notification not found' });
    if (!n.read) {
      await prisma.notification.update({
        where: { id: n.id },
        data: { read: true, readAt: new Date() },
      });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Read notification error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/notifications/mark-all-read ──

router.post('/mark-all-read', async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, read: false },
      data: { read: true, readAt: new Date() },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('Mark-all-read error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/notifications/preferences ─────────────────

router.get('/preferences', async (req, res) => {
  try {
    const types = typesForRole(req.user.role);
    const stored = await prisma.notificationPreference.findMany({
      where: { userId: req.user.id },
    });
    const storedMap = Object.fromEntries(stored.map((p) => [p.type, p.email]));
    const prefs = types.map((type) => ({
      type,
      email: storedMap[type] ?? defaultEmailFor(type),
      meta: {
        label: NOTIFICATION_TYPES[type].label,
        desc: NOTIFICATION_TYPES[type].desc,
        category: NOTIFICATION_TYPES[type].category,
        icon: NOTIFICATION_TYPES[type].icon,
      },
    }));
    return res.json({ preferences: prefs });
  } catch (error) {
    console.error('List prefs error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/notifications/preferences ─────────────────
// Accepts { preferences: [{ type, email }] }

router.put('/preferences', async (req, res) => {
  try {
    const { preferences } = req.body || {};
    if (!Array.isArray(preferences)) {
      return res.status(400).json({ error: 'preferences array required' });
    }

    const allowed = new Set(typesForRole(req.user.role));

    await prisma.$transaction(
      preferences
        .filter((p) => allowed.has(p.type))
        .map((p) =>
          prisma.notificationPreference.upsert({
            where: { userId_type: { userId: req.user.id, type: p.type } },
            update: { email: !!p.email },
            create: { userId: req.user.id, type: p.type, email: !!p.email },
          }),
        ),
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('Update prefs error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
