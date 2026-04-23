// Lightweight in-process scheduler.
//
// Instead of pulling in node-cron we run the jobs with setInterval and
// a wall-clock check: every minute the runner asks "is it time to run
// the overdue job yet?" and if so fires it, recording the timestamp in
// memory so we don't re-run within the same day.
//
// For a bigger deployment we'd lift these to a real cron / worker, but
// for the beta runtime this keeps operations dead simple and survives
// process restarts well enough (an overdue batch that already went out
// today won't re-fire within an hour of restart).

import prisma from './prisma.js';
import { notify, notifyMany, pmAndOwnerIds, summaryList } from './notifications.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_THRESHOLD_DAYS = 7;
const MINUTE_MS = 60 * 1000;

let ranOverdueOnDay = null;   // 'YYYY-MM-DD' string
let ranDigestOnWeek = null;   // 'YYYY-WW' string
let ranDeferredOnDay = null;  // 'YYYY-MM-DD' string

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-${String(weekNo).padStart(2, '0')}`;
}

// ─── Overdue maintenance ────────────────────────────────

async function runOverdueJob() {
  const cutoff = new Date(Date.now() - OVERDUE_THRESHOLD_DAYS * DAY_MS);

  // Grab overdue tickets grouped by org. Only look at currently-open
  // items (OPEN / ASSIGNED / IN_PROGRESS) older than the threshold.
  const overdue = await prisma.maintenanceItem.findMany({
    where: {
      deletedAt: null,
      archivedAt: null,
      resolvedAt: null,
      status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
      createdAt: { lte: cutoff },
    },
    select: {
      id: true,
      organizationId: true,
      description: true,
      priority: true,
      createdAt: true,
      property: { select: { name: true } },
      room: { select: { label: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const byOrg = new Map();
  for (const item of overdue) {
    if (!byOrg.has(item.organizationId)) byOrg.set(item.organizationId, []);
    byOrg.get(item.organizationId).push(item);
  }

  for (const [orgId, items] of byOrg) {
    const ids = await pmAndOwnerIds(orgId);
    if (ids.length === 0) continue;

    const rowsHtml = items
      .slice(0, 20)
      .map((i) => {
        const days = Math.floor((Date.now() - new Date(i.createdAt)) / DAY_MS);
        const loc = [i.property?.name, i.room?.label].filter(Boolean).join(' · ');
        return `<tr>
          <td style="padding:6px 12px 6px 0;color:#4A4543;font-size:14px;">${esc(i.description)}</td>
          <td style="padding:6px 12px 6px 0;color:#8A8583;font-size:13px;">${esc(loc)}</td>
          <td style="padding:6px 0;color:#A02420;font-size:13px;white-space:nowrap;">${days}d open</td>
        </tr>`;
      })
      .join('');

    const extra = items.length > 20
      ? `<p style="margin:12px 0 0;color:#8A8583;font-size:13px;">+ ${items.length - 20} more not shown.</p>`
      : '';

    await notifyMany({
      userIds: ids,
      organizationId: orgId,
      type: 'MAINTENANCE_OVERDUE',
      title: `${items.length} overdue maintenance ticket${items.length === 1 ? '' : 's'}`,
      message: `You have ${items.length} ticket${items.length === 1 ? '' : 's'} still open after 7+ days.`,
      link: '/maintenance?status=OPEN',
      email: {
        subject: `${items.length} overdue maintenance ticket${items.length === 1 ? '' : 's'}`,
        ctaLabel: 'Open maintenance board',
        ctaHref: `${(process.env.APP_URL || '').replace(/\/$/, '')}/maintenance`,
        bodyHtml: `
          <p style="margin:0 0 12px;">These tickets have been open for more than ${OVERDUE_THRESHOLD_DAYS} days:</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rowsHtml}</table>
          ${extra}
        `,
      },
    });

    await prisma.maintenanceItem.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { lastOverdueNotifiedAt: new Date() },
    });
  }
}

// ─── Weekly digest ──────────────────────────────────────

async function runWeeklyDigest() {
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const orgs = await prisma.organization.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });

  for (const org of orgs) {
    const ids = await pmAndOwnerIds(org.id);
    if (ids.length === 0) continue;

    // Filter by each user's preference — weekly digest defaults OFF so
    // only explicitly-opted-in users get it.
    const optedIn = [];
    for (const userId of ids) {
      const pref = await prisma.notificationPreference.findUnique({
        where: { userId_type: { userId, type: 'WEEKLY_DIGEST' } },
      });
      if (pref?.email) optedIn.push(userId);
    }
    if (optedIn.length === 0) continue;

    const [inspectionsCount, maintOpened, maintResolved, violationsCount, costAgg] = await Promise.all([
      prisma.inspection.count({
        where: { organizationId: org.id, deletedAt: null, completedAt: { gte: weekAgo } },
      }),
      prisma.maintenanceItem.count({
        where: { organizationId: org.id, deletedAt: null, createdAt: { gte: weekAgo } },
      }),
      prisma.maintenanceItem.count({
        where: { organizationId: org.id, deletedAt: null, resolvedAt: { gte: weekAgo } },
      }),
      prisma.leaseViolation.count({
        where: { organizationId: org.id, deletedAt: null, createdAt: { gte: weekAgo } },
      }),
      prisma.maintenanceItem.aggregate({
        where: {
          organizationId: org.id,
          deletedAt: null,
          OR: [
            { createdAt: { gte: weekAgo } },
            { resolvedAt: { gte: weekAgo } },
          ],
        },
        _sum: { actualCost: true, estimatedCost: true },
      }),
    ]);

    const totalCost = (costAgg._sum.actualCost || 0) + (costAgg._sum.estimatedCost || 0);

    const bodyHtml = `
      <p style="margin:0 0 12px;">Here's what happened at ${esc(org.name)} this week:</p>
      ${summaryList([
        ['Inspections completed', inspectionsCount],
        ['Maintenance opened', maintOpened],
        ['Maintenance resolved', maintResolved],
        ['Violations logged', violationsCount],
        ['Total cost (approx)', totalCost ? `$${totalCost.toFixed(2)}` : '—'],
      ])}
    `;

    for (const userId of optedIn) {
      await notify({
        userId,
        organizationId: org.id,
        type: 'WEEKLY_DIGEST',
        title: `Weekly summary — ${org.name}`,
        message: `${inspectionsCount} inspections · ${maintOpened} new tickets · ${maintResolved} resolved`,
        link: '/dashboard',
        email: {
          subject: `Weekly summary — ${org.name}`,
          ctaLabel: 'Open dashboard',
          ctaHref: `${(process.env.APP_URL || '').replace(/\/$/, '')}/dashboard`,
          bodyHtml,
        },
      });
    }
  }
}

// ─── Date-deferred reactivation ─────────────────────────
// Any DEFERRED ticket whose deferUntil is today or earlier gets flipped
// back to OPEN at the start of the next day. We notify PMs/Owners per
// ticket ("X for Y has been reactivated from deferred status.").

async function runDeferredReactivateJob() {
  const now = new Date();
  const due = await prisma.maintenanceItem.findMany({
    where: {
      status: 'DEFERRED',
      deferType: 'DATE',
      deferUntil: { lte: now },
      deletedAt: null,
    },
    include: {
      property: { select: { name: true } },
      room: { select: { label: true } },
    },
  });
  if (due.length === 0) return;

  // Flip them all to OPEN in one shot.
  const reactivateNote = `Reactivated from deferred — date ${now.toISOString().slice(0, 10)}`;
  await prisma.maintenanceItem.updateMany({
    where: { id: { in: due.map((d) => d.id) } },
    data: {
      status: 'OPEN',
      reactivatedAt: now,
      reactivatedReason: reactivateNote,
    },
  });
  await prisma.maintenanceEvent.createMany({
    data: due.map((d) => ({
      maintenanceItemId: d.id,
      type: 'reactivated',
      fromValue: 'DEFERRED',
      toValue: 'OPEN',
      note: reactivateNote,
    })),
  });

  // Group by org → one batch of notifications per org.
  const byOrg = new Map();
  for (const item of due) {
    if (!byOrg.has(item.organizationId)) byOrg.set(item.organizationId, []);
    byOrg.get(item.organizationId).push(item);
  }

  const origin = (process.env.APP_URL || '').replace(/\/$/, '');
  for (const [orgId, items] of byOrg) {
    const ids = await pmAndOwnerIds(orgId);
    if (ids.length === 0) continue;
    for (const item of items) {
      const loc = [item.property?.name, item.room?.label].filter(Boolean).join(' · ');
      await notifyMany({
        userIds: ids,
        organizationId: orgId,
        type: 'MAINTENANCE_STATUS_CHANGED',
        title: `Reactivated from deferred — ${item.description.slice(0, 60)}`,
        message: `${item.description} for ${loc} has been reactivated from deferred status.`,
        link: `/maintenance?open=${item.id}`,
        email: {
          subject: `Reactivated from deferred — ${item.description.slice(0, 60)}`,
          ctaLabel: 'Open ticket',
          ctaHref: `${origin}/maintenance?open=${item.id}`,
          bodyHtml: `<p style="margin:0 0 12px;"><strong>${esc(item.description)}</strong> for <strong>${esc(loc)}</strong> has been reactivated from deferred status.</p>`,
        },
      });
    }
  }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Runner ─────────────────────────────────────────────

async function tick() {
  const now = new Date();
  const hour = now.getUTCHours();

  // Overdue: once per day, after 13:00 UTC (~8am ET). Guard via ranOverdueOnDay.
  const dk = todayKey(now);
  if (hour >= 13 && ranOverdueOnDay !== dk) {
    ranOverdueOnDay = dk;
    try { await runOverdueJob(); } catch (e) { console.error('overdue job error:', e); }
  }

  // Date-deferred tickets: early every UTC day (but after midnight). We
  // check at 01:00 UTC so tickets whose deferUntil is "today" come back
  // on-time. Guard via ranDeferredOnDay.
  if (hour >= 1 && ranDeferredOnDay !== dk) {
    ranDeferredOnDay = dk;
    try { await runDeferredReactivateJob(); } catch (e) { console.error('deferred reactivate error:', e); }
  }

  // Weekly digest: Monday mornings after 13:00 UTC.
  if (now.getUTCDay() === 1 && hour >= 13) {
    const wk = weekKey(now);
    if (ranDigestOnWeek !== wk) {
      ranDigestOnWeek = wk;
      try { await runWeeklyDigest(); } catch (e) { console.error('weekly digest error:', e); }
    }
  }
}

export function startScheduledJobs() {
  // Tick immediately so tests can see the jobs queue without waiting.
  setTimeout(() => tick().catch(() => {}), 5_000);
  setInterval(() => tick().catch(() => {}), MINUTE_MS);
}

// Exported for tests / manual triggering.
export const _internal = { runOverdueJob, runWeeklyDigest, runDeferredReactivateJob };
