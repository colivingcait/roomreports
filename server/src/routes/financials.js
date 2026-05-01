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

// ─── POST /api/financials/reset — wipe all financial data for the org

router.post('/reset', async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const recordsDel = await prisma.financialRecord.deleteMany({ where: { organizationId: orgId } });
    const uploadsDel = await prisma.financialUpload.deleteMany({ where: { organizationId: orgId } });
    return res.json({
      ok: true,
      recordsDeleted: recordsDel.count,
      uploadsDeleted: uploadsDel.count,
    });
  } catch (err) {
    console.error('reset financials error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

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
// Body: { fileNames: [], records: [...] } — each record carries its own
// earningsMonth. We bucket by month, then for each month replace any
// existing FinancialUpload for that org+month (cascade-deletes records).
// Months that don't appear in the new payload are left untouched.

router.post('/upload', async (req, res) => {
  try {
    const { fileNames, records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records[] required' });
    }

    // Group records by their earningsMonth.
    const byMonth = new Map();
    let dropped = 0;
    for (const r of records) {
      const m = (r.earningsMonth || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(m)) { dropped += 1; continue; }
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m).push(r);
    }
    if (byMonth.size === 0) {
      return res.status(400).json({
        error: 'No records had a valid earningsMonth (YYYY-MM). Check that your CSVs have Payout Month / Created / Earnings Month columns.',
        receivedRows: records.length,
        droppedRows: dropped,
      });
    }
    console.log(
      `[financials] upload: ${records.length} rows received, ${dropped} dropped, months=${[...byMonth.keys()].sort().join(',')}`,
    );

    // Auto-match addresses once for the whole payload.
    const addressSet = new Set();
    for (const r of records) {
      if (r.propertyAddress) addressSet.add(r.propertyAddress);
    }
    await autoMatchAddresses(req.user.organizationId, [...addressSet]);

    // Per-month: delete prior, create fresh, insert records.
    let totalInserted = 0;
    const monthsAffected = [];
    for (const [month, rows] of byMonth.entries()) {
      await prisma.financialUpload.deleteMany({
        where: { organizationId: req.user.organizationId, earningsMonth: month },
      });
      const upload = await prisma.financialUpload.create({
        data: {
          organizationId: req.user.organizationId,
          earningsMonth: month,
          uploadedById: req.user.id,
          fileNames: fileNames || [],
        },
      });
      const toInsert = rows.map((r) => ({
        uploadId: upload.id,
        organizationId: req.user.organizationId,
        earningsMonth: month,
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
      totalInserted += toInsert.length;
      monthsAffected.push(month);
    }

    const perMonthCounts = {};
    for (const [m, rows] of byMonth.entries()) perMonthCounts[m] = rows.length;
    return res.json({
      recordsReceived: records.length,
      recordsInserted: totalInserted,
      droppedRows: dropped,
      monthsAffected: monthsAffected.length,
      months: monthsAffected.sort(),
      perMonthCounts,
    });
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

    const [records, allCollectedHistory, mappings, properties, maintenance] = await Promise.all([
      prisma.financialRecord.findMany({ where }),
      // For computing typical monthly rent per room — pull every COLLECTED
      // membership-dues row across all months we have data for.
      prisma.financialRecord.findMany({
        where: { organizationId: orgId, recordType: 'COLLECTED' },
        select: {
          earningsMonth: true,
          propertyAddress: true,
          roomNumber: true,
          roomId: true,
          billType: true,
          grossAmount: true,
        },
      }),
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

    // Auto-fuzzy-match any addresses we don't have an explicit mapping
    // for. This way property breakdown + names show up the moment a
    // property name overlaps the PadSplit street name.
    const distinctAddrs = [...new Set(records.map((r) => r.propertyAddress).filter(Boolean))];
    for (const addr of distinctAddrs) {
      const norm = normalizeAddress(addr);
      if (mappingByAddr[norm]) continue;
      let bestId = null;
      let bestScore = 0;
      for (const p of properties) {
        const s = matchScore(addr, p);
        if (s > bestScore) { bestScore = s; bestId = p.id; }
      }
      if (bestScore >= 1 && bestId) mappingByAddr[norm] = bestId;
    }

    // Attach matched propertyId to records (or null when unmatched).
    const enriched = records.map((r) => {
      const norm = normalizeAddress(r.propertyAddress);
      return { ...r, propertyId: mappingByAddr[norm] || null };
    });

    // Portfolio totals — use only COLLECTED rows for line-item totals;
    // SUMMARY is a per-property aggregate from PadSplit and would double-
    // count if added. Platform fees in PadSplit CSVs are stored as
    // negative numbers (deductions); display them as positive magnitudes.
    let totalCollected = 0;
    let totalPlatformFees = 0;
    let totalHostEarnings = 0;
    for (const r of enriched) {
      if (r.recordType === 'COLLECTED') {
        totalCollected += r.grossAmount || 0;
        totalPlatformFees += Math.abs(r.bookingFee || 0) + Math.abs(r.serviceFee || 0) + Math.abs(r.transactionFee || 0);
        totalHostEarnings += r.hostEarnings || 0;
      }
    }

    // Per-property + per-room breakdown — keyed by the PadSplit address
    // (normalized). We don't require a RoomReport property match for
    // numbers to show up; we just attach the matched name when we have
    // one. Records with no propertyAddress are bucketed under "Unknown".
    const byProperty = {};
    for (const r of enriched) {
      const addr = r.propertyAddress || 'Unknown';
      const key = normalizeAddress(addr) || 'unknown';
      if (!byProperty[key]) {
        const matchedProp = r.propertyId ? propertyById[r.propertyId] : null;
        byProperty[key] = {
          propertyKey: key,
          propertyId: r.propertyId || null,
          property: matchedProp || null,
          padsplitAddress: addr,
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
      const p = byProperty[key];
      const isCollected = r.recordType === 'COLLECTED';
      if (isCollected) {
        p.gross += r.grossAmount || 0;
        p.bookingFee += Math.abs(r.bookingFee || 0);
        p.serviceFee += Math.abs(r.serviceFee || 0);
        p.transactionFee += Math.abs(r.transactionFee || 0);
        p.hostEarnings += r.hostEarnings || 0;
      }
      const bt = (r.billType || '').toLowerCase();
      if (isCollected && isDuesBillType(r.billType)) p.collectedDues += r.grossAmount || 0;
      if (isCollected && bt.includes('late')) p.lateFees += r.grossAmount || 0;
      if (r.recordType === 'BILLED' && (isDuesBillType(r.billType) || isDuesBillType(r.transactionReason))) {
        p.billedDues += Math.abs(r.grossAmount || 0);
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
        if (isCollected && isDuesBillType(r.billType)) {
          room.gross += r.grossAmount || 0;
        }
        if (isCollected && bt.includes('late')) {
          room.lateFees += r.grossAmount || 0;
        }
        if (isCollected) {
          room.bookingFee += Math.abs(r.bookingFee || 0);
          room.serviceFee += Math.abs(r.serviceFee || 0);
          room.transactionFee += Math.abs(r.transactionFee || 0);
          room.hostEarnings += r.hostEarnings || 0;
        }
        if (r.recordType === 'BILLED' && (isDuesBillType(r.billType) || isDuesBillType(r.transactionReason))) {
          room.billed += Math.abs(r.grossAmount || 0);
        }
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

    // Typical monthly rent per (normalized address, room number).
    // Average across months where the room collected ANY membership dues
    // — months at $0 don't drag the average down. Used for vacancy calc.
    const typicalRentByRoom = (() => {
      const monthlyTotals = {}; // key = "addr|room|month" → membership dues
      for (const r of allCollectedHistory) {
        if (!isDuesBillType(r.billType)) continue;
        const roomKey = (r.roomNumber || r.roomId || '').toString().trim();
        if (!roomKey) continue;
        const norm = normalizeAddress(r.propertyAddress) || 'unknown';
        const k = `${norm}|${roomKey}|${r.earningsMonth}`;
        monthlyTotals[k] = (monthlyTotals[k] || 0) + (r.grossAmount || 0);
      }
      const totalsByRoom = {}; // "addr|room" → { sum, count }
      for (const k of Object.keys(monthlyTotals)) {
        const v = monthlyTotals[k];
        if (v <= 0) continue;
        const [norm, room] = k.split('|');
        const roomKey = `${norm}|${room}`;
        if (!totalsByRoom[roomKey]) totalsByRoom[roomKey] = { sum: 0, count: 0 };
        totalsByRoom[roomKey].sum += v;
        totalsByRoom[roomKey].count += 1;
      }
      const out = {};
      for (const k of Object.keys(totalsByRoom)) {
        out[k] = totalsByRoom[k].sum / totalsByRoom[k].count;
      }
      return out;
    })();

    // Property-level fallback rent (avg of room rents) for rooms with no
    // history yet (e.g. brand-new room with no collections so far).
    const fallbackRentByProperty = (() => {
      const sums = {};
      for (const k of Object.keys(typicalRentByRoom)) {
        const [norm] = k.split('|');
        if (!sums[norm]) sums[norm] = { sum: 0, count: 0 };
        sums[norm].sum += typicalRentByRoom[k];
        sums[norm].count += 1;
      }
      const out = {};
      for (const norm of Object.keys(sums)) {
        out[norm] = sums[norm].count > 0 ? sums[norm].sum / sums[norm].count : 0;
      }
      return out;
    })();

    // Maintenance costs per property + per room (for the month)
    const maintByProperty = {};
    const maintByRoom = {};
    for (const m of maintenance) {
      maintByProperty[m.propertyId] = (maintByProperty[m.propertyId] || 0) + (m.actualCost || 0);
      if (m.roomId) {
        maintByRoom[m.roomId] = (maintByRoom[m.roomId] || 0) + (m.actualCost || 0);
      }
    }

    // Turnover tracker. Correct definition:
    //   For each room (Property Address + Room Number), look at the SET
    //   of distinct member IDs each month. A turnover counts each
    //   month-to-month transition where the new month's set is fully
    //   disjoint from the prior month's set (i.e. all old residents are
    //   gone). Initial occupancy is NOT a turnover. Multiple payments
    //   in a month from the same member are NOT turnovers.
    const turnoverRecords = await prisma.financialRecord.findMany({
      where: { organizationId: orgId, recordType: 'COLLECTED' },
      select: { roomNumber: true, roomId: true, memberId: true, propertyAddress: true, earningsMonth: true },
    });

    // key = "<normalized addr>|<room number>" → { propertyName, byMonth: Map<month, Set<memberId>> }
    const turnoverByRoom = {};
    for (const r of turnoverRecords) {
      const roomKey = (r.roomNumber || r.roomId || '').toString().trim();
      if (!roomKey) continue;
      const memberId = (r.memberId || '').toString().trim();
      if (!memberId) continue;
      const norm = normalizeAddress(r.propertyAddress) || 'unknown';
      const key = `${norm}|${roomKey}`;
      if (!turnoverByRoom[key]) {
        const propId = mappingByAddr[norm];
        turnoverByRoom[key] = {
          propertyId: propId || null,
          propertyName: propId ? (propertyById[propId]?.name || r.propertyAddress) : (r.propertyAddress || '—'),
          roomNumber: roomKey,
          byMonth: new Map(),
        };
      }
      const t = turnoverByRoom[key];
      if (!t.byMonth.has(r.earningsMonth)) t.byMonth.set(r.earningsMonth, new Set());
      t.byMonth.get(r.earningsMonth).add(memberId);
    }

    const turnoverList = Object.values(turnoverByRoom).map((t) => {
      const months = [...t.byMonth.keys()].sort();
      const allMembers = new Set();
      for (const set of t.byMonth.values()) for (const m of set) allMembers.add(m);

      let turnovers = 0;
      for (let i = 1; i < months.length; i++) {
        const prev = t.byMonth.get(months[i - 1]);
        const curr = t.byMonth.get(months[i]);
        if (!prev || prev.size === 0) continue;        // first occupancy
        if (!curr || curr.size === 0) continue;        // vacant gap, not a turnover yet
        let overlap = false;
        for (const m of curr) if (prev.has(m)) { overlap = true; break; }
        if (!overlap) turnovers += 1;
      }

      const occupiedMonths = [...t.byMonth.values()].filter((s) => s.size > 0).length;
      const avgTenure = occupiedMonths / Math.max(1, turnovers + 1);

      return {
        propertyId: t.propertyId,
        propertyName: t.propertyName,
        roomNumber: t.roomNumber,
        turnovers,
        memberCount: allMembers.size,
        avgTenureMonths: Number(avgTenure.toFixed(2)),
      };
    });
    turnoverList.sort((a, b) => b.turnovers - a.turnovers);

    // Turnovers this month (per property key = normalized address):
    // count rooms whose current set is fully disjoint from prior month's.
    const turnoversThisMonthByProperty = {};
    if (month && month !== 'all') {
      const prev = monthBefore(month);
      const prevRecords = await prisma.financialRecord.findMany({
        where: { organizationId: orgId, earningsMonth: prev, recordType: 'COLLECTED' },
        select: { roomNumber: true, roomId: true, memberId: true, propertyAddress: true },
      });
      const prevByRoom = {}; // key = "<normAddr>|<roomNum>" → Set<memberId>
      for (const r of prevRecords) {
        const roomKey = (r.roomNumber || r.roomId || '').toString().trim();
        const memberId = (r.memberId || '').toString().trim();
        if (!roomKey || !memberId) continue;
        const norm = normalizeAddress(r.propertyAddress) || 'unknown';
        const k = `${norm}|${roomKey}`;
        if (!prevByRoom[k]) prevByRoom[k] = new Set();
        prevByRoom[k].add(memberId);
      }
      for (const propKey of Object.keys(byProperty)) {
        const p = byProperty[propKey];
        for (const roomKey of Object.keys(p.rooms)) {
          const room = p.rooms[roomKey];
          const k = `${propKey}|${roomKey}`;
          const prevSet = prevByRoom[k];
          const currentMembers = [...room.memberIds];
          let isTurnover = false;
          if (prevSet && prevSet.size > 0 && currentMembers.length > 0) {
            isTurnover = !currentMembers.some((m) => prevSet.has(m));
          }
          room.turnover = !!isTurnover;
          if (isTurnover) {
            turnoversThisMonthByProperty[propKey] = (turnoversThisMonthByProperty[propKey] || 0) + 1;
          }
        }
      }
    }

    // Vacancy computation. PadSplit only bills when a room is occupied,
    // so "billed - collected" misses true vacancy (empty room = no bill).
    // Instead: use each room's typical monthly rent (averaged across the
    // months it actually collected dues) and figure how much of the
    // selected month was empty.
    //
    //   typicalRent  = avg of months where the room collected > $0
    //   thisMonthDues = membership dues collected for this room this month
    //   vacantFraction = max(0, 1 - thisMonthDues / typicalRent)
    //   vacantDays   = round(daysInMonth * vacantFraction)
    //   vacancyCost  = typicalRent * vacantFraction
    //
    // For "all time" we sum the per-month per-room vacancy across history.

    // A room is considered fully occupied for the month if it earned at
    // least this fraction of its typical rent. Below that, the shortfall
    // is treated as partial-month vacancy. 0.85 absorbs the normal
    // month-to-month dollar variation (different number of pay periods,
    // late-fee timing, prorations) so a continuously-occupied room
    // doesn't show phantom vacancy from a $593 / $643 dip.
    const OCCUPIED_THRESHOLD = 0.85;

    function vacancyForRoom({ propertyKey, roomKey, monthStr, collectedThisMonth, typicalRent, fallbackRent }) {
      const expected = typicalRent > 0 ? typicalRent : (fallbackRent || 0);
      if (expected <= 0) {
        return { vacantDays: 0, vacantFraction: 0, vacancyCost: 0, dailyRate: 0, expectedRent: 0 };
      }
      const dim = monthStr ? daysInMonth(monthStr) : 30;
      const dailyRate = expected / dim;
      const ratio = collectedThisMonth / expected;
      let vacantFraction;
      if (ratio >= OCCUPIED_THRESHOLD) {
        // Fully occupied — minor under-collection is just monthly noise.
        vacantFraction = 0;
      } else {
        // Partial occupancy: shortfall is proportional to how far below
        // typical rent the room came in. Capped at 1 (fully vacant).
        vacantFraction = Math.max(0, Math.min(1, 1 - ratio));
      }
      const vacantDays = Math.round(dim * vacantFraction);
      const vacancyCost = expected * vacantFraction;
      return { vacantDays, vacantFraction, vacancyCost, dailyRate, expectedRent: expected };
    }

    // For "all time", per-room vacancy aggregates across all months.
    const isAllTime = !month || month === 'all';
    const allMonthsForVacancy = isAllTime
      ? [...new Set(allCollectedHistory.map((r) => r.earningsMonth))].sort()
      : [month];

    // Pre-compute per-room collected dues for all months (so all-time
    // vacancy can sum monthly shortfalls).
    const collectedByRoomMonth = {}; // "addr|room|month" -> dues collected
    for (const r of allCollectedHistory) {
      if (!isDuesBillType(r.billType)) continue;
      const roomKey = (r.roomNumber || r.roomId || '').toString().trim();
      if (!roomKey) continue;
      const norm = normalizeAddress(r.propertyAddress) || 'unknown';
      const k = `${norm}|${roomKey}|${r.earningsMonth}`;
      collectedByRoomMonth[k] = (collectedByRoomMonth[k] || 0) + (r.grossAmount || 0);
    }

    // Finalize property breakdowns
    const propertyBreakdown = Object.values(byProperty).map((p) => {
      const propKeyForFallback = p.propertyKey;
      const fallbackRent = fallbackRentByProperty[propKeyForFallback] || 0;
      let propVacancyDays = 0;
      let propVacancyCost = 0;
      let propTotalDays = 0;

      const rooms = Object.values(p.rooms).map((room) => {
        const maintenanceCost = maintByRoom[room.roomId] || 0;
        const roomKey = (room.roomNumber || room.roomId || '').toString().trim();
        const rentKey = `${propKeyForFallback}|${roomKey}`;
        const typicalRent = typicalRentByRoom[rentKey] || 0;

        // Sum vacancy across all months in scope (one month for a
        // selected month, every month for "all time").
        let vacantDaysTotal = 0;
        let vacancyCostTotal = 0;
        let totalDaysTotal = 0;
        let expectedRent = typicalRent || fallbackRent;
        let dailyRate = 0;
        for (const m of allMonthsForVacancy) {
          const collectedThisMonth = collectedByRoomMonth[`${propKeyForFallback}|${roomKey}|${m}`] || 0;
          const v = vacancyForRoom({
            propertyKey: propKeyForFallback,
            roomKey,
            monthStr: m,
            collectedThisMonth,
            typicalRent,
            fallbackRent,
          });
          vacantDaysTotal += v.vacantDays;
          vacancyCostTotal += v.vacancyCost;
          totalDaysTotal += daysInMonth(m);
          dailyRate = v.dailyRate;
        }
        propVacancyDays += vacantDaysTotal;
        propVacancyCost += vacancyCostTotal;
        propTotalDays += totalDaysTotal;

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
          typicalRent: round2(expectedRent),
          dailyRate: round2(dailyRate),
          vacantDays: vacantDaysTotal,
          vacancy: round2(vacancyCostTotal),
          turnover: !!room.turnover,
          maintenanceCost: round2(maintenanceCost),
          netPL: round2(room.hostEarnings - maintenanceCost),
        };
      });
      const roomsWithCollections = rooms.filter((r) => r.gross > 0).length;
      const sumDues = rooms.reduce((a, r) => a + r.gross, 0);
      const avgRent = roomsWithCollections > 0 ? sumDues / roomsWithCollections : 0;
      const collectionRate = p.billedDues > 0 ? (p.collectedDues / p.billedDues) * 100 : null;
      const occupancyRate = propTotalDays > 0
        ? Math.max(0, Math.min(100, ((propTotalDays - propVacancyDays) / propTotalDays) * 100))
        : null;
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
        occupancyRate: occupancyRate != null ? round2(occupancyRate) : null,
        vacancy: round2(propVacancyCost),
        vacantDays: propVacancyDays,
        lateFees: round2(p.lateFees),
        avgRentPerRoom: round2(avgRent),
        turnoversThisMonth: turnoversThisMonthByProperty[p.propertyKey] || 0,
        maintenanceCost: round2(p.propertyId ? (maintByProperty[p.propertyId] || 0) : 0),
        rooms,
      };
    });
    propertyBreakdown.sort((a, b) => (b.hostEarnings || 0) - (a.hostEarnings || 0));

    // Portfolio vacancy = sum of per-property vacancy.
    const totalVacancyCost = propertyBreakdown.reduce((s, p) => s + (p.vacancy || 0), 0);
    const totalVacantDays = propertyBreakdown.reduce((s, p) => s + (p.vacantDays || 0), 0);

    // Month-over-month trend deltas for portfolio cards
    let trends = null;
    if (month && month !== 'all') {
      const prev = monthBefore(month);
      const prevRecords = await prisma.financialRecord.findMany({
        where: { organizationId: orgId, earningsMonth: prev },
      });
      let pCollected = 0, pFees = 0, pHost = 0;
      for (const r of prevRecords) {
        if (r.recordType === 'COLLECTED') {
          pCollected += r.grossAmount || 0;
          pFees += Math.abs(r.bookingFee || 0) + Math.abs(r.serviceFee || 0) + Math.abs(r.transactionFee || 0);
          pHost += r.hostEarnings || 0;
        }
      }

      // Prior-month vacancy via the same model: sum of per-room
      // (typicalRent - collected) across all rooms in the org.
      let pVacancy = 0;
      const prevRoomKeys = new Set();
      for (const r of allCollectedHistory) {
        if (!isDuesBillType(r.billType)) continue;
        const roomKey = (r.roomNumber || r.roomId || '').toString().trim();
        if (!roomKey) continue;
        const norm = normalizeAddress(r.propertyAddress) || 'unknown';
        prevRoomKeys.add(`${norm}|${roomKey}`);
      }
      for (const k of prevRoomKeys) {
        const [norm, roomKey] = k.split('|');
        const typicalRent = typicalRentByRoom[k] || 0;
        const fallback = fallbackRentByProperty[norm] || 0;
        const collectedThisMonth = collectedByRoomMonth[`${norm}|${roomKey}|${prev}`] || 0;
        const v = vacancyForRoom({
          propertyKey: norm,
          roomKey,
          monthStr: prev,
          collectedThisMonth,
          typicalRent,
          fallbackRent: fallback,
        });
        pVacancy += v.vacancyCost;
      }

      trends = {
        collected: deltaPct(totalCollected, pCollected),
        fees: deltaPct(totalPlatformFees, pFees),
        hostEarnings: deltaPct(totalHostEarnings, pHost),
        vacancy: deltaPct(totalVacancyCost, pVacancy),
      };
    }

    return res.json({
      month,
      totals: {
        collected: round2(totalCollected),
        platformFees: round2(totalPlatformFees),
        hostEarnings: round2(totalHostEarnings),
        vacancy: round2(totalVacancyCost),
        vacantDays: totalVacantDays,
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
      where: { organizationId: orgId, recordType: 'COLLECTED' },
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

    // Auto-fuzzy match unmapped addresses for nicer chart labels.
    const distinctAddrs = [...new Set(records.map((r) => r.propertyAddress).filter(Boolean))];
    for (const addr of distinctAddrs) {
      const norm = normalizeAddress(addr);
      if (mappingByAddr[norm]) continue;
      let bestId = null;
      let bestScore = 0;
      for (const p of properties) {
        const s = matchScore(addr, p);
        if (s > bestScore) { bestScore = s; bestId = p.id; }
      }
      if (bestScore >= 1 && bestId) mappingByAddr[norm] = bestId;
    }

    // Bucket by normalized address — chart shows every property with
    // data, matched or not.
    const buckets = {};
    const labelByKey = {};
    const monthsSet = new Set();
    for (const r of records) {
      const norm = normalizeAddress(r.propertyAddress) || 'unknown';
      const propId = mappingByAddr[norm];
      const label = propId ? (propertyById[propId]?.name || r.propertyAddress) : (r.propertyAddress || 'Unknown');
      labelByKey[norm] = label;
      monthsSet.add(r.earningsMonth);
      if (!buckets[norm]) buckets[norm] = {};
      if (!buckets[norm][r.earningsMonth]) {
        buckets[norm][r.earningsMonth] = { gross: 0, fees: 0, host: 0 };
      }
      const b = buckets[norm][r.earningsMonth];
      b.gross += r.grossAmount || 0;
      b.fees += Math.abs(r.bookingFee || 0) + Math.abs(r.serviceFee || 0) + Math.abs(r.transactionFee || 0);
      b.host += r.hostEarnings || 0;
    }

    const months = [...monthsSet].sort();
    const series = Object.keys(buckets).map((key) => ({
      propertyId: mappingByAddr[key] || null,
      propertyName: labelByKey[key] || key,
      points: months.map((m) => ({
        month: m,
        gross: round2(buckets[key][m]?.gross || 0),
        fees: round2(buckets[key][m]?.fees || 0),
        host: round2(buckets[key][m]?.host || 0),
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
          recordType: 'COLLECTED',
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
      if (last3.includes(r.earningsMonth) && isDuesBillType(r.billType)) {
        byProp[propId].collectedDues += r.grossAmount || 0;
      }
    }
    for (const r of billedRecords) {
      const propId = mappingByAddr[normalizeAddress(r.propertyAddress)];
      if (!propId) continue;
      if (!byProp[propId]) byProp[propId] = { monthly: {}, billedDues: 0, collectedDues: 0 };
      if (isDuesBillType(r.billType) || isDuesBillType(r.transactionReason)) {
        byProp[propId].billedDues += Math.abs(r.grossAmount || 0);
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

// PadSplit categorizes membership rent under several labels — match
// loosely so we don't miss any.
function isDuesBillType(v) {
  if (!v) return false;
  const s = String(v).toLowerCase();
  return s.includes('membership') || s.includes('rent') || s.includes('dues');
}

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

function daysInMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  // Day 0 of next month = last day of current month.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
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
