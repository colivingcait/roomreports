import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import prisma from '../lib/prisma.js';
import { uploadFile } from '../lib/storage.js';
import {
  notifyMany,
  pmAndOwnerIds,
  newTrackingToken,
  residentEmailShell,
  summaryList,
  esc,
} from '../lib/notifications.js';
import { sendEmail } from '../lib/email.js';
import { appOrigin } from '../lib/appUrl.js';

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
  const { residentName, roomId, items, residentEmail, residentNotifyOptIn } = body;

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

  const cleanEmail = residentEmail && String(residentEmail).trim().toLowerCase();
  const wantsCopy = !!(cleanEmail && residentNotifyOptIn !== false);

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
      residentEmail: cleanEmail || null,
      residentNotifyOptIn: wantsCopy,
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
    include: { items: true },
  });

  if (wantsCopy) {
    try {
      await sendResidentInspectionCopy({
        type,
        inspection,
        propertyName: property.name,
        roomLabel: room.label,
        toEmail: cleanEmail,
      });
    } catch (e) {
      console.error('resident inspection confirmation error:', e);
    }
  }

  return res.status(201).json({ inspectionId: inspection.id });
}

async function sendResidentInspectionCopy({ type, inspection, propertyName, roomLabel, toEmail }) {
  const isMoveIn = type === 'MOVE_IN_OUT';
  const subject = isMoveIn
    ? `Your move-in inspection for ${propertyName} has been submitted`
    : `Your self-check for ${propertyName} has been submitted`;

  const photoCount = await prisma.photo.count({
    where: { inspectionItem: { inspectionId: inspection.id } },
  });

  const flagged = inspection.items.filter((i) => i.flagCategory);
  const answers = inspection.items
    .filter((i) => !i.zone?.startsWith('_') && !(Array.isArray(i.options) && i.options.includes('_section')))
    .slice(0, 25);

  const answersList = answers.length
    ? `<p style="margin:16px 0 6px;font-weight:600;color:#4A4543;">Your checklist answers</p>
       <ul style="margin:0 0 12px;padding-left:20px;color:#4A4543;font-size:14px;line-height:1.6;">
         ${answers
           .map((a) => `<li>${esc(a.text)}: ${esc(a.status || '—')}${a.note ? ` — ${esc(a.note)}` : ''}</li>`)
           .join('')}
       </ul>`
    : '';

  const flagList = flagged.length
    ? `<p style="margin:16px 0 6px;font-weight:600;color:#4A4543;">Issues flagged</p>
       <ul style="margin:0 0 12px;padding-left:20px;color:#4A4543;font-size:14px;line-height:1.6;">
         ${flagged.map((f) => `<li>${esc(f.text)} — ${esc(f.flagCategory || 'General')}${f.note ? `: ${esc(f.note)}` : ''}</li>`).join('')}
       </ul>`
    : '';

  const bodyHtml = `
    <p style="margin:0 0 12px;">Thanks — your ${isMoveIn ? 'move-in inspection' : 'self-check'} for <strong>${esc(propertyName)}</strong> — ${esc(roomLabel)} has been submitted.</p>
    ${summaryList([
      ['Photos taken', photoCount],
      ['Checklist items', answers.length],
      ['Issues flagged', flagged.length],
    ])}
    ${answersList}
    ${flagList}
    <p style="margin:16px 0 0;color:#4A4543;">${isMoveIn
      ? 'Keep this email for your records.'
      : 'Your property manager has been notified of any reported issues.'}</p>
  `;

  const html = residentEmailShell({ title: subject, bodyHtml });
  await sendEmail({
    to: toEmail,
    subject,
    html,
    text: `${subject}\n\nThanks for submitting your inspection at ${propertyName} — ${roomLabel}.`,
  });
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
      reporterEmail,
      reporterNotifyOptIn,
      priority,
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

    const cleanEmail = reporterEmail && String(reporterEmail).trim().toLowerCase();
    const wantsUpdates = !!(cleanEmail && reporterNotifyOptIn !== false);
    const trackingToken = newTrackingToken();

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
          residentEmail: cleanEmail || null,
          residentNotifyOptIn: wantsUpdates,
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
          priority: priority || null,
          note: note || null,
          reportedByName: reporterName || 'Resident',
          reportedByRole: 'RESIDENT',
          reporterEmail: cleanEmail || null,
          reporterNotifyOptIn: wantsUpdates,
          trackingToken,
        },
      });
      return { maintenance };
    });

    const trackingUrl = `${appOrigin()}/track/${trackingToken}`;

    // Fire-and-forget: PM/Owner notification + resident confirmation.
    try {
      const pmIds = await pmAndOwnerIds(property.organization.id);
      await notifyMany({
        userIds: pmIds,
        organizationId: property.organization.id,
        type: 'MAINTENANCE_RESIDENT_REPORTED',
        title: `New resident report — ${property.name}`,
        message: `${reporterName || 'Resident'}: ${description.trim()}`,
        link: `/maintenance?open=${result.maintenance.id}`,
        email: {
          subject: `New resident report — ${property.name}`,
          ctaLabel: 'Open ticket',
          ctaHref: `${appOrigin()}/maintenance?open=${result.maintenance.id}`,
          bodyHtml: `
            <p style="margin:0 0 12px;">${esc(reporterName || 'A resident')} just submitted a maintenance report.</p>
            ${summaryList([
              ['Resident', reporterName || 'Resident'],
              ['Property', property.name],
              ['Room', property.rooms?.find((r) => r.id === roomId)?.label || '—'],
              ['Category', flagCategory || 'General'],
              ['Priority', priority || '—'],
              ['Description', description.trim()],
              ['Note', note || '—'],
            ])}
          `,
        },
      });
    } catch (e) {
      console.error('resident report PM notification error:', e);
    }

    if (wantsUpdates) {
      try {
        const html = residentEmailShell({
          title: 'We received your maintenance report',
          bodyHtml: `
            <p style="margin:0 0 12px;">Your report for <strong>${esc(description.trim())}</strong> at <strong>${esc(property.name)}</strong> has been submitted.</p>
            <p style="margin:0 0 12px;">Your property manager has been notified. You can check the status of your report at any time using the tracking link below.</p>
          `,
          ctaLabel: 'Track your report',
          ctaHref: trackingUrl,
          unsubscribeHref: `${trackingUrl}?unsubscribe=1`,
        });
        await sendEmail({
          to: cleanEmail,
          subject: 'We received your maintenance report',
          html,
          text: `Thanks — we received your report for "${description.trim()}" at ${property.name}. Track it at ${trackingUrl}`,
        });
      } catch (e) {
        console.error('resident confirmation email error:', e);
      }
    }

    return res.status(201).json({
      maintenanceItemId: result.maintenance.id,
      organizationId: property.organization.id,
      propertyId: property.id,
      trackingToken,
      trackingUrl,
    });
  } catch (error) {
    console.error('Public report error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/public/org/:slug/contact — phone for emergency popups ──

router.get('/org/:slug/contact', async (req, res) => {
  try {
    const org = await findOrganizationBySlug(req.params.slug);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    return res.json({ phone: org.phone || null });
  } catch (error) {
    console.error('Public org contact lookup error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/public/draft/:slug — create resident DRAFT (after Step 3) ──
//
// Creates a maintenance row with status=DRAFT capturing the resident's
// name, email, room, and property. The wizard then patches this row as
// the resident progresses through Steps 4–5 and either submits it or
// abandons/cancels.

router.post('/draft/:slug', async (req, res) => {
  try {
    const {
      propertyId,
      roomId,
      reporterName,
      reporterEmail,
      reporterNotifyOptIn,
      lastStepCompleted,
    } = req.body || {};

    if (!propertyId || !reporterName?.trim()) {
      return res.status(400).json({ error: 'propertyId and reporterName are required' });
    }

    const resolved = await resolveOrgAndProperty(req.params.slug, propertyId);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    const { property } = resolved;

    if (!checkRateLimit(roomId || property.id)) {
      return res.status(429).json({ error: 'Too many submissions today' });
    }

    const cleanEmail = reporterEmail && String(reporterEmail).trim().toLowerCase();
    const wantsUpdates = !!(cleanEmail && reporterNotifyOptIn !== false);
    const trackingToken = newTrackingToken();

    const maintenance = await prisma.maintenanceItem.create({
      data: {
        propertyId: property.id,
        roomId: roomId || null,
        organizationId: property.organization.id,
        description: '(draft)',
        zone: 'Reported Issue',
        flagCategory: 'General',
        status: 'DRAFT',
        reportedByName: reporterName.trim(),
        reportedByRole: 'RESIDENT',
        reporterEmail: cleanEmail || null,
        reporterNotifyOptIn: wantsUpdates,
        trackingToken,
        lastStepCompleted: Number.isFinite(+lastStepCompleted) ? +lastStepCompleted : 3,
      },
    });

    return res.status(201).json({
      draftId: maintenance.id,
      trackingToken,
    });
  } catch (error) {
    console.error('Public draft create error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/public/draft/:slug/:id — patch draft progress ──

router.put('/draft/:slug/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const draft = await prisma.maintenanceItem.findUnique({ where: { id } });
    if (!draft || draft.status !== 'DRAFT') {
      return res.status(404).json({ error: 'Draft not found' });
    }

    const {
      roomId,
      flagCategory,
      description,
      note,
      triageAnswers,
      lastStepCompleted,
    } = req.body || {};

    const data = {};
    if (roomId !== undefined) data.roomId = roomId || null;
    if (flagCategory) data.flagCategory = flagCategory;
    if (description !== undefined) data.description = description?.trim() || '(draft)';
    if (note !== undefined) data.note = note?.trim() || null;
    if (triageAnswers !== undefined) data.triageAnswers = triageAnswers;
    if (Number.isFinite(+lastStepCompleted)) data.lastStepCompleted = +lastStepCompleted;

    await prisma.maintenanceItem.update({ where: { id }, data });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Public draft update error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/public/draft/:slug/:id/cancel ──
//
// Resident hit the explicit "Cancel report" button. Stays as DRAFT but
// marks cancelledAt so PMs can see it's an intentional cancellation
// rather than an abandonment.

router.post('/draft/:slug/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const draft = await prisma.maintenanceItem.findUnique({ where: { id } });
    if (!draft || draft.status !== 'DRAFT') {
      return res.status(404).json({ error: 'Draft not found' });
    }
    await prisma.maintenanceItem.update({
      where: { id },
      data: { cancelledAt: new Date() },
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Public draft cancel error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/public/draft/:slug/:id/abandon ──
//
// Browser unload — best-effort marker. Called via navigator.sendBeacon
// when the resident closes the tab without submitting or cancelling.

router.post('/draft/:slug/:id/abandon', async (req, res) => {
  try {
    const { id } = req.params;
    const draft = await prisma.maintenanceItem.findUnique({ where: { id } });
    if (!draft || draft.status !== 'DRAFT') {
      return res.status(204).end();
    }
    await prisma.maintenanceItem.update({
      where: { id },
      data: { abandonedAt: new Date() },
    });
    return res.status(204).end();
  } catch (error) {
    console.error('Public draft abandon error:', error);
    return res.status(204).end();
  }
});

// ─── POST /api/public/draft/:slug/:id/submit ──
//
// Resident hit Submit. Promote DRAFT → OPEN, create linked inspection
// records, fire PM/owner notifications + resident confirmation email.

router.post('/draft/:slug/:id/submit', async (req, res) => {
  try {
    const { id } = req.params;
    const draft = await prisma.maintenanceItem.findUnique({
      where: { id },
      include: {
        property: { include: { organization: true, rooms: { where: { deletedAt: null } } } },
      },
    });
    if (!draft || draft.status !== 'DRAFT') {
      return res.status(404).json({ error: 'Draft not found' });
    }
    if (!draft.description || draft.description === '(draft)') {
      return res.status(400).json({ error: 'description is required' });
    }

    const org = draft.property.organization;
    const owner = await prisma.user.findFirst({
      where: { organizationId: org.id, role: 'OWNER', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) return res.status(500).json({ error: 'No owner found for this organization' });

    const now = new Date();
    const trackingUrl = `${appOrigin()}/track/${draft.trackingToken}`;

    await prisma.$transaction(async (tx) => {
      const inspection = await tx.inspection.create({
        data: {
          type: 'RESIDENT_SELF_CHECK',
          status: 'SUBMITTED',
          propertyId: draft.propertyId,
          roomId: draft.roomId,
          inspectorId: owner.id,
          inspectorName: draft.reportedByName || 'Resident',
          inspectorRole: 'RESIDENT',
          organizationId: org.id,
          completedAt: now,
          residentEmail: draft.reporterEmail,
          residentNotifyOptIn: draft.reporterNotifyOptIn,
        },
      });
      const item = await tx.inspectionItem.create({
        data: {
          inspectionId: inspection.id,
          zone: 'Reported Issue',
          text: draft.description,
          options: [],
          status: 'Fail',
          flagCategory: draft.flagCategory || 'General',
          note: draft.note,
          isMaintenance: true,
        },
      });
      await tx.maintenanceItem.update({
        where: { id: draft.id },
        data: {
          status: 'OPEN',
          submittedAt: now,
          inspectionId: inspection.id,
          inspectionItemId: item.id,
          lastStepCompleted: 5,
        },
      });
    });

    // Fire-and-forget: PM/Owner notification + resident confirmation.
    try {
      const pmIds = await pmAndOwnerIds(org.id);
      const roomLabel = draft.property.rooms?.find((r) => r.id === draft.roomId)?.label || '—';
      await notifyMany({
        userIds: pmIds,
        organizationId: org.id,
        type: 'MAINTENANCE_RESIDENT_REPORTED',
        title: `New resident report — ${draft.property.name}`,
        message: `${draft.reportedByName || 'Resident'}: ${draft.description}`,
        link: `/maintenance?open=${draft.id}`,
        email: {
          subject: `New resident report — ${draft.property.name}`,
          ctaLabel: 'Open ticket',
          ctaHref: `${appOrigin()}/maintenance?open=${draft.id}`,
          bodyHtml: `
            <p style="margin:0 0 12px;">${esc(draft.reportedByName || 'A resident')} just submitted a maintenance report.</p>
            ${summaryList([
              ['Resident', draft.reportedByName || 'Resident'],
              ['Property', draft.property.name],
              ['Room', roomLabel],
              ['Category', draft.flagCategory || 'General'],
              ['Description', draft.description],
              ['Note', draft.note || '—'],
            ])}
          `,
        },
      });
    } catch (e) {
      console.error('PM notification error:', e);
    }

    if (draft.reporterEmail && draft.reporterNotifyOptIn) {
      try {
        const html = residentEmailShell({
          headline: 'We got your report',
          bodyHtml: `
            <p style="margin:0 0 8px;">Thanks for submitting a maintenance report for <strong>${esc(draft.property.name)}</strong>.</p>
            <p style="margin:0 0 12px;">Your property manager has been notified. You can check the status of your report at any time using the tracking link below.</p>
          `,
          ctaLabel: 'Track your report',
          ctaHref: trackingUrl,
          unsubscribeHref: `${trackingUrl}?unsubscribe=1`,
        });
        await sendEmail({
          to: draft.reporterEmail,
          subject: 'We received your maintenance report',
          html,
          text: `Thanks — we received your report for "${draft.description}" at ${draft.property.name}. Track it at ${trackingUrl}`,
        });
      } catch (e) {
        console.error('resident confirmation email error:', e);
      }
    }

    return res.status(200).json({
      maintenanceItemId: draft.id,
      trackingToken: draft.trackingToken,
      trackingUrl,
    });
  } catch (error) {
    console.error('Public draft submit error:', error);
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
