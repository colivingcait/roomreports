import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

function normalizeSlug(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// GET /api/organization — current org info
router.get('/', async (req, res) => {
  try {
    const org = await prisma.organization.findFirst({
      where: { id: req.user.organizationId, deletedAt: null },
    });
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const owner = await prisma.user.findFirst({
      where: { organizationId: org.id, role: 'OWNER', deletedAt: null },
      select: { id: true, name: true, email: true },
    });
    return res.json({ organization: org, owner });
  } catch (error) {
    console.error('Get organization error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/organization — update name / slug / timezone (OWNER only)
router.patch('/', requireRole('OWNER'), async (req, res) => {
  try {
    const { name, slug, timezone } = req.body || {};
    const data = {};
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'name cannot be empty' });
      data.name = String(name).trim();
    }
    if (slug !== undefined) {
      const clean = normalizeSlug(slug);
      if (!clean) return res.status(400).json({ error: 'slug must contain letters or numbers' });
      const existing = await prisma.organization.findFirst({
        where: { slug: clean, id: { not: req.user.organizationId }, deletedAt: null },
      });
      if (existing) return res.status(409).json({ error: 'slug is already taken' });
      data.slug = clean;
    }
    if (timezone !== undefined) data.timezone = timezone || null;

    const updated = await prisma.organization.update({
      where: { id: req.user.organizationId },
      data,
    });
    return res.json({ organization: updated });
  } catch (error) {
    console.error('Update organization error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/organization — soft-delete the org (OWNER only)
// Requires body.confirmSlug to match the current slug to prevent accidents.
router.delete('/', requireRole('OWNER'), async (req, res) => {
  try {
    const { confirmSlug } = req.body || {};
    const org = await prisma.organization.findFirst({
      where: { id: req.user.organizationId, deletedAt: null },
    });
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (!org.slug || confirmSlug !== org.slug) {
      return res.status(400).json({ error: 'confirmSlug must match the current organization slug' });
    }
    await prisma.organization.update({
      where: { id: org.id },
      data: { deletedAt: new Date() },
    });
    // Invalidate all sessions for users in this org so they can't keep poking
    await prisma.session.deleteMany({
      where: { user: { organizationId: org.id } },
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Delete organization error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
