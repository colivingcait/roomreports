import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole('OWNER', 'PM'));

// ─── helpers ─────────────────────────────────────────────

function normalizeAddress(addr) {
  if (!addr) return '';
  return String(addr)
    .toLowerCase()
    .replace(/[.,#]/g, '')
    .replace(/\b(circle|cir)\b/g, 'cir')
    .replace(/\b(street|st)\b/g, 'st')
    .replace(/\b(avenue|ave)\b/g, 'ave')
    .replace(/\b(road|rd)\b/g, 'rd')
    .replace(/\b(drive|dr)\b/g, 'dr')
    .replace(/\b(boulevard|blvd)\b/g, 'blvd')
    .replace(/\b(lane|ln)\b/g, 'ln')
    .replace(/\s+/g, ' ')
    .trim();
}

function streetTokens(addr) {
  const norm = normalizeAddress(addr);
  return norm.split(/\s+/).filter(Boolean);
}

// Score how well a PadSplit address matches a RoomReport property
// (by name or address). Higher = better. Used for fuzzy auto-mapping.
function matchScore(padsplitAddr, property) {
  const padTokens = streetTokens(padsplitAddr);
  const candidates = [property.name, property.address].filter(Boolean);
  let best = 0;
  for (const cand of candidates) {
    const candTokens = new Set(streetTokens(cand));
    let hits = 0;
    for (const t of padTokens) {
      // Skip pure numeric tokens (street numbers) — too noisy
      if (/^\d+$/.test(t)) continue;
      if (t.length < 3) continue;
      if (candTokens.has(t)) hits += 1;
    }
    if (hits > best) best = hits;
  }
  return best;
}

async function autoMatchAddresses(orgId, addresses) {
  if (!addresses || addresses.length === 0) return {};
  const properties = await prisma.property.findMany({
    where: { organizationId: orgId, deletedAt: null },
    select: { id: true, name: true, address: true },
  });
  const existing = await prisma.padSplitPropertyMapping.findMany({
    where: { organizationId: orgId },
  });
  const existingMap = {};
  for (const m of existing) existingMap[m.padsplitAddress] = m.propertyId;

  const out = {};
  const newMaps = [];
  for (const addr of addresses) {
    const norm = normalizeAddress(addr);
    if (existingMap[norm]) {
      out[addr] = existingMap[norm];
      continue;
    }
    let bestId = null;
    let bestScore = 0;
    for (const p of properties) {
      const s = matchScore(addr, p);
      if (s > bestScore) {
        bestScore = s;
        bestId = p.id;
      }
    }
    if (bestScore >= 1 && bestId) {
      out[addr] = bestId;
      newMaps.push({ organizationId: orgId, padsplitAddress: norm, propertyId: bestId });
    } else {
      out[addr] = null;
    }
  }
  if (newMaps.length > 0) {
    // upsert one-by-one to honor unique constraint without bombing
    await Promise.all(newMaps.map((m) => prisma.padSplitPropertyMapping.upsert({
      where: { organizationId_padsplitAddress: { organizationId: m.organizationId, padsplitAddress: m.padsplitAddress } },
      update: { propertyId: m.propertyId },
      create: m,
    })));
  }
  return out;
}

// ─── GET /api/financials/uploads — list all uploads ─────

router.get('/uploads', async (req, res) => {
  try {
    const uploads = await prisma.financialUpload.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { earningsMonth: 'desc' },
      include: { _count: { select: { records: true } } },
    });
    return res.json({ uploads });
  } catch (err) {
    console.error('list financial uploads error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/financials/upload — upload + parse ───────
// Body: { earningsMonth: "YYYY-MM", fileNames: [], records: [...parsed CSV rows...] }

router.post('/upload', async (req, res) => {
  try {
    const { earningsMonth, fileNames, records } = req.body;
    if (!earningsMonth || !Array.isArray(records)) {
      return res.status(400).json({ error: 'earningsMonth and records required' });
    }

    // Overwrite: delete existing upload (cascades to records) then recreate.
    await prisma.financialUpload.deleteMany({
      where: { organizationId: req.user.organizationId, earningsMonth },
    });

    const upload = await prisma.financialUpload.create({
      data: {
        organizationId: req.user.organizationId,
        earningsMonth,
        uploadedById: req.user.id,
        fileNames: fileNames || [],
      },
    });

    // Auto-match addresses to properties
    const addressSet = new Set();
    for (const r of records) {
      if (r.propertyAddress) addressSet.add(r.propertyAddress);
    }
    await autoMatchAddresses(req.user.organizationId, [...addressSet]);

    // Bulk insert records in chunks of 500
    const toInsert = records.map((r) => ({
      uploadId: upload.id,
      organizationId: req.user.organizationId,
      earningsMonth,
      recordType: r.recordType || 'COLLECTED',
      propertyAddress: r.propertyAddress || null,
      propertyPSID: r.propertyPSID || null,
      roomNumber: r.roomNumber || null,
      roomId: r.roomId || null,
      memberId: r.memberId || null,
      memberName: r.memberName || null,
      billType: r.billType || null,
      transactionType: r.transactionType || null,
      transactionReason: r.transactionReason || null,
      billId: r.billId || null,
      grossAmount: r.grossAmount != null ? Number(r.grossAmount) : null,
      bookingFee: r.bookingFee != null ? Number(r.bookingFee) : null,
      serviceFee: r.serviceFee != null ? Number(r.serviceFee) : null,
      transactionFee: r.transactionFee != null ? Number(r.transactionFee) : null,
      hostEarnings: r.hostEarnings != null ? Number(r.hostEarnings) : null,
      totalCollections: r.totalCollections != null ? Number(r.totalCollections) : null,
      totalExpenses: r.totalExpenses != null ? Number(r.totalExpenses) : null,
      totalPayout: r.totalPayout != null ? Number(r.totalPayout) : null,
      category: r.category || null,
      rowType: r.rowType || null,
    }));
    const CHUNK = 500;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      await prisma.financialRecord.createMany({ data: toInsert.slice(i, i + CHUNK) });
    }

    return res.json({ upload, recordsInserted: toInsert.length });
  } catch (err) {
    console.error('upload financials error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/financials/months — list earnings months ──

router.get('/months', async (req, res) => {
  try {
    const rows = await prisma.financialUpload.findMany({
      where: { organizationId: req.user.organizationId },
      select: { earningsMonth: true },
      orderBy: { earningsMonth: 'desc' },
    });
    return res.json({ months: rows.map((r) => r.earningsMonth) });
  } catch (err) {
    console.error('list financial months error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/financials/dashboard?month=YYYY-MM ────────
// Returns the assembled dashboard data — portfolio totals,
// per-property breakdowns, room-level detail, turnover tracker.

router.get('/dashboard', async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const month = req.query.month || null; // null = all time

    const where = { organizationId: orgId };
    if (month && month !== 'all') where.earningsMonth = month;

    const [records, mappings, properties, maintenance] = await Promise.all([
      prisma.financialRecord.findMany({ where }),
      prisma.padSplitPropertyMapping.findMany({ where: { organizationId: orgId } }),
      prisma.property.findMany({
        where: { organizationId: orgId, deletedAt: null },
        select: { id: true, name: true, address: true },
      }),
      prisma.maintenanceItem.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          actualCost: { not: null },
          ...(month && month !== 'all'
            ? {
                createdAt: {
                  gte: new Date(`${month}-01T00:00:00Z`),
                  lt: new Date(monthAfter(month)),
                },
              }
            : {}),
        },
        select: {
          id: true,
          propertyId: true,
          roomId: true,
          actualCost: true,
          createdAt: true,
        },
      }),
    ]);

    const mappingByAddr = {};
    for (const m of mappings) mappingByAddr[m.padsplitAddress] = m.propertyId;
    const propertyById = {};
    for (const p of properties) propertyById[p.id] = p;

    // Attach matched propertyId to records
    const enriched = records.map((r) => {
      const norm = normalizeAddress(r.propertyAddress);
      return { ...r, propertyId: mappingByAddr[norm] || null };
    });

    // Portfolio totals
    let totalCollected = 0;
    let totalPlatformFees = 0;
    let totalHostEarnings = 0;
    let totalBilledDues = 0;
    let totalCollectedDues = 0;
    for (const r of enriched) {
      if (r.recordType === 'COLLECTED' || r.recordType === 'SUMMARY') {
        totalCollected += r.grossAmount || 0;
        totalPlatformFees += (r.bookingFee || 0) + (r.serviceFee || 0) + (r.transactionFee || 0);
        totalHostEarnings += r.hostEarnings || 0;
        if ((r.billType || '').toLowerCase().includes('membership')) {
          totalCollectedDues += r.grossAmount || 0;
        }
      }
      if (r.recordType === 'BILLED') {
        if ((r.transactionReason || r.billType || '').toLowerCase().includes('membership')) {
          totalBilledDues += r.grossAmount || 0;
        }
      }
    }
    const totalUncollected = Math.max(0, totalBilledDues - totalCollectedDues);

    // Per-property + per-room breakdown
    const byProperty = {};
    for (const r of enriched) {
      if (!r.propertyId) continue;
      if (!byProperty[r.propertyId]) {
        byProperty[r.propertyId] = {
          propertyId: r.propertyId,
          property: propertyById[r.propertyId] || null,
          padsplitAddress: r.propertyAddress,
          gross: 0,
          bookingFee: 0,
          serviceFee: 0,
          transactionFee: 0,
          hostEarnings: 0,
          billedDues: 0,
          collectedDues: 0,
          lateFees: 0,
          rooms: {},
          memberIds: new Set(),
        };
      }
      const p = byProperty[r.propertyId];
      const isCollected = r.recordType === 'COLLECTED' || r.recordType === 'SUMMARY';
      if (isCollected) {
        p.gross += r.grossAmount || 0;
        p.bookingFee += r.bookingFee || 0;
        p.serviceFee += r.serviceFee || 0;
        p.transactionFee += r.transactionFee || 0;
        p.hostEarnings += r.hostEarnings || 0;
      }
      const bt = (r.billType || '').toLowerCase();
      if (isCollected && bt.includes('membership')) p.collectedDues += r.grossAmount || 0;
      if (isCollected && bt.includes('late')) p.lateFees += r.grossAmount || 0;
      if (r.recordType === 'BILLED' && (r.transactionReason || r.billType || '').toLowerCase().includes('membership')) {
        p.billedDues += r.grossAmount || 0;
      }
      if (r.memberId) p.memberIds.add(r.memberId);

      if (r.roomNumber || r.roomId) {
        const key = r.roomNumber || r.roomId;
        if (!p.rooms[key]) {
          p.rooms[key] = {
            roomNumber: r.roomNumber,
            roomId: r.roomId,
            residentName: null,
            residentMemberId: null,
            gross: 0,
            lateFees: 0,
            bookingFee: 0,
            serviceFee: 0,
            transactionFee: 0,
            hostEarnings: 0,
            billed: 0,
            memberIds: new Set(),
            lastSeen: null,
          };
        }
        const room = p.rooms[key];
        if (isCollected && bt.includes('membership')) {
          room.gross += r.grossAmount || 0;
        }
        if (isCollected && bt.includes('late')) {
          room.lateFees += r.grossAmount || 0;
        }
        if (isCollected) {
          room.bookingFee += r.bookingFee || 0;
          room.serviceFee += r.serviceFee || 0;
          room.transactionFee += r.transactionFee || 0;
          room.hostEarnings += r.hostEarnings || 0;
        }
        if (r.recordType === 'BILLED') room.billed += r.grossAmount || 0;
        if (r.memberId) {
          room.memberIds.add(r.memberId);
          if (isCollected && (!room.lastSeen || (r.createdAt && r.createdAt > room.lastSeen))) {
            room.residentName = r.memberName;
            room.residentMemberId = r.memberId;
            room.lastSeen = r.createdAt;
          }
        }
      }
    }

    // Maintenance costs per property + per room (for the month)
    const maintByProperty = {};
    const maintByRoom = {};
    for (const m of maintenance) {
      maintByProperty[m.propertyId] = (maintByProperty[m.propertyId] || 0) + (m.actualCost || 0);
      if (m.roomId) {
        maintByRoom[m.roomId] = (maintByRoom[m.roomId] || 0) + (m.actualCost || 0);
      }
    }

    // Turnover tracker: count distinct member ids per room across the
    // selected month/all months for properties in scope.
    const turnoverWhere = { organizationId: orgId, recordType: 'COLLECTED' };
    const turnoverRecords = await prisma.financialRecord.findMany({
      where: turnoverWhere,
      select: { roomNumber: true, roomId: true, memberId: true, propertyAddress: true, earningsMonth: true },
    });
    const turnoverByRoom = {}; // key = "addr|room"
    for (const r of turnoverRecords) {
      if (!r.roomNumber && !r.roomId) continue;
      if (!r.memberId) continue;
      const propId = mappingByAddr[normalizeAddress(r.propertyAddress)];
      const key = `${propId || r.propertyAddress}|${r.roomNumber || r.roomId}`;
      if (!turnoverByRoom[key]) {
        turnoverByRoom[key] = {
          propertyId: propId || null,
          propertyName: propId ? (propertyById[propId]?.name || null) : r.propertyAddress,
          roomNumber: r.roomNumber || r.roomId,
          memberMonths: {}, // memberId -> Set of months
          months: new Set(),
        };
      }
      const t = turnoverByRoom[key];
      t.months.add(r.earningsMonth);
      if (!t.memberMonths[r.memberId]) t.memberMonths[r.memberId] = new Set();
      t.memberMonths[r.memberId].add(r.earningsMonth);
    }
    const turnoverList = Object.values(turnoverByRoom).map((t) => {
      const memberCount = Object.keys(t.memberMonths).length;
      const turnovers = Math.max(0, memberCount - 1);
      const monthCount = t.months.size;
      const avgTenure = memberCount > 0 ? monthCount / memberCount : 0;
      return {
        propertyId: t.propertyId,
        propertyName: t.propertyName,
        roomNumber: t.roomNumber,
        turnovers,
        memberCount,
        avgTenureMonths: Number(avgTenure.toFixed(2)),
      };
    });
    turnoverList.sort((a, b) => b.turnovers - a.turnovers);

    // Turnovers this month (per property): count rooms whose member
    // changed vs prior month.
    const turnoversThisMonthByProperty = {};
    if (month && month !== 'all') {
      const prev = monthBefore(month);
      const prevRecords = await prisma.financialRecord.findMany({
        where: { organizationId: orgId, earningsMonth: prev, recordType: 'COLLECTED' },
        select: { roomNumber: true, roomId: true, memberId: true, propertyAddress: true },
      });
      const prevMap = {};
      for (const r of prevRecords) {
        if (!r.memberId) continue;
        const propId = mappingByAddr[normalizeAddress(r.propertyAddress)];
        const key = `${propId}|${r.roomNumber || r.roomId}`;
        prevMap[key] = r.memberId;
      }
      for (const propId of Object.keys(byProperty)) {
        const p = byProperty[propId];
        for (const roomKey of Object.keys(p.rooms)) {
          const room = p.rooms[roomKey];
          const key = `${propId}|${roomKey}`;
          const prevMember = prevMap[key];
          const currentMembers = [...room.memberIds];
          const isTurnover = prevMember && currentMembers.length > 0 && !currentMembers.includes(prevMember);
          room.turnover = !!isTurnover;
          if (isTurnover) {
            turnoversThisMonthByProperty[propId] = (turnoversThisMonthByProperty[propId] || 0) + 1;
          }
        }
      }
    }

    // Finalize property breakdowns
    const propertyBreakdown = Object.values(byProperty).map((p) => {
      const rooms = Object.values(p.rooms).map((room) => {
        const maintenanceCost = maintByRoom[room.roomId] || 0;
        return {
          roomNumber: room.roomNumber,
          roomId: room.roomId,
          residentName: room.residentName,
          gross: round2(room.gross),
          lateFees: round2(room.lateFees),
          bookingFee: round2(room.bookingFee),
          serviceFee: round2(room.serviceFee),
          transactionFee: round2(room.transactionFee),
          hostEarnings: round2(room.hostEarnings),
          billed: round2(room.billed),
          uncollected: round2(Math.max(0, room.billed - room.gross)),
          turnover: !!room.turnover,
          maintenanceCost: round2(maintenanceCost),
          netPL: round2(room.hostEarnings - maintenanceCost),
        };
      });
      const roomsWithCollections = rooms.filter((r) => r.gross > 0).length;
      const sumDues = rooms.reduce((a, r) => a + r.gross, 0);
      const avgRent = roomsWithCollections > 0 ? sumDues / roomsWithCollections : 0;
      // Vacancy estimate: for any room in this property with billed
      // membership but $0 collected, assume the billed amount is lost.
      let vacancyCost = 0;
      for (const r of rooms) {
        if (r.gross === 0 && r.billed > 0) vacancyCost += r.billed;
      }
      const collectionRate = p.billedDues > 0 ? (p.collectedDues / p.billedDues) * 100 : null;
      return {
        propertyId: p.propertyId,
        propertyName: p.property?.name || p.padsplitAddress,
        padsplitAddress: p.padsplitAddress,
        gross: round2(p.gross),
        bookingFee: round2(p.bookingFee),
        serviceFee: round2(p.serviceFee),
        transactionFee: round2(p.transactionFee),
        hostEarnings: round2(p.hostEarnings),
        collectionRate: collectionRate != null ? round2(collectionRate) : null,
        uncollectedRent: round2(Math.max(0, p.billedDues - p.collectedDues)),
        lateFees: round2(p.lateFees),
        vacancyCost: round2(vacancyCost),
        avgRentPerRoom: round2(avgRent),
        turnoversThisMonth: turnoversThisMonthByProperty[p.propertyId] || 0,
        maintenanceCost: round2(maintByProperty[p.propertyId] || 0),
        rooms,
      };
    });
    propertyBreakdown.sort((a, b) => (b.hostEarnings || 0) - (a.hostEarnings || 0));

    // Month-over-month trend deltas for portfolio cards
    let trends = null;
    if (month && month !== 'all') {
      const prev = monthBefore(month);
      const prevRecords = await prisma.financialRecord.findMany({
        where: { organizationId: orgId, earningsMonth: prev },
      });
      let pCollected = 0, pFees = 0, pHost = 0, pBilled = 0, pCollectedDues = 0;
      for (const r of prevRecords) {
        if (r.recordType === 'COLLECTED' || r.recordType === 'SUMMARY') {
          pCollected += r.grossAmount || 0;
          pFees += (r.bookingFee || 0) + (r.serviceFee || 0) + (r.transactionFee || 0);
          pHost += r.hostEarnings || 0;
          if ((r.billType || '').toLowerCase().includes('membership')) pCollectedDues += r.grossAmount || 0;
        }
        if (r.recordType === 'BILLED' && (r.transactionReason || r.billType || '').toLowerCase().includes('membership')) {
          pBilled += r.grossAmount || 0;
        }
      }
      const pUncollected = Math.max(0, pBilled - pCollectedDues);
      trends = {
        collected: deltaPct(totalCollected, pCollected),
        fees: deltaPct(totalPlatformFees, pFees),
        hostEarnings: deltaPct(totalHostEarnings, pHost),
        uncollected: deltaPct(totalUncollected, pUncollected),
      };
    }

    return res.json({
      month,
      totals: {
        collected: round2(totalCollected),
        platformFees: round2(totalPlatformFees),
        hostEarnings: round2(totalHostEarnings),
        uncollected: round2(totalUncollected),
      },
      trends,
      propertyBreakdown,
      turnoverTracker: turnoverList,
    });
  } catch (err) {
    console.error('financial dashboard error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/financials/timeseries ──────────────────────
// Returns per-property monthly time series for charting.

router.get('/timeseries', async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const records = await prisma.financialRecord.findMany({
      where: { organizationId: orgId, recordType: { in: ['COLLECTED', 'SUMMARY'] } },
      select: {
        propertyAddress: true,
        earningsMonth: true,
        grossAmount: true,
        bookingFee: true,
        serviceFee: true,
        transactionFee: true,
        hostEarnings: true,
      },
    });
    const mappings = await prisma.padSplitPropertyMapping.findMany({ where: { organizationId: orgId } });
    const properties = await prisma.property.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, name: true },
    });
    const mappingByAddr = {};
    for (const m of mappings) mappingByAddr[m.padsplitAddress] = m.propertyId;
    const propertyById = {};
    for (const p of properties) propertyById[p.id] = p;

    // [propertyId][month] = { gross, fees, host }
    const buckets = {};
    const monthsSet = new Set();
    for (const r of records) {
      const norm = normalizeAddress(r.propertyAddress);
      const propId = mappingByAddr[norm];
      if (!propId) continue;
      monthsSet.add(r.earningsMonth);
      if (!buckets[propId]) buckets[propId] = {};
      if (!buckets[propId][r.earningsMonth]) {
        buckets[propId][r.earningsMonth] = { gross: 0, fees: 0, host: 0 };
      }
      const b = buckets[propId][r.earningsMonth];
      b.gross += r.grossAmount || 0;
      b.fees += (r.bookingFee || 0) + (r.serviceFee || 0) + (r.transactionFee || 0);
      b.host += r.hostEarnings || 0;
    }

    const months = [...monthsSet].sort();
    const series = Object.keys(buckets).map((propId) => ({
      propertyId: propId,
      propertyName: propertyById[propId]?.name || propId,
      points: months.map((m) => ({
        month: m,
        gross: round2(buckets[propId][m]?.gross || 0),
        fees: round2(buckets[propId][m]?.fees || 0),
        host: round2(buckets[propId][m]?.host || 0),
      })),
    }));

    return res.json({ months, series });
  } catch (err) {
    console.error('financial timeseries error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/financials/property-summary ────────────────
// Per-property avg-of-last-3-months stats for the Properties cards.

router.get('/property-summary', async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const months = await prisma.financialUpload.findMany({
      where: { organizationId: orgId },
      orderBy: { earningsMonth: 'desc' },
      take: 6,
      select: { earningsMonth: true },
    });
    if (months.length === 0) {
      return res.json({ propertySummary: {}, hasData: false, months: [] });
    }
    const last3 = months.slice(0, 3).map((m) => m.earningsMonth);
    const last6 = months.slice(0, 6).map((m) => m.earningsMonth);

    const [records, mappings, maintenance] = await Promise.all([
      prisma.financialRecord.findMany({
        where: {
          organizationId: orgId,
          earningsMonth: { in: last6 },
          recordType: { in: ['COLLECTED', 'SUMMARY'] },
        },
        select: {
          propertyAddress: true,
          earningsMonth: true,
          grossAmount: true,
          hostEarnings: true,
          billType: true,
          recordType: true,
          bookingFee: true,
          serviceFee: true,
          transactionFee: true,
        },
      }),
      prisma.padSplitPropertyMapping.findMany({ where: { organizationId: orgId } }),
      prisma.maintenanceItem.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          actualCost: { not: null },
          createdAt: { gte: monthsAgoDate(3) },
        },
        select: { propertyId: true, actualCost: true },
      }),
    ]);

    const billedRecords = await prisma.financialRecord.findMany({
      where: {
        organizationId: orgId,
        earningsMonth: { in: last3 },
        recordType: 'BILLED',
      },
      select: { propertyAddress: true, grossAmount: true, transactionReason: true, billType: true },
    });

    const mappingByAddr = {};
    for (const m of mappings) mappingByAddr[m.padsplitAddress] = m.propertyId;

    // Per-property: per-month host earnings (last6) + dues collected (last3)
    const byProp = {};
    for (const r of records) {
      const propId = mappingByAddr[normalizeAddress(r.propertyAddress)];
      if (!propId) continue;
      if (!byProp[propId]) byProp[propId] = { monthly: {}, billedDues: 0, collectedDues: 0 };
      if (!byProp[propId].monthly[r.earningsMonth]) {
        byProp[propId].monthly[r.earningsMonth] = { host: 0, gross: 0 };
      }
      byProp[propId].monthly[r.earningsMonth].host += r.hostEarnings || 0;
      byProp[propId].monthly[r.earningsMonth].gross += r.grossAmount || 0;
      if (last3.includes(r.earningsMonth) && (r.billType || '').toLowerCase().includes('membership')) {
        byProp[propId].collectedDues += r.grossAmount || 0;
      }
    }
    for (const r of billedRecords) {
      const propId = mappingByAddr[normalizeAddress(r.propertyAddress)];
      if (!propId) continue;
      if (!byProp[propId]) byProp[propId] = { monthly: {}, billedDues: 0, collectedDues: 0 };
      if ((r.transactionReason || r.billType || '').toLowerCase().includes('membership')) {
        byProp[propId].billedDues += r.grossAmount || 0;
      }
    }

    const maintByProp = {};
    for (const m of maintenance) {
      maintByProp[m.propertyId] = (maintByProp[m.propertyId] || 0) + (m.actualCost || 0);
    }

    const summary = {};
    for (const propId of Object.keys(byProp)) {
      const last3Host = last3.map((m) => byProp[propId].monthly[m]?.host || 0);
      const sumHost = last3Host.reduce((a, b) => a + b, 0);
      const avgRevenue = last3Host.length > 0 ? sumHost / last3Host.length : 0;
      const avgMaintenance = (maintByProp[propId] || 0) / 3;
      const collectionRate = byProp[propId].billedDues > 0
        ? (byProp[propId].collectedDues / byProp[propId].billedDues) * 100
        : null;
      const sparkline = last6.slice().reverse().map((m) => ({
        month: m,
        host: round2(byProp[propId].monthly[m]?.host || 0),
      }));
      summary[propId] = {
        avgRevenue: round2(avgRevenue),
        avgMaintenance: round2(avgMaintenance),
        netMonthly: round2(avgRevenue - avgMaintenance),
        collectionRate: collectionRate != null ? round2(collectionRate) : null,
        sparkline,
      };
    }

    return res.json({ propertySummary: summary, hasData: true, months: last6 });
  } catch (err) {
    console.error('property summary error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/financials/mappings ────────────────────────

router.get('/mappings', async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const mappings = await prisma.padSplitPropertyMapping.findMany({
      where: { organizationId: orgId },
    });
    // Surface unmatched addresses too — anything in records that doesn't
    // have a mapping yet, so the UI can prompt for manual matching.
    const records = await prisma.financialRecord.findMany({
      where: { organizationId: orgId, propertyAddress: { not: null } },
      select: { propertyAddress: true },
      distinct: ['propertyAddress'],
    });
    const mappedNormSet = new Set(mappings.map((m) => m.padsplitAddress));
    const unmatched = [];
    for (const r of records) {
      const norm = normalizeAddress(r.propertyAddress);
      if (!mappedNormSet.has(norm)) unmatched.push({ raw: r.propertyAddress, normalized: norm });
    }
    return res.json({ mappings, unmatched });
  } catch (err) {
    console.error('list mappings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/financials/mappings — create/update ───────

router.post('/mappings', async (req, res) => {
  try {
    const { padsplitAddress, propertyId } = req.body;
    if (!padsplitAddress || !propertyId) {
      return res.status(400).json({ error: 'padsplitAddress and propertyId required' });
    }
    const property = await prisma.property.findFirst({
      where: { id: propertyId, organizationId: req.user.organizationId, deletedAt: null },
    });
    if (!property) return res.status(404).json({ error: 'Property not found' });
    const norm = normalizeAddress(padsplitAddress);
    const m = await prisma.padSplitPropertyMapping.upsert({
      where: { organizationId_padsplitAddress: { organizationId: req.user.organizationId, padsplitAddress: norm } },
      update: { propertyId },
      create: { organizationId: req.user.organizationId, padsplitAddress: norm, propertyId },
    });
    return res.json({ mapping: m });
  } catch (err) {
    console.error('upsert mapping error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── helpers ────────────────────────────────────────────

function round2(n) {
  if (n == null || isNaN(n)) return 0;
  return Math.round(n * 100) / 100;
}

function deltaPct(curr, prev) {
  if (!prev) return curr > 0 ? 100 : 0;
  return round2(((curr - prev) / prev) * 100);
}

function monthBefore(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthAfter(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString();
}

function monthsAgoDate(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(1);
  return d;
}

export default router;
