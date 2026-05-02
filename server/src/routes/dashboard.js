import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { propertyIdScope } from '../lib/scope.js';

const router = Router();
router.use(requireAuth);

// GET /api/dashboard — operational command center data
router.get('/', async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const scope = await propertyIdScope(req.user);

    // ─── Pending Review ─── Inspections with status SUBMITTED
    // Quarterly inspections are grouped per property+date as one entry
    const pendingInspections = await prisma.inspection.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: 'SUBMITTED',
        ...scope,
      },
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
        inspector: { select: { id: true, name: true, role: true, customRole: true } },
        items: {
          where: { flagCategory: { not: null } },
          select: { id: true, isMaintenance: true },
        },
      },
      orderBy: { completedAt: 'desc' },
    });

    const pendingReview = [];
    const quarterlyGroups = {};

    for (const i of pendingInspections) {
      if (i.type === 'QUARTERLY') {
        const dateKey = new Date(i.createdAt).toISOString().slice(0, 10);
        const groupKey = `${i.property?.id}-${dateKey}`;
        if (!quarterlyGroups[groupKey]) {
          quarterlyGroups[groupKey] = {
            id: `qgroup:${i.property?.id}:${dateKey}`,
            isGroup: true,
            type: 'QUARTERLY',
            propertyId: i.property?.id,
            propertyName: i.property?.name,
            roomId: null,
            roomLabel: null,
            dateKey,
            inspectorName: i.inspector?.name,
            inspectorRole: i.inspector?.role,
            completedAt: i.completedAt,
            createdAt: i.createdAt,
            flagCount: 0,
            maintenanceCount: 0,
            roomCount: 0,
          };
          pendingReview.push(quarterlyGroups[groupKey]);
        }
        quarterlyGroups[groupKey].roomCount += 1;
        quarterlyGroups[groupKey].flagCount += i.items.length;
        quarterlyGroups[groupKey].maintenanceCount += i.items.filter((it) => it.isMaintenance).length;
      } else {
        pendingReview.push({
          id: i.id,
          type: i.type,
          propertyId: i.property?.id,
          propertyName: i.property?.name,
          roomId: i.room?.id || null,
          roomLabel: i.room?.label || null,
          inspectorName: i.inspector?.name,
          inspectorRole: i.inspector?.role,
          completedAt: i.completedAt,
          createdAt: i.createdAt,
          flagCount: i.items.length,
          maintenanceCount: i.items.filter((it) => it.isMaintenance).length,
        });
      }
    }

    // ─── Maintenance Overview ─── Stats + recent items
    // Deferred tickets are intentionally excluded from dashboard counts
    // and property health — they shouldn't push the open maintenance
    // metric up while they're parked off the board. Children of merged
    // tickets are also excluded so a merged group of 4 reads as 1.
    const maintenanceCounts = await prisma.maintenanceItem.groupBy({
      by: ['status'],
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { not: 'DEFERRED' },
        parentTicketId: null,
        ...scope,
      },
      _count: true,
    });

    // Open task count for combined total — orgwide tasks live with propertyId=null
    const taskOpenCount = await prisma.task.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { not: 'DONE' },
        ...(scope.propertyId
          ? { OR: [{ propertyId: null }, { propertyId: scope.propertyId }] }
          : {}),
      },
    });

    const statusCounts = { OPEN: 0, ASSIGNED: 0, IN_PROGRESS: 0, RESOLVED: 0 };
    for (const c of maintenanceCounts) {
      statusCounts[c.status] = c._count;
    }

    // Recent/urgent open maintenance items (top 5)
    const openMaintenance = await prisma.maintenanceItem.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
        ...scope,
      },
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const priorityOrder = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
    const sorted = openMaintenance.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 4;
      const pb = priorityOrder[b.priority] ?? 4;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    const recentMaintenance = sorted.slice(0, 5).map((m) => ({
      id: m.id,
      description: m.description,
      zone: m.zone,
      status: m.status,
      priority: m.priority,
      flagCategory: m.flagCategory,
      propertyName: m.property?.name,
      roomLabel: m.room?.label || null,
      createdAt: m.createdAt,
    }));

    // ─── Property Health ─── Per-property open maintenance
    const properties = await prisma.property.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...(scope.propertyId ? { id: scope.propertyId } : {}),
      },
      include: {
        maintenanceItems: {
          where: {
            deletedAt: null,
            status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
            parentTicketId: null,
          },
          select: { id: true, priority: true, flagCategory: true },
        },
        inspections: {
          where: { deletedAt: null },
          select: { id: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });

    const propertyHealth = properties.map((p) => {
      const openCount = p.maintenanceItems.length;

      // Health: Green (0-2), Yellow (3-5), Red (6+)
      let health = 'green';
      if (openCount >= 6) health = 'red';
      else if (openCount >= 3) health = 'yellow';

      return {
        id: p.id,
        name: p.name,
        openMaintenanceCount: openCount,
        lastInspectionDate: p.inspections[0]?.createdAt || null,
        health,
      };
    });

    // ─── Needs Attention ─── Overdue rooms (quarterly 90+ days or never)
    const allProperties = await prisma.property.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...(scope.propertyId ? { id: scope.propertyId } : {}),
      },
      include: {
        rooms: {
          where: { deletedAt: null },
          select: { id: true, label: true },
        },
      },
    });

    const overdueRooms = [];
    for (const prop of allProperties) {
      for (const room of prop.rooms) {
        const lastQuarterly = await prisma.inspection.findFirst({
          where: {
            roomId: room.id,
            type: 'QUARTERLY',
            organizationId: orgId,
            deletedAt: null,
            status: { in: ['SUBMITTED', 'REVIEWED'] },
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        const daysSince = lastQuarterly
          ? Math.floor((Date.now() - new Date(lastQuarterly.createdAt)) / (1000 * 60 * 60 * 24))
          : null;
        if (daysSince === null || daysSince >= 90) {
          overdueRooms.push({
            propertyId: prop.id,
            propertyName: prop.name,
            roomId: room.id,
            roomLabel: room.label,
            daysSince,
          });
        }
      }
    }

    // ─── Recent Inspection Activity ─── Latest 8 SUBMITTED + REVIEWED
    // (Grouped the same way as the /inspections list so QUARTERLY shows as one entry per batch)
    const recentInspectionsRaw = await prisma.inspection.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { in: ['SUBMITTED', 'REVIEWED'] },
        ...scope,
      },
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, label: true } },
      },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      take: 40,
    });

    const activityByKey = {};
    const recentActivity = [];
    for (const i of recentInspectionsRaw) {
      if (i.type === 'QUARTERLY') {
        const dateKey = new Date(i.createdAt).toISOString().slice(0, 10);
        const key = `qgroup:${i.property?.id}:${dateKey}:${i.status}`;
        if (!activityByKey[key]) {
          activityByKey[key] = {
            id: key,
            isGroup: true,
            type: 'QUARTERLY',
            status: i.status,
            propertyId: i.property?.id,
            propertyName: i.property?.name,
            dateKey,
            completedAt: i.completedAt,
            createdAt: i.createdAt,
            roomCount: 0,
          };
          recentActivity.push(activityByKey[key]);
        }
        activityByKey[key].roomCount += 1;
      } else {
        recentActivity.push({
          id: i.id,
          isGroup: false,
          type: i.type,
          status: i.status,
          propertyId: i.property?.id,
          propertyName: i.property?.name,
          roomLabel: i.room?.label || null,
          completedAt: i.completedAt,
          createdAt: i.createdAt,
        });
      }
    }
    const recentInspectionActivity = recentActivity.slice(0, 8);

    // ─── New dashboard widgets (action items / activity / insights) ──

    const DAY_MS = 86400000;
    const now = Date.now();

    // All active tickets — needed for several action item rules.
    const allActiveTickets = await prisma.maintenanceItem.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
        parentTicketId: null,
        ...scope,
      },
      select: {
        id: true,
        createdAt: true,
        assignedUserId: true,
        assignedTo: true,
        assignedVendorId: true,
        deferUntil: true,
        deferredAt: true,
        dueAt: true,
        isLeaseFollowUp: true,
        propertyId: true,
        property: { select: { name: true } },
      },
    });

    // Active violations per property (for propertiesAtAGlance + insights).
    const activeViolations = await prisma.leaseViolation.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        archivedAt: null,
        resolvedAt: null,
        ...(scope.propertyId ? { propertyId: scope.propertyId } : {}),
      },
      select: {
        id: true,
        propertyId: true,
        roomId: true,
        createdAt: true,
        category: true,
      },
    });
    // Resolve room labels for the rooms referenced by active violations.
    const violationRoomIds = [...new Set(activeViolations.map((v) => v.roomId).filter(Boolean))];
    const violationRoomMap = {};
    if (violationRoomIds.length > 0) {
      const rrRooms = await prisma.room.findMany({
        where: { id: { in: violationRoomIds } },
        select: { id: true, label: true },
      });
      for (const r of rrRooms) violationRoomMap[r.id] = r.label;
    }
    const violationCountByProp = {};
    for (const v of activeViolations) {
      violationCountByProp[v.propertyId] = (violationCountByProp[v.propertyId] || 0) + 1;
    }

    // ── Action items ──
    const actionItems = [];

    if (pendingReview.length > 0) {
      const propsTouched = [...new Set(pendingReview.map((p) => p.propertyName).filter(Boolean))];
      actionItems.push({
        kind: 'pending_review',
        severity: 'red',
        message: `${pendingReview.length} inspection${pendingReview.length === 1 ? '' : 's'} pending review`,
        context: propsTouched.slice(0, 2).join(', ') + (propsTouched.length > 2 ? ` +${propsTouched.length - 2} more` : ''),
        link: '/inspections',
        linkLabel: 'Review',
      });
    }

    const stale = allActiveTickets
      .filter((t) => !t.deferUntil)
      .filter((t) => (now - new Date(t.createdAt).getTime()) > 7 * DAY_MS);
    if (stale.length > 0) {
      const oldest = stale.reduce((a, b) => (new Date(a.createdAt) < new Date(b.createdAt) ? a : b));
      const ageDays = Math.floor((now - new Date(oldest.createdAt).getTime()) / DAY_MS);
      // Severity tiers per spec: red only when something is genuinely
      // urgent (14+ days old). 7-14 days is orange. Below 7 days won't
      // hit this rule at all.
      const severity = ageDays >= 14 ? 'red' : 'orange';
      actionItems.push({
        kind: 'stale_tickets',
        severity,
        message: `${stale.length} maintenance ticket${stale.length === 1 ? '' : 's'} open over 7 days`,
        context: `Oldest ${ageDays}d old at ${oldest.property?.name || 'property'}`,
        link: '/maintenance',
        linkLabel: 'View',
      });
    }

    // Properties overdue for room (>30d) and common-area (>14d) inspections.
    const lastInspByPropType = {};
    const lastInsps = await prisma.inspection.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { in: ['SUBMITTED', 'REVIEWED'] },
        type: { in: ['QUARTERLY', 'COMMON_AREA'] },
        ...(scope.propertyId ? { propertyId: scope.propertyId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { propertyId: true, type: true, createdAt: true },
    });
    for (const i of lastInsps) {
      const k = `${i.propertyId}|${i.type}`;
      if (!lastInspByPropType[k]) lastInspByPropType[k] = i.createdAt;
    }
    const propsOverdueRoom = [];
    const propsOverdueCommon = [];
    for (const p of allProperties) {
      const lastQ = lastInspByPropType[`${p.id}|QUARTERLY`];
      const lastC = lastInspByPropType[`${p.id}|COMMON_AREA`];
      const qDays = lastQ ? Math.floor((now - new Date(lastQ).getTime()) / DAY_MS) : null;
      const cDays = lastC ? Math.floor((now - new Date(lastC).getTime()) / DAY_MS) : null;
      if (qDays === null || qDays > 30) propsOverdueRoom.push({ name: p.name, days: qDays });
      if (cDays === null || cDays > 14) propsOverdueCommon.push({ name: p.name, days: cDays });
    }
    if (propsOverdueRoom.length > 0) {
      const first = propsOverdueRoom[0];
      // Red only when the worst overdue is 45+ days. 30-45d is orange.
      const worst = propsOverdueRoom.reduce(
        (m, p) => (p.days != null && p.days > (m ?? 0) ? p.days : m),
        first.days,
      );
      const severity = (worst != null && worst >= 45) ? 'red' : 'orange';
      actionItems.push({
        kind: 'overdue_room_inspection',
        severity,
        message: `${propsOverdueRoom.length} ${propsOverdueRoom.length === 1 ? 'property' : 'properties'} overdue for room inspection`,
        context: `${first.name}${first.days != null ? ` — ${first.days}d ago` : ' — never inspected'}${propsOverdueRoom.length > 1 ? ` +${propsOverdueRoom.length - 1} more` : ''}`,
        link: '/inspections',
        linkLabel: 'Start',
      });
    }
    if (propsOverdueCommon.length > 0) {
      const first = propsOverdueCommon[0];
      actionItems.push({
        kind: 'overdue_common_inspection',
        severity: 'amber',
        message: `${propsOverdueCommon.length} ${propsOverdueCommon.length === 1 ? 'property' : 'properties'} overdue for common area inspection`,
        context: `${first.name}${first.days != null ? ` — ${first.days}d ago` : ' — never inspected'}${propsOverdueCommon.length > 1 ? ` +${propsOverdueCommon.length - 1} more` : ''}`,
        link: '/inspections',
        linkLabel: 'Start',
      });
    }

    const followUpsDueSoon = allActiveTickets.filter((t) =>
      t.isLeaseFollowUp && t.dueAt && (new Date(t.dueAt).getTime() - now) <= 2 * DAY_MS && (new Date(t.dueAt).getTime() - now) > -DAY_MS,
    );
    if (followUpsDueSoon.length > 0) {
      actionItems.push({
        kind: 'lease_followup_due',
        severity: 'amber',
        message: `${followUpsDueSoon.length} lease follow-up${followUpsDueSoon.length === 1 ? '' : 's'} due within 48 hours`,
        context: `${followUpsDueSoon[0].property?.name || ''}`,
        link: '/maintenance',
        linkLabel: 'View',
      });
    }

    const deferredReactivating = allActiveTickets.filter((t) =>
      t.deferUntil && (new Date(t.deferUntil).getTime() - now) <= 7 * DAY_MS && (new Date(t.deferUntil).getTime() - now) > 0,
    );
    if (deferredReactivating.length > 0) {
      const propsTouched = [...new Set(deferredReactivating.map((t) => t.property?.name).filter(Boolean))];
      actionItems.push({
        kind: 'deferred_reactivating',
        severity: 'amber',
        message: `${deferredReactivating.length} deferred maintenance ticket${deferredReactivating.length === 1 ? '' : 's'} reactivating within 7 days`,
        context: propsTouched.slice(0, 2).join(', '),
        link: '/maintenance',
        linkLabel: 'View',
      });
    }

    // Financial upload reminder: shown for the first 5 days of each
    // calendar month if the most recent uploaded month isn't the
    // previous calendar month (i.e. the host is overdue on uploads).
    const today = new Date();
    if (today.getUTCDate() <= 5) {
      const prev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const prevKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
      const latestUpload = await prisma.financialUpload.findFirst({
        where: { organizationId: orgId },
        orderBy: { earningsMonth: 'desc' },
        select: { earningsMonth: true },
      });
      if (!latestUpload || latestUpload.earningsMonth < prevKey) {
        actionItems.push({
          kind: 'upload_reminder',
          severity: 'amber',
          message: "Upload this month's PadSplit financial statements",
          context: 'Keep your dashboard metrics current',
          link: '/financials',
          linkLabel: 'Upload',
        });
      }
    }

    // Average maintenance resolution time across the last 90 days
    // (parents only, excluding child tickets). Used by the pulse card.
    const ninetyDaysAgo = new Date(now - 90 * DAY_MS);
    const recentlyResolved = await prisma.maintenanceItem.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        parentTicketId: null,
        resolvedAt: { not: null, gte: ninetyDaysAgo },
        ...scope,
      },
      select: { createdAt: true, resolvedAt: true },
    });
    let avgResolutionDays = null;
    if (recentlyResolved.length > 0) {
      const total = recentlyResolved.reduce(
        (a, m) => a + (new Date(m.resolvedAt) - new Date(m.createdAt)) / DAY_MS,
        0,
      );
      avgResolutionDays = total / recentlyResolved.length;
    }

    // Sort by severity (red → orange → amber).
    const sevOrder = { red: 0, orange: 1, amber: 2 };
    actionItems.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

    // ── Properties at a glance ──
    // Days-since-last-inspection lookup so we can call out overdue
    // inspections in the at-a-glance summary.
    const lastQuarterlyByProp = {};
    for (const i of lastInsps) {
      if (i.type !== 'QUARTERLY') continue;
      if (!lastQuarterlyByProp[i.propertyId]) lastQuarterlyByProp[i.propertyId] = i.createdAt;
    }
    // Pick the single most-pressing thing about each property so the
    // glance row reads like a one-liner instead of duplicating the
    // metric cards above.
    const propertiesAtAGlance = propertyHealth.map((ph) => {
      const violations = violationCountByProp[ph.id] || 0;
      const open = ph.openMaintenanceCount || 0;
      const lastQ = lastQuarterlyByProp[ph.id];
      const daysSinceQ = lastQ
        ? Math.floor((now - new Date(lastQ).getTime()) / DAY_MS)
        : null;
      // Red is reserved for the truly bad combination: many open tickets
      // AND active violations AND an overdue inspection. Most properties
      // land on green or amber on any given day.
      const overdueInspection = daysSinceQ != null && daysSinceQ > 45;
      const isSevere = open >= 4 && violations >= 1 && overdueInspection;
      let dot = 'green';
      let summary = 'All clear';
      if (isSevere) {
        dot = 'red';
        summary = `Needs attention — ${open} open, ${violations} viol, ${daysSinceQ}d since inspection`;
      } else if (overdueInspection) {
        dot = 'amber';
        summary = `Inspection overdue ${daysSinceQ} days`;
      } else if (violations > 0) {
        dot = 'amber';
        summary = `${violations} active violation${violations === 1 ? '' : 's'}`;
      } else if (open > 0) {
        dot = 'amber';
        summary = `${open} open ticket${open === 1 ? '' : 's'}`;
      } else if (daysSinceQ != null && daysSinceQ > 30) {
        dot = 'amber';
        summary = `Inspection due (${daysSinceQ} days ago)`;
      } else if (daysSinceQ == null) {
        dot = 'amber';
        summary = 'Never inspected';
      }
      return {
        id: ph.id,
        name: ph.name,
        openMaintenanceCount: open,
        violationCount: violations,
        dot,
        summary,
      };
    }).sort((a, b) => {
      const ord = { red: 0, amber: 1, green: 2 };
      return ord[a.dot] - ord[b.dot];
    });

    // ── Recent activity (latest 5 across properties) ──
    const recentEvents = [];
    for (const a of recentInspectionActivity.slice(0, 8)) {
      recentEvents.push({
        kind: 'inspection_submitted',
        dot: 'sage',
        description: `${a.isGroup ? 'Quarterly' : (a.type || '').toLowerCase().replace('_', ' ')} inspection ${a.status === 'REVIEWED' ? 'reviewed' : 'submitted'} at ${a.propertyName || 'property'}`,
        at: a.completedAt || a.createdAt,
        link: a.isGroup
          ? `/quarterly-review/${a.propertyId}/${a.dateKey}`
          : `/inspections/${a.id}/review`,
      });
    }
    // Widen the resolve / create lookbacks so a relatively quiet system
    // still has something in Recent activity. The list is later trimmed
    // to the most recent 5.
    const recentResolved = await prisma.maintenanceItem.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        resolvedAt: { not: null },
        ...scope,
      },
      orderBy: { resolvedAt: 'desc' },
      take: 5,
      include: { property: { select: { name: true } } },
    });
    for (const m of recentResolved) {
      recentEvents.push({
        kind: 'ticket_resolved',
        dot: 'sage',
        description: `Ticket resolved at ${m.property?.name || 'property'}: ${m.description}`,
        at: m.resolvedAt,
        link: '/maintenance',
      });
    }
    // Ticket creation isn't a meaningful "event" for the activity feed
    // — it shows up in Action items / the maintenance board already.
    // Surface tickets only via resolved + violations + inspections.
    const recentViolations = activeViolations
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);
    for (const v of recentViolations) {
      recentEvents.push({
        kind: 'violation_logged',
        dot: 'terra',
        description: `Violation logged at ${violationRoomMap[v.roomId] || 'property'}: ${v.category || 'Lease'}`,
        at: v.createdAt,
        link: '/violations',
      });
    }
    recentEvents.sort((a, b) => new Date(b.at) - new Date(a.at));
    const recentActivityFeed = recentEvents.slice(0, 5);

    // ── Portfolio insights (warnings + at least one positive) ──
    const warnings = [];
    const positives = [];

    // Only flag the truly bad: tickets open 14+ days. Below that lives
    // in Action items where it belongs.
    const reallyStale = stale.filter(
      (t) => (now - new Date(t.createdAt).getTime()) > 14 * DAY_MS,
    );
    if (reallyStale.length > 0) {
      warnings.push({
        kind: 'warning',
        headline: `${reallyStale.length} ticket${reallyStale.length === 1 ? '' : 's'} open over 2 weeks`,
        detail: 'Aging tickets correlate with resident dissatisfaction. Assign or escalate.',
        link: '/maintenance',
      });
    }
    const reallyOverdue = propsOverdueRoom.filter((p) => p.days != null && p.days >= 45);
    if (reallyOverdue.length > 0) {
      warnings.push({
        kind: 'warning',
        headline: `${reallyOverdue.length} ${reallyOverdue.length === 1 ? 'property' : 'properties'} 45+ days overdue for inspection`,
        detail: `Starting with ${reallyOverdue[0].name}. Catching issues early prevents expensive repairs.`,
        link: '/inspections',
      });
    }

    // Positives — surface what's working so the dashboard doesn't feel
    // like only bad news.
    if (recentResolved.length >= 3) {
      const last30Resolved = recentResolved.filter(
        (m) => (now - new Date(m.resolvedAt).getTime()) <= 30 * DAY_MS,
      ).length;
      if (last30Resolved >= 3) {
        positives.push({
          kind: 'opportunity',
          headline: `${last30Resolved} maintenance ticket${last30Resolved === 1 ? '' : 's'} resolved this month`,
          detail: 'Keep the streak going — quick resolutions correlate with longer tenure.',
          link: '/maintenance',
        });
      }
    }
    if (avgResolutionDays != null && avgResolutionDays <= 3) {
      positives.push({
        kind: 'opportunity',
        headline: `Avg resolution time is just ${avgResolutionDays.toFixed(1)} days`,
        detail: 'You\'re responding fast. Industry benchmark for coliving is 5-7 days.',
        link: '/maintenance',
      });
    }
    const greenProps = propertiesAtAGlance.filter((p) => p.dot === 'green').length;
    if (greenProps > 0 && propertiesAtAGlance.length > 0) {
      const pct = Math.round((greenProps / propertiesAtAGlance.length) * 100);
      if (pct >= 50) {
        positives.push({
          kind: 'opportunity',
          headline: `${pct}% of properties are all clear`,
          detail: `${greenProps} of ${propertiesAtAGlance.length} properties have no open tickets, no violations, and inspections on schedule.`,
          link: '/properties',
        });
      }
    }

    // Always show at least one positive if any exist; cap warnings at 2.
    const portfolioInsights = [
      ...warnings.slice(0, 2),
      ...positives.slice(0, Math.max(1, 3 - Math.min(warnings.length, 2))),
    ].slice(0, 3);

    const openMaintenanceTotal = statusCounts.OPEN + statusCounts.ASSIGNED + statusCounts.IN_PROGRESS;
    console.log(
      `[dashboard] org=${orgId} role=${req.user.role} ` +
      `properties=${propertyHealth.length} ` +
      `actionItems=${actionItems.length} activity=${recentActivityFeed.length} ` +
      `openTickets=${openMaintenanceTotal} violations=${activeViolations.length}`,
    );
    return res.json({
      pendingReview,
      recentInspectionActivity,
      maintenance: {
        statusCounts,
        total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        recentOpen: recentMaintenance,
      },
      tasks: { openCount: taskOpenCount },
      combinedOpen: openMaintenanceTotal + taskOpenCount,
      propertyHealth,
      overdueRooms,
      actionItems,
      propertiesAtAGlance,
      recentActivity: recentActivityFeed,
      portfolioInsights,
      avgResolutionDays,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
