import { Router } from 'express';
import PDFDocument from 'pdfkit';
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
        recordDate: r.recordDate ? new Date(r.recordDate) : null,
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
          memberId: true,
          memberName: true,
          billType: true,
          grossAmount: true,
          bookingFee: true,
          recordDate: true,
        },
      }),
      prisma.padSplitPropertyMapping.findMany({ where: { organizationId: orgId } }),
      prisma.property.findMany({
        where: { organizationId: orgId, deletedAt: null },
        select: {
          id: true,
          name: true,
          address: true,
          metroArea: true,
          rooms: {
            where: { deletedAt: null },
            select: { id: true, label: true, features: true },
          },
        },
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
      // Skip address-less rows (PadSplit puts platform-level adjustments
      // here) — they shouldn't surface as a phantom "Unknown" property.
      if (!r.propertyAddress || String(r.propertyAddress).trim() === '') continue;
      const addr = r.propertyAddress;
      const key = normalizeAddress(addr) || 'unknown';
      if (key === 'unknown') continue;
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

    // Typical DAILY rate per (normalized address, room number).
    // PadSplit prorates per day, so a room that earns $25/day collects
    // $700 in a 28-day month and $775 in a 31-day month — both fully
    // occupied. We normalize each month's collection by daysInMonth so
    // varying month lengths don't show up as phantom vacancy.
    const typicalDailyRateByRoom = (() => {
      const monthlyTotals = {}; // key = "addr|room|month" → membership dues
      for (const r of allCollectedHistory) {
        if (!isDuesBillType(r.billType)) continue;
        const roomKey = (r.roomNumber || r.roomId || '').toString().trim();
        if (!roomKey) continue;
        const norm = normalizeAddress(r.propertyAddress) || 'unknown';
        const k = `${norm}|${roomKey}|${r.earningsMonth}`;
        monthlyTotals[k] = (monthlyTotals[k] || 0) + (r.grossAmount || 0);
      }
      const totalsByRoom = {}; // "addr|room" → { sumDaily, count }
      for (const k of Object.keys(monthlyTotals)) {
        const v = monthlyTotals[k];
        if (v <= 0) continue;
        const [norm, room, month] = k.split('|');
        const roomKey = `${norm}|${room}`;
        const dim = daysInMonth(month) || 30;
        const dailyForMonth = v / dim;
        if (!totalsByRoom[roomKey]) totalsByRoom[roomKey] = { sumDaily: 0, count: 0 };
        totalsByRoom[roomKey].sumDaily += dailyForMonth;
        totalsByRoom[roomKey].count += 1;
      }
      const out = {};
      for (const k of Object.keys(totalsByRoom)) {
        out[k] = totalsByRoom[k].sumDaily / totalsByRoom[k].count;
      }
      return out;
    })();

    // Property-level fallback daily rate for rooms with no history yet.
    const fallbackDailyRateByProperty = (() => {
      const sums = {};
      for (const k of Object.keys(typicalDailyRateByRoom)) {
        const [norm] = k.split('|');
        if (!sums[norm]) sums[norm] = { sum: 0, count: 0 };
        sums[norm].sum += typicalDailyRateByRoom[k];
        sums[norm].count += 1;
      }
      const out = {};
      for (const norm of Object.keys(sums)) {
        out[norm] = sums[norm].count > 0 ? sums[norm].sum / sums[norm].count : 0;
      }
      return out;
    })();

    // ─── Occupancy intervals per room ─────────────────────
    // Filters out REJECTED members (those whose net collected per
    // month is <= 0 — meaning their full payment was reversed because
    // the host didn't accept them). Only ACTUAL OCCUPANTS contribute
    // to vacancy + turnover calculations.
    //
    // Per (norm address, room): build a sorted list of intervals
    //   { memberId, firstDate, lastDate, positiveMonths: Set<month> }
    // where firstDate / lastDate are the earliest / latest Created
    // dates among the member's positive-net months.
    const occupancyByRoom = {};
    const memberLabelByRoom = {}; // for resident-name display per (room, month)
    const allRoomKeysByProperty = {}; // norm → Set<roomKey> for "include vacant rooms"
    const roomFirstMonth = {}; // "norm|room" → earliest earningsMonth that has ANY record
    {
      const grouped = {}; // "norm|room" → memberId → month → { net, firstDate, lastDate, name }
      for (const r of allCollectedHistory) {
        // Skip rows with no usable property address — those become the
        // "Unknown" bucket which we don't want to surface as a property.
        if (!r.propertyAddress || String(r.propertyAddress).trim() === '') continue;
        const memberId = (r.memberId || '').toString().trim();
        if (!memberId) continue;
        const roomKey = (r.roomNumber || r.roomId || '').toString().trim();
        if (!roomKey) continue;
        const norm = normalizeAddress(r.propertyAddress) || 'unknown';
        if (norm === 'unknown') continue;
        const k = `${norm}|${roomKey}`;
        if (!allRoomKeysByProperty[norm]) allRoomKeysByProperty[norm] = new Set();
        allRoomKeysByProperty[norm].add(roomKey);
        if (!roomFirstMonth[k] || r.earningsMonth < roomFirstMonth[k]) {
          roomFirstMonth[k] = r.earningsMonth;
        }
        if (!grouped[k]) grouped[k] = {};
        if (!grouped[k][memberId]) grouped[k][memberId] = {};
        if (!grouped[k][memberId][r.earningsMonth]) {
          grouped[k][memberId][r.earningsMonth] = {
            net: 0, firstDate: null, lastDate: null,
            firstPositiveDate: null, lastPositiveDate: null,
            name: r.memberName || null,
          };
        }
        const slot = grouped[k][memberId][r.earningsMonth];
        // Sum across ALL bill types so reversals (which may carry a
        // different bill type than the original payment) cancel out and
        // mark the member as REJECTED (net <= 0).
        slot.net += (r.grossAmount || 0);
        if (r.memberName && !slot.name) slot.name = r.memberName;
        const d = r.recordDate ? new Date(r.recordDate) : null;
        if (d && !isNaN(d.getTime())) {
          if (!slot.firstDate || d < slot.firstDate) slot.firstDate = d;
          if (!slot.lastDate || d > slot.lastDate) slot.lastDate = d;
          // Track positive-only dates separately so we can use the
          // actual move-in date (first positive) and last positive
          // payment date as occupancy boundaries — reversal entries
          // shouldn't count as "presence".
          if ((r.grossAmount || 0) > 0) {
            if (!slot.firstPositiveDate || d < slot.firstPositiveDate) slot.firstPositiveDate = d;
            if (!slot.lastPositiveDate || d > slot.lastPositiveDate) slot.lastPositiveDate = d;
          }
        }
      }

      for (const k of Object.keys(grouped)) {
        const memberMonths = grouped[k];
        const intervals = [];
        const namesByMonth = {}; // month → memberName (the actual occupant for that month)
        // ── DEBUG: log Meadowchase Room 4 to confirm "first occupant ≠ turnover".
      // Strip after verifying.
      const isDbgRoom = k.toLowerCase().includes('meadowchase') && k.endsWith('|4');
      if (isDbgRoom) {
        console.log(`[fin-tt-debug] ROOM=${k} memberMonths:`);
        for (const memberId of Object.keys(memberMonths)) {
          for (const month of Object.keys(memberMonths[memberId])) {
            const m = memberMonths[memberId][month];
            console.log(
              `[fin-tt-debug]   member=${memberId} (${m.name || '?'}) month=${month} net=${m.net.toFixed(4)} ` +
              `→ ${Math.round(m.net * 100) / 100 > 1 ? 'ACTUAL' : 'rejected'}`,
            );
          }
        }
      }

      for (const memberId of Object.keys(memberMonths)) {
          const months = memberMonths[memberId];
          let firstDate = null, lastDate = null;
          let memberName = null;
          const positiveMonths = new Set();
          for (const month of Object.keys(months)) {
            const m = months[month];
            if (!memberName && m.name) memberName = m.name;
            // Member-month is an actual occupancy iff net is meaningfully
            // positive AFTER reversals. Round to cents to ignore floating
            // point artifacts ($0.01 from 199.68 - 199.679999...) and
            // require >$1 so trivial residuals (small admin fees not
            // fully reversed) don't count as a real occupant. Use
            // POSITIVE-row dates for the move-in / move-out approximation
            // — reversal entries shouldn't extend the occupancy window.
            const netRounded = Math.round(m.net * 100) / 100;
            if (netRounded > 1) {
              positiveMonths.add(month);
              const fd = m.firstPositiveDate || m.firstDate;
              const ld = m.lastPositiveDate || m.lastDate;
              if (fd && (!firstDate || fd < firstDate)) firstDate = fd;
              if (ld && (!lastDate || ld > lastDate)) lastDate = ld;
              namesByMonth[month] = m.name || memberName;
            }
          }
          if (positiveMonths.size === 0) continue; // rejected for every month
          // Fallback dates when recordDate is missing on legacy data —
          // assume the member was present for the full extent of their
          // earliest / latest positive month.
          if (!firstDate) {
            const earliest = [...positiveMonths].sort()[0];
            const [y, m] = earliest.split('-').map(Number);
            firstDate = new Date(Date.UTC(y, m - 1, 1));
          }
          if (!lastDate) {
            const latest = [...positiveMonths].sort().pop();
            const [y, m] = latest.split('-').map(Number);
            lastDate = new Date(Date.UTC(y, m - 1, daysInMonth(latest)));
          }
          intervals.push({
            memberId,
            memberName,
            firstDate,
            lastDate,
            positiveMonths,
          });
        }
        intervals.sort((a, b) => a.firstDate - b.firstDate);
        if (isDbgRoom) {
          console.log(`[fin-tt-debug]   intervals: ${intervals.length}`);
          for (const i of intervals) {
            console.log(`[fin-tt-debug]     ${i.memberId} (${i.memberName || '?'}) [${i.firstDate.toISOString().slice(0, 10)} → ${i.lastDate.toISOString().slice(0, 10)}]`);
          }
        }
        occupancyByRoom[k] = intervals;
        memberLabelByRoom[k] = namesByMonth;
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

    // Per-member total booking fee — used to detect host referrals
    // (members whose booking fee is $0 don't trigger a 10-day fee on
    // turnover).
    const bookingFeeByMember = {};
    for (const r of allCollectedHistory) {
      if (!r.memberId) continue;
      bookingFeeByMember[r.memberId] = (bookingFeeByMember[r.memberId] || 0) + (r.bookingFee || 0);
    }

    // Turnover tracker — uses occupancyByRoom (rejected members already
    // filtered out). A turnover is a transition between two consecutive
    // ACTUAL OCCUPANTS in the same room.
    const CLEANING_FEE_PER_TURN = 50;
    const BOOKING_FEE_DAYS = 10;
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const allDataMonths = [...new Set(allCollectedHistory.map((r) => r.earningsMonth))].sort();
    const latestDataMonth = allDataMonths[allDataMonths.length - 1] || null;
    const turnoverList = Object.keys(occupancyByRoom).map((k) => {
      const intervals = occupancyByRoom[k];
      const [norm, roomKey] = k.split('|');
      const propId = mappingByAddr[norm];
      const propertyName = propId
        ? (propertyById[propId]?.name || norm)
        : (allCollectedHistory.find((r) => (normalizeAddress(r.propertyAddress) || 'unknown') === norm)?.propertyAddress || norm);

      // Distinct sequential members → count of memberId changes.
      let turnovers = 0;
      const seenMembers = new Set();
      for (let i = 0; i < intervals.length; i++) {
        seenMembers.add(intervals[i].memberId);
        if (i > 0 && intervals[i].memberId !== intervals[i - 1].memberId) turnovers += 1;
      }

      // Per-room turnover cost = vacancy + booking fee + cleaning, summed
      // across each transition between consecutive different occupants.
      const dailyRate = typicalDailyRateByRoom[k]
        || fallbackDailyRateByProperty[norm]
        || 0;
      let turnoverCostTotal = 0;
      let turnoverVacantDays = 0;
      for (let i = 1; i < intervals.length; i++) {
        const prev = intervals[i - 1];
        const cur = intervals[i];
        if (cur.memberId === prev.memberId) continue;
        const lastOut = prev.lastPositiveDate || prev.lastDate;
        const firstIn = cur.firstPositiveDate || cur.firstDate;
        let vacantDays = 0;
        if (lastOut && firstIn) {
          vacantDays = Math.max(0, Math.round((firstIn - lastOut) / MS_PER_DAY) - 1);
        }
        turnoverVacantDays += vacantDays;
        const vacancyCost = vacantDays * dailyRate;
        // Host referrals = members who never paid a booking fee. Skip the
        // 10-day platform booking fee for those turns.
        const bookingFeeAmount = (bookingFeeByMember[cur.memberId] || 0) > 0
          ? BOOKING_FEE_DAYS * dailyRate
          : 0;
        turnoverCostTotal += vacancyCost + bookingFeeAmount + CLEANING_FEE_PER_TURN;
      }

      // Months of occupancy = union of all positiveMonths sets.
      const occupiedMonths = new Set();
      for (const i of intervals) {
        for (const m of i.positiveMonths) occupiedMonths.add(m);
      }
      const avgTenure = occupiedMonths.size / Math.max(1, turnovers + 1);

      // Months of data observable for this room: from its first month
      // through the latest month in the dataset (so a room with 15
      // months of history annualizes 3 turnovers as 3/15*12 = 2.4/yr).
      const fm = roomFirstMonth[k];
      const monthsOfData = (fm && latestDataMonth)
        ? Math.max(1, monthsBetween(fm, latestDataMonth))
        : 1;
      const annualized = (turnovers / monthsOfData) * 12;
      const annualizedCost = (turnoverCostTotal / monthsOfData) * 12;

      return {
        propertyId: propId || null,
        propertyName,
        roomNumber: roomKey,
        turnovers,
        memberCount: seenMembers.size,
        avgTenureMonths: Number(avgTenure.toFixed(2)),
        monthsOfData,
        annualizedTurnovers: Number(annualized.toFixed(2)),
        turnoverCostTotal: Number(turnoverCostTotal.toFixed(2)),
        turnoverVacantDays,
        annualizedTurnoverCost: Number(annualizedCost.toFixed(2)),
      };
    });
    turnoverList.sort((a, b) => b.annualizedTurnovers - a.annualizedTurnovers);

    // (Turnovers-this-month is computed inline per-room in the
    // property breakdown below using the occupancy intervals — no
    // separate prior-month query needed.)

    // Vacancy computation. PadSplit only bills when a room is occupied,
    // so "billed - collected" misses true vacancy. Instead we use each
    // room's typical DAILY rate (collected / daysInMonth, averaged
    // across months with revenue) so 28- vs 31-day months don't
    // register as phantom vacancy.
    //
    //   typicalDailyRate = avg of (collected_month / daysInMonth_month)
    //                       over months where the room collected > $0
    //   expected_month   = typicalDailyRate * daysInMonth(month)
    //   ratio            = collected_month / expected_month
    //   vacantFraction   = ratio >= OCCUPIED_THRESHOLD ? 0 : (1 - ratio)
    //   vacantDays       = round(daysInMonth * vacantFraction)
    //   vacancyCost      = typicalDailyRate * vacantDays
    //
    // For "all time" we sum the per-month per-room vacancy across history.

    // For "all time", per-room vacancy aggregates across all months.
    const isAllTime = !month || month === 'all';
    const allMonthsForVacancy = isAllTime
      ? [...new Set(allCollectedHistory.map((r) => r.earningsMonth))].sort()
      : [month];

    // Finalize property breakdowns. We backfill rooms that have ever
    // had history but no records in the current month so we can still
    // count their vacancy. Rooms whose first-ever data is AFTER the
    // selected month are hidden — they didn't exist yet.
    const selectedMonthForVisibility = (month && month !== 'all') ? month : null;
    function roomVisibleInScope(rentKey) {
      if (!selectedMonthForVisibility) return true; // all-time shows everything
      const fm = roomFirstMonth[rentKey];
      if (!fm) return false; // never had any data
      return fm <= selectedMonthForVisibility;
    }

    for (const p of Object.values(byProperty)) {
      const everSeen = allRoomKeysByProperty[p.propertyKey] || new Set();
      for (const roomKey of everSeen) {
        const rentKey = `${p.propertyKey}|${roomKey}`;
        if (!roomVisibleInScope(rentKey)) continue;
        if (!p.rooms[roomKey]) {
          p.rooms[roomKey] = {
            roomNumber: roomKey,
            roomId: null,
            residentName: null,
            residentMemberId: null,
            gross: 0, lateFees: 0, bookingFee: 0, serviceFee: 0,
            transactionFee: 0, hostEarnings: 0, billed: 0,
            memberIds: new Set(),
            lastSeen: null,
          };
        }
      }
      // Drop any rooms that snuck in but aren't visible in this scope
      // (shouldn't happen since enriched-loop already filters by month,
      // but belt-and-suspenders).
      for (const roomKey of Object.keys(p.rooms)) {
        const rentKey = `${p.propertyKey}|${roomKey}`;
        if (!roomVisibleInScope(rentKey)) delete p.rooms[roomKey];
      }
    }

    // Make sure every property that has historical data shows up too
    // — even if the selected month has no records at all (fully vacant).
    for (const norm of Object.keys(allRoomKeysByProperty)) {
      if (byProperty[norm]) continue;
      // If none of the property's rooms are visible in scope, skip the
      // whole property too.
      const visibleRooms = [...allRoomKeysByProperty[norm]]
        .filter((rk) => roomVisibleInScope(`${norm}|${rk}`));
      if (visibleRooms.length === 0) continue;
      const propId = mappingByAddr[norm];
      const matchedProp = propId ? propertyById[propId] : null;
      // Recover an address label if we have one in history.
      let labelAddr = norm;
      for (const r of allCollectedHistory) {
        if ((normalizeAddress(r.propertyAddress) || 'unknown') === norm && r.propertyAddress) {
          labelAddr = r.propertyAddress;
          break;
        }
      }
      byProperty[norm] = {
        propertyKey: norm,
        propertyId: propId || null,
        property: matchedProp,
        padsplitAddress: labelAddr,
        gross: 0, bookingFee: 0, serviceFee: 0, transactionFee: 0,
        hostEarnings: 0, billedDues: 0, collectedDues: 0, lateFees: 0,
        rooms: {},
        memberIds: new Set(),
      };
      for (const roomKey of visibleRooms) {
        byProperty[norm].rooms[roomKey] = {
          roomNumber: roomKey, roomId: null,
          residentName: null, residentMemberId: null,
          gross: 0, lateFees: 0, bookingFee: 0, serviceFee: 0,
          transactionFee: 0, hostEarnings: 0, billed: 0,
          memberIds: new Set(), lastSeen: null,
        };
      }
    }

    const propertyBreakdown = Object.values(byProperty).map((p) => {
      const propKeyForFallback = p.propertyKey;
      const fallbackDailyRate = fallbackDailyRateByProperty[propKeyForFallback] || 0;
      let propVacancyDays = 0;
      let propVacancyCost = 0;
      let propTotalDays = 0;
      let propTurnoversThisMonth = 0;

      const rooms = Object.values(p.rooms).map((room) => {
        const maintenanceCost = maintByRoom[room.roomId] || 0;
        const roomKey = (room.roomNumber || room.roomId || '').toString().trim();
        const rentKey = `${propKeyForFallback}|${roomKey}`;
        const typicalDailyRate = typicalDailyRateByRoom[rentKey] || 0;
        const dailyRate = typicalDailyRate || fallbackDailyRate;
        const intervals = occupancyByRoom[rentKey] || [];
        const firstMonth = roomFirstMonth[rentKey];

        // Sum vacancy + turnovers across all months in scope.
        let vacantDaysTotal = 0;
        let totalDaysTotal = 0;
        let turnoversTotal = 0;
        let turnoverInSelectedMonth = false;
        for (const m of allMonthsForVacancy) {
          if (firstMonth && m < firstMonth) continue; // before room existed
          const vd = vacantDaysInMonthForRoom(intervals, m, firstMonth);
          vacantDaysTotal += vd;
          totalDaysTotal += daysInMonth(m);
          const tn = turnoversInMonthForRoom(intervals, m);
          turnoversTotal += tn;
          if (tn > 0) turnoverInSelectedMonth = true;
        }
        const vacancyCostTotal = dailyRate * vacantDaysTotal;
        const residentName = (() => {
          // Pick the actual occupant for the selected month (or latest in scope).
          if (intervals.length === 0) return null;
          if (allMonthsForVacancy.length === 1) {
            const m = allMonthsForVacancy[0];
            const names = memberLabelByRoom[rentKey] || {};
            if (names[m]) return names[m];
            return null;
          }
          // All-time view: most recent occupant's name.
          return intervals[intervals.length - 1].memberName || null;
        })();

        propVacancyDays += vacantDaysTotal;
        propVacancyCost += vacancyCostTotal;
        propTotalDays += totalDaysTotal;
        propTurnoversThisMonth += turnoversTotal;
        room.turnover = turnoverInSelectedMonth;
        room.residentName = residentName;

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
          typicalRent: round2(dailyRate * 30),
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

      // Room insight metrics — match PadSplit rooms to RoomReport rooms
      // so we can split private-bath / shared-bath averages by feature.
      const rrRooms = p.property?.rooms || [];
      const hasFeatureData = rrRooms.some(
        (r) => Array.isArray(r.features) && r.features.length > 0,
      );
      const isEnsuite = (label) => {
        const rr = rrRooms.find((r) => {
          const rl = String(r.label || '').toLowerCase().trim();
          const pl = String(label || '').toLowerCase().trim();
          return rl === pl
            || rl === `room ${pl}`
            || rl === `rm ${pl}`
            || rl.replace(/^room\s+/, '') === pl;
        });
        if (!rr || !Array.isArray(rr.features)) return null;
        return rr.features.some((f) => /ensuite|private bath/i.test(String(f)));
      };
      let privateSum = 0; let privateCount = 0;
      let sharedSum = 0; let sharedCount = 0;
      for (const room of rooms) {
        if (!(room.gross > 0)) continue;
        const ens = isEnsuite(room.roomNumber);
        if (ens === true) { privateSum += room.gross; privateCount += 1; }
        else if (ens === false) { sharedSum += room.gross; sharedCount += 1; }
      }
      const avgPrivateBathRent = privateCount > 0 ? privateSum / privateCount : null;
      const avgSharedBathRent = sharedCount > 0 ? sharedSum / sharedCount : null;

      // Avg tenure — for each room's CURRENT occupant (last interval),
      // months from their firstPositiveDate to today.
      const today = new Date();
      const tenureMonths = [];
      for (const roomKey of Object.keys(p.rooms)) {
        const intervals = occupancyByRoom[`${propKeyForFallback}|${roomKey}`] || [];
        if (intervals.length === 0) continue;
        const cur = intervals[intervals.length - 1];
        const start = cur.firstPositiveDate || cur.firstDate;
        if (!start) continue;
        const months = (today - start) / (1000 * 60 * 60 * 24 * 30.4375);
        if (months > 0 && Number.isFinite(months)) tenureMonths.push(months);
      }
      const avgTenureMonths = tenureMonths.length > 0
        ? tenureMonths.reduce((a, b) => a + b, 0) / tenureMonths.length
        : null;

      // Avg days to fill — across all turnovers in this property,
      // mean of vacant days between consecutive different occupants.
      const fillGaps = [];
      for (const roomKey of Object.keys(p.rooms)) {
        const intervals = occupancyByRoom[`${propKeyForFallback}|${roomKey}`] || [];
        for (let i = 1; i < intervals.length; i++) {
          const a = intervals[i - 1];
          const b = intervals[i];
          if (a.memberId === b.memberId) continue;
          const out = a.lastPositiveDate || a.lastDate;
          const inn = b.firstPositiveDate || b.firstDate;
          if (!out || !inn) continue;
          const days = Math.max(0, Math.round((inn - out) / (1000 * 60 * 60 * 24)) - 1);
          fillGaps.push(days);
        }
      }
      const avgDaysToFill = fillGaps.length > 0
        ? fillGaps.reduce((a, b) => a + b, 0) / fillGaps.length
        : null;

      return {
        propertyId: p.propertyId,
        propertyName: p.property?.name || p.padsplitAddress,
        metroArea: p.property?.metroArea || null,
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
        roomDays: propTotalDays,
        lateFees: round2(p.lateFees),
        avgRentPerRoom: round2(avgRent),
        avgPrivateBathRent: avgPrivateBathRent != null ? round2(avgPrivateBathRent) : null,
        avgSharedBathRent: avgSharedBathRent != null ? round2(avgSharedBathRent) : null,
        avgTenureMonths: avgTenureMonths != null ? Number(avgTenureMonths.toFixed(1)) : null,
        avgDaysToFill: avgDaysToFill != null ? Math.round(avgDaysToFill) : null,
        hasFeatureData,
        turnoversThisMonth: propTurnoversThisMonth,
        maintenanceCost: round2(p.propertyId ? (maintByProperty[p.propertyId] || 0) : 0),
        rooms,
      };
    });
    propertyBreakdown.sort((a, b) => (b.hostEarnings || 0) - (a.hostEarnings || 0));

    // Portfolio vacancy = sum of per-property vacancy.
    const totalVacancyCost = propertyBreakdown.reduce((s, p) => s + (p.vacancy || 0), 0);
    const totalVacantDays = propertyBreakdown.reduce((s, p) => s + (p.vacantDays || 0), 0);
    const totalRoomDays = propertyBreakdown.reduce((s, p) => s + (p.roomDays || 0), 0);
    const totalTurnovers = propertyBreakdown.reduce((s, p) => s + (p.turnoversThisMonth || 0), 0);
    const portfolioOccupancy = totalRoomDays > 0
      ? Math.max(0, Math.min(100, ((totalRoomDays - totalVacantDays) / totalRoomDays) * 100))
      : null;

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

      // Prior-month vacancy: sum vacancy days × daily rate per room
      // using the same occupancy-interval model.
      let pVacancy = 0;
      let pVacantDays = 0;
      let pRoomDays = 0;
      let pTurnovers = 0;
      const prevDim = daysInMonth(prev);
      for (const k of Object.keys(occupancyByRoom)) {
        const [norm] = k.split('|');
        const fm = roomFirstMonth[k];
        if (fm && prev < fm) continue; // room didn't exist in prev month
        const typicalDailyRate = typicalDailyRateByRoom[k] || 0;
        const fallbackDailyRate = fallbackDailyRateByProperty[norm] || 0;
        const dailyRate = typicalDailyRate || fallbackDailyRate;
        const vd = vacantDaysInMonthForRoom(occupancyByRoom[k], prev, fm);
        pVacancy += dailyRate * vd;
        pVacantDays += vd;
        pRoomDays += prevDim;
        pTurnovers += turnoversInMonthForRoom(occupancyByRoom[k], prev);
      }
      const pOccupancy = pRoomDays > 0
        ? Math.max(0, Math.min(100, ((pRoomDays - pVacantDays) / pRoomDays) * 100))
        : null;

      trends = {
        collected: deltaPct(totalCollected, pCollected),
        fees: deltaPct(totalPlatformFees, pFees),
        hostEarnings: deltaPct(totalHostEarnings, pHost),
        vacancy: deltaPct(totalVacancyCost, pVacancy),
        occupancy: pOccupancy != null && portfolioOccupancy != null
          ? round2(portfolioOccupancy - pOccupancy) // pp delta, not pct
          : null,
        turnovers: deltaPct(totalTurnovers, pTurnovers),
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
        roomDays: totalRoomDays,
        occupancy: portfolioOccupancy != null ? round2(portfolioOccupancy) : null,
        turnovers: totalTurnovers,
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
    const [records, mappings, properties, maintenance] = await Promise.all([
      prisma.financialRecord.findMany({
        where: { organizationId: orgId, recordType: 'COLLECTED' },
        select: {
          propertyAddress: true,
          earningsMonth: true,
          memberId: true,
          roomNumber: true,
          roomId: true,
          billType: true,
          grossAmount: true,
          bookingFee: true,
          serviceFee: true,
          transactionFee: true,
          hostEarnings: true,
          recordDate: true,
        },
      }),
      prisma.padSplitPropertyMapping.findMany({ where: { organizationId: orgId } }),
      prisma.property.findMany({
        where: { organizationId: orgId, deletedAt: null },
        select: { id: true, name: true, metroArea: true },
      }),
      prisma.maintenanceItem.findMany({
        where: { organizationId: orgId, deletedAt: null, actualCost: { not: null } },
        select: { propertyId: true, actualCost: true, createdAt: true },
      }),
    ]);
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

    // Bucket by normalized address — skip Unknown / address-less rows.
    const buckets = {};
    const labelByKey = {};
    const monthsSet = new Set();
    // Per-room first-month + occupancy intervals so we can compute
    // occupancy %, turnovers per month, and rooms-onboarded curves.
    const roomFirstMonth = {}; // "norm|room" → first month
    const roomGroup = {};      // "norm|room" → memberId → month → { net, firstPos, lastPos }
    const allRoomsByProperty = {}; // "norm" → Set<roomKey>

    for (const r of records) {
      if (!r.propertyAddress || String(r.propertyAddress).trim() === '') continue;
      const norm = normalizeAddress(r.propertyAddress);
      if (!norm || norm === 'unknown') continue;
      const propId = mappingByAddr[norm];
      const label = propId ? (propertyById[propId]?.name || r.propertyAddress) : r.propertyAddress;
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

      // Rooms tracking
      const roomKey = (r.roomNumber || r.roomId || '').toString().trim();
      if (roomKey) {
        if (!allRoomsByProperty[norm]) allRoomsByProperty[norm] = new Set();
        allRoomsByProperty[norm].add(roomKey);
        const k = `${norm}|${roomKey}`;
        if (!roomFirstMonth[k] || r.earningsMonth < roomFirstMonth[k]) {
          roomFirstMonth[k] = r.earningsMonth;
        }
        const memberId = (r.memberId || '').toString().trim();
        if (memberId) {
          if (!roomGroup[k]) roomGroup[k] = {};
          if (!roomGroup[k][memberId]) roomGroup[k][memberId] = {};
          if (!roomGroup[k][memberId][r.earningsMonth]) {
            roomGroup[k][memberId][r.earningsMonth] = { net: 0, firstPos: null, lastPos: null };
          }
          const slot = roomGroup[k][memberId][r.earningsMonth];
          slot.net += (r.grossAmount || 0);
          if ((r.grossAmount || 0) > 0 && r.recordDate) {
            const d = new Date(r.recordDate);
            if (!isNaN(d.getTime())) {
              if (!slot.firstPos || d < slot.firstPos) slot.firstPos = d;
              if (!slot.lastPos || d > slot.lastPos) slot.lastPos = d;
            }
          }
        }
      }
    }

    // Build occupancy intervals per room (filtering rejected members).
    const occupancyByRoom = {};
    for (const k of Object.keys(roomGroup)) {
      const intervals = [];
      const members = roomGroup[k];
      for (const memberId of Object.keys(members)) {
        const monthsForMember = members[memberId];
        let firstDate = null, lastDate = null;
        const positiveMonths = new Set();
        for (const month of Object.keys(monthsForMember)) {
          const slot = monthsForMember[month];
          if (slot.net > 0) {
            positiveMonths.add(month);
            if (slot.firstPos && (!firstDate || slot.firstPos < firstDate)) firstDate = slot.firstPos;
            if (slot.lastPos && (!lastDate || slot.lastPos > lastDate)) lastDate = slot.lastPos;
          }
        }
        if (positiveMonths.size === 0) continue;
        if (!firstDate) {
          const earliest = [...positiveMonths].sort()[0];
          const [y, m] = earliest.split('-').map(Number);
          firstDate = new Date(Date.UTC(y, m - 1, 1));
        }
        if (!lastDate) {
          const latest = [...positiveMonths].sort().pop();
          const [y, m] = latest.split('-').map(Number);
          lastDate = new Date(Date.UTC(y, m - 1, daysInMonth(latest)));
        }
        intervals.push({ memberId, firstDate, lastDate, positiveMonths });
      }
      intervals.sort((a, b) => a.firstDate - b.firstDate);
      occupancyByRoom[k] = intervals;
    }

    // Maintenance per (propertyId, month).
    const maintByPropMonth = {};
    for (const m of maintenance) {
      if (!m.propertyId) continue;
      const d = m.createdAt ? new Date(m.createdAt) : null;
      if (!d || isNaN(d)) continue;
      const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const k = `${m.propertyId}|${month}`;
      maintByPropMonth[k] = (maintByPropMonth[k] || 0) + (m.actualCost || 0);
    }

    const months = [...monthsSet].sort();
    const series = Object.keys(buckets).map((key) => {
      const propId = mappingByAddr[key] || null;
      const rooms = [...(allRoomsByProperty[key] || [])];
      // Sort rooms by their first month so the cumulative curve is monotonic.
      const roomFirsts = rooms.map((rk) => roomFirstMonth[`${key}|${rk}`]).filter(Boolean).sort();

      const points = months.map((m) => {
        // Money/host
        const b = buckets[key][m] || { gross: 0, fees: 0, host: 0 };

        // Occupancy %: across all rooms in this property whose first
        // month is ≤ m, sum (daysInMonth - vacantDays) / total room-days.
        let propTotalDays = 0;
        let propVacantDays = 0;
        let turnovers = 0;
        const dim = daysInMonth(m);
        for (const rk of rooms) {
          const rentKey = `${key}|${rk}`;
          const fm = roomFirstMonth[rentKey];
          if (fm && m < fm) continue; // room not yet onboarded
          propTotalDays += dim;
          const intervals = occupancyByRoom[rentKey] || [];
          propVacantDays += vacantDaysInMonthForRoom(intervals, m, fm);
          turnovers += turnoversInMonthForRoom(intervals, m);
        }
        const occupancyPct = propTotalDays > 0
          ? Math.max(0, Math.min(100, ((propTotalDays - propVacantDays) / propTotalDays) * 100))
          : null;

        // Cumulative rooms onboarded by end of month m.
        const onboarded = roomFirsts.filter((fm) => fm <= m).length;

        // Maintenance cost for the month for this property (if mapped).
        const maint = propId ? (maintByPropMonth[`${propId}|${m}`] || 0) : 0;

        // Avg room rate = month's gross collected / rooms onboarded.
        // (simple, honest mean — doesn't separate vacant from occupied)
        const avgRate = onboarded > 0 ? b.gross / onboarded : null;

        return {
          month: m,
          gross: round2(b.gross),
          fees: round2(b.fees),
          host: round2(b.host),
          occupancy: occupancyPct != null ? round2(occupancyPct) : null,
          turnovers,
          onboarded,
          maintenance: round2(maint),
          avgRate: avgRate != null ? round2(avgRate) : null,
        };
      });

      return {
        propertyId: propId,
        propertyName: labelByKey[key] || key,
        metroArea: propId ? (propertyById[propId]?.metroArea || null) : null,
        points,
      };
    });

    return res.json({ months, series });
  } catch (err) {
    console.error('financial timeseries error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/financials/portfolio-summary ───────────────
// Compact summary for the dashboard widget: latest month's host
// earnings + portfolio occupancy, MoM trend, and a 6-month sparkline.

router.get('/portfolio-summary', async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const months = await prisma.financialUpload.findMany({
      where: { organizationId: orgId },
      orderBy: { earningsMonth: 'desc' },
      take: 6,
      select: { earningsMonth: true },
    });
    if (months.length === 0) {
      return res.json({ hasData: false });
    }
    const latestMonth = months[0].earningsMonth;
    const last6 = months.slice(0, 6).map((m) => m.earningsMonth).reverse();
    const prevMonth = months[1]?.earningsMonth || null;

    const records = await prisma.financialRecord.findMany({
      where: {
        organizationId: orgId,
        earningsMonth: { in: last6 },
        recordType: 'COLLECTED',
      },
      select: { earningsMonth: true, hostEarnings: true },
    });

    // Per-month host earnings for sparkline + latest/prev totals.
    const hostByMonth = {};
    for (const r of records) {
      hostByMonth[r.earningsMonth] = (hostByMonth[r.earningsMonth] || 0) + (r.hostEarnings || 0);
    }
    const sparkline = last6.map((m) => ({
      month: m,
      host: round2(hostByMonth[m] || 0),
    }));
    const hostEarnings = round2(hostByMonth[latestMonth] || 0);
    const prevHost = prevMonth ? (hostByMonth[prevMonth] || 0) : null;
    const hostTrend = prevMonth ? deltaPct(hostEarnings, prevHost) : null;

    // Portfolio occupancy for the latest month — reuse the dashboard
    // logic by calling our occupancy machinery for that month only.
    // To avoid duplication, we issue a sub-query for the relevant data.
    const allCollectedHistory = await prisma.financialRecord.findMany({
      where: { organizationId: orgId, recordType: 'COLLECTED' },
      select: {
        earningsMonth: true,
        propertyAddress: true,
        roomNumber: true,
        roomId: true,
        memberId: true,
        billType: true,
        grossAmount: true,
        recordDate: true,
      },
    });

    const intervalsByRoom = {};
    const firstMonthByRoom = {};
    {
      const grouped = {};
      for (const r of allCollectedHistory) {
        if (!r.propertyAddress) continue;
        const norm = normalizeAddress(r.propertyAddress);
        if (!norm || norm === 'unknown') continue;
        const memberId = (r.memberId || '').toString().trim();
        if (!memberId) continue;
        const roomKey = (r.roomNumber || r.roomId || '').toString().trim();
        if (!roomKey) continue;
        const k = `${norm}|${roomKey}`;
        if (!firstMonthByRoom[k] || r.earningsMonth < firstMonthByRoom[k]) {
          firstMonthByRoom[k] = r.earningsMonth;
        }
        if (!grouped[k]) grouped[k] = {};
        if (!grouped[k][memberId]) grouped[k][memberId] = {};
        if (!grouped[k][memberId][r.earningsMonth]) {
          grouped[k][memberId][r.earningsMonth] = { net: 0, firstPos: null, lastPos: null };
        }
        const slot = grouped[k][memberId][r.earningsMonth];
        slot.net += (r.grossAmount || 0);
        if ((r.grossAmount || 0) > 0 && r.recordDate) {
          const d = new Date(r.recordDate);
          if (!isNaN(d.getTime())) {
            if (!slot.firstPos || d < slot.firstPos) slot.firstPos = d;
            if (!slot.lastPos || d > slot.lastPos) slot.lastPos = d;
          }
        }
      }
      for (const k of Object.keys(grouped)) {
        const intervals = [];
        for (const memberId of Object.keys(grouped[k])) {
          const months2 = grouped[k][memberId];
          let firstDate = null, lastDate = null;
          const positiveMonths = new Set();
          for (const month of Object.keys(months2)) {
            const m2 = months2[month];
            const netRounded = Math.round(m2.net * 100) / 100;
            if (netRounded > 1) {
              positiveMonths.add(month);
              if (m2.firstPos && (!firstDate || m2.firstPos < firstDate)) firstDate = m2.firstPos;
              if (m2.lastPos && (!lastDate || m2.lastPos > lastDate)) lastDate = m2.lastPos;
            }
          }
          if (positiveMonths.size === 0) continue;
          if (!firstDate) {
            const earliest = [...positiveMonths].sort()[0];
            const [y, mo] = earliest.split('-').map(Number);
            firstDate = new Date(Date.UTC(y, mo - 1, 1));
          }
          if (!lastDate) {
            const latest = [...positiveMonths].sort().pop();
            const [y, mo] = latest.split('-').map(Number);
            lastDate = new Date(Date.UTC(y, mo - 1, daysInMonth(latest)));
          }
          intervals.push({ memberId, firstDate, lastDate });
        }
        intervals.sort((a, b) => a.firstDate - b.firstDate);
        intervalsByRoom[k] = intervals;
      }
    }

    let totalRoomDays = 0;
    let totalVacantDays = 0;
    const dim = daysInMonth(latestMonth);
    for (const k of Object.keys(intervalsByRoom)) {
      const fm = firstMonthByRoom[k];
      if (fm && latestMonth < fm) continue;
      totalRoomDays += dim;
      totalVacantDays += vacantDaysInMonthForRoom(intervalsByRoom[k], latestMonth, fm);
    }
    const occupancy = totalRoomDays > 0
      ? round2(((totalRoomDays - totalVacantDays) / totalRoomDays) * 100)
      : null;

    return res.json({
      hasData: true,
      latestMonth,
      hostEarnings,
      hostEarningsTrend: hostTrend,
      portfolioOccupancy: occupancy,
      sparkline,
    });
  } catch (err) {
    console.error('portfolio-summary error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/financials/pnl ─────────────────────────────
// Monthly P&L table for the Financial Reports tab. Optional filters:
//   ?from=YYYY-MM  ?to=YYYY-MM  ?propertyId=<id|all>
// Returns per-month aggregates + per-property breakdown for the range.
// Per-room rows included when a single property is selected.

router.get('/pnl', async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const propertyIdFilter = req.query.propertyId && req.query.propertyId !== 'all'
      ? req.query.propertyId : null;
    const fromMonth = req.query.from && /^\d{4}-\d{2}$/.test(req.query.from) ? req.query.from : null;
    const toMonth = req.query.to && /^\d{4}-\d{2}$/.test(req.query.to) ? req.query.to : null;

    const [allMonthsRows, mappings, properties, allCollectedHistory, maintenance] = await Promise.all([
      prisma.financialUpload.findMany({
        where: { organizationId: orgId },
        orderBy: { earningsMonth: 'desc' },
        select: { earningsMonth: true },
      }),
      prisma.padSplitPropertyMapping.findMany({ where: { organizationId: orgId } }),
      prisma.property.findMany({
        where: { organizationId: orgId, deletedAt: null },
        select: { id: true, name: true, address: true },
      }),
      prisma.financialRecord.findMany({
        where: { organizationId: orgId, recordType: 'COLLECTED' },
        select: {
          earningsMonth: true,
          propertyAddress: true,
          roomNumber: true,
          roomId: true,
          memberId: true,
          memberName: true,
          billType: true,
          grossAmount: true,
          bookingFee: true,
          serviceFee: true,
          transactionFee: true,
          hostEarnings: true,
          recordDate: true,
        },
      }),
      prisma.maintenanceItem.findMany({
        where: { organizationId: orgId, deletedAt: null, actualCost: { not: null } },
        select: { propertyId: true, actualCost: true, createdAt: true },
      }),
    ]);

    const allMonths = allMonthsRows.map((m) => m.earningsMonth).sort();
    if (allMonths.length === 0) {
      return res.json({
        hasData: false, months: [], byMonth: [], byProperty: [], rooms: [],
        properties: properties.map((p) => ({ id: p.id, name: p.name })),
      });
    }
    const months = allMonths.filter((m) => {
      if (fromMonth && m < fromMonth) return false;
      if (toMonth && m > toMonth) return false;
      return true;
    });

    const mappingByAddr = {};
    for (const m of mappings) mappingByAddr[m.padsplitAddress] = m.propertyId;
    // Auto-fuzzy-match unmapped addresses.
    const distinctAddrs = [...new Set(allCollectedHistory.map((r) => r.propertyAddress).filter(Boolean))];
    for (const addr of distinctAddrs) {
      const norm = normalizeAddress(addr);
      if (mappingByAddr[norm]) continue;
      let bestId = null, bestScore = 0;
      for (const p of properties) {
        const s = matchScore(addr, p);
        if (s > bestScore) { bestScore = s; bestId = p.id; }
      }
      if (bestScore >= 1 && bestId) mappingByAddr[norm] = bestId;
    }
    const propertyById = {};
    for (const p of properties) propertyById[p.id] = p;

    // Build per-room occupancy intervals + first month (used for
    // occupancy % and turnovers per month).
    const intervalsByRoom = {};
    const firstMonthByRoom = {};
    const allRoomsByPropId = {};
    {
      const grouped = {};
      for (const r of allCollectedHistory) {
        if (!r.propertyAddress) continue;
        const norm = normalizeAddress(r.propertyAddress);
        if (!norm || norm === 'unknown') continue;
        const memberId = (r.memberId || '').toString().trim();
        if (!memberId) continue;
        const roomKey = (r.roomNumber || r.roomId || '').toString().trim();
        if (!roomKey) continue;
        const k = `${norm}|${roomKey}`;
        if (!firstMonthByRoom[k] || r.earningsMonth < firstMonthByRoom[k]) {
          firstMonthByRoom[k] = r.earningsMonth;
        }
        const propId = mappingByAddr[norm] || norm;
        if (!allRoomsByPropId[propId]) allRoomsByPropId[propId] = new Set();
        allRoomsByPropId[propId].add(k);
        if (!grouped[k]) grouped[k] = {};
        if (!grouped[k][memberId]) grouped[k][memberId] = {};
        if (!grouped[k][memberId][r.earningsMonth]) {
          grouped[k][memberId][r.earningsMonth] = { net: 0, firstPos: null, lastPos: null };
        }
        const slot = grouped[k][memberId][r.earningsMonth];
        slot.net += (r.grossAmount || 0);
        if ((r.grossAmount || 0) > 0 && r.recordDate) {
          const d = new Date(r.recordDate);
          if (!isNaN(d.getTime())) {
            if (!slot.firstPos || d < slot.firstPos) slot.firstPos = d;
            if (!slot.lastPos || d > slot.lastPos) slot.lastPos = d;
          }
        }
      }
      for (const k of Object.keys(grouped)) {
        const intervals = [];
        for (const memberId of Object.keys(grouped[k])) {
          const ms = grouped[k][memberId];
          let firstDate = null, lastDate = null;
          const positiveMonths = new Set();
          for (const month of Object.keys(ms)) {
            const m2 = ms[month];
            const netRounded = Math.round(m2.net * 100) / 100;
            if (netRounded > 1) {
              positiveMonths.add(month);
              if (m2.firstPos && (!firstDate || m2.firstPos < firstDate)) firstDate = m2.firstPos;
              if (m2.lastPos && (!lastDate || m2.lastPos > lastDate)) lastDate = m2.lastPos;
            }
          }
          if (positiveMonths.size === 0) continue;
          if (!firstDate) {
            const earliest = [...positiveMonths].sort()[0];
            const [y, mo] = earliest.split('-').map(Number);
            firstDate = new Date(Date.UTC(y, mo - 1, 1));
          }
          if (!lastDate) {
            const latest = [...positiveMonths].sort().pop();
            const [y, mo] = latest.split('-').map(Number);
            lastDate = new Date(Date.UTC(y, mo - 1, daysInMonth(latest)));
          }
          intervals.push({ memberId, firstDate, lastDate });
        }
        intervals.sort((a, b) => a.firstDate - b.firstDate);
        intervalsByRoom[k] = intervals;
      }
    }

    // Filter records to the property and date range.
    function recordPropertyId(r) {
      const norm = normalizeAddress(r.propertyAddress);
      return mappingByAddr[norm] || null;
    }
    const filteredRecords = allCollectedHistory.filter((r) => {
      if (!months.includes(r.earningsMonth)) return false;
      if (propertyIdFilter && recordPropertyId(r) !== propertyIdFilter) return false;
      return true;
    });

    // Per-month aggregates (across selected properties).
    const byMonth = months.map((month) => {
      let gross = 0, booking = 0, service = 0, txn = 0, host = 0;
      for (const r of filteredRecords) {
        if (r.earningsMonth !== month) continue;
        gross += r.grossAmount || 0;
        booking += Math.abs(r.bookingFee || 0);
        service += Math.abs(r.serviceFee || 0);
        txn += Math.abs(r.transactionFee || 0);
        host += r.hostEarnings || 0;
      }
      const dim = daysInMonth(month);
      // Occupancy + turnovers across rooms in scope.
      const propIdsInScope = propertyIdFilter
        ? [propertyIdFilter]
        : Object.keys(allRoomsByPropId);
      let totalDays = 0, vacantDays = 0, turnovers = 0;
      for (const pid of propIdsInScope) {
        const roomKeys = [...(allRoomsByPropId[pid] || [])];
        for (const k of roomKeys) {
          const fm = firstMonthByRoom[k];
          if (fm && month < fm) continue;
          totalDays += dim;
          vacantDays += vacantDaysInMonthForRoom(intervalsByRoom[k] || [], month, fm);
          turnovers += turnoversInMonthForRoom(intervalsByRoom[k] || [], month);
        }
      }
      const occupancy = totalDays > 0 ? round2(((totalDays - vacantDays) / totalDays) * 100) : null;
      // Maintenance for the month, scoped to property if filtering.
      let maint = 0;
      for (const m of maintenance) {
        if (!m.createdAt) continue;
        const d = new Date(m.createdAt);
        if (isNaN(d)) continue;
        const mkey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        if (mkey !== month) continue;
        if (propertyIdFilter && m.propertyId !== propertyIdFilter) continue;
        maint += m.actualCost || 0;
      }
      const totalFees = booking + service + txn;
      return {
        month,
        gross: round2(gross),
        bookingFees: round2(booking),
        serviceFees: round2(service),
        transactionFees: round2(txn),
        totalFees: round2(totalFees),
        hostEarnings: round2(host),
        maintenance: round2(maint),
        netPL: round2(host - maint),
        occupancy,
        turnovers,
      };
    });

    // Per-property aggregates across the selected range.
    const propIdsInPlay = propertyIdFilter
      ? [propertyIdFilter]
      : Object.keys(allRoomsByPropId).filter((id) => propertyById[id]);
    const byProperty = propIdsInPlay.map((pid) => {
      const propRecords = filteredRecords.filter((r) => recordPropertyId(r) === pid);
      let gross = 0, booking = 0, service = 0, txn = 0, host = 0;
      for (const r of propRecords) {
        gross += r.grossAmount || 0;
        booking += Math.abs(r.bookingFee || 0);
        service += Math.abs(r.serviceFee || 0);
        txn += Math.abs(r.transactionFee || 0);
        host += r.hostEarnings || 0;
      }
      // Occupancy / turnovers across rooms in this property over months.
      const roomKeys = [...(allRoomsByPropId[pid] || [])];
      let totalDays = 0, vacantDays = 0, turnovers = 0;
      for (const m of months) {
        const dim = daysInMonth(m);
        for (const k of roomKeys) {
          const fm = firstMonthByRoom[k];
          if (fm && m < fm) continue;
          totalDays += dim;
          vacantDays += vacantDaysInMonthForRoom(intervalsByRoom[k] || [], m, fm);
          turnovers += turnoversInMonthForRoom(intervalsByRoom[k] || [], m);
        }
      }
      const occupancy = totalDays > 0 ? round2(((totalDays - vacantDays) / totalDays) * 100) : null;
      let maint = 0;
      for (const mi of maintenance) {
        if (mi.propertyId !== pid) continue;
        if (!mi.createdAt) continue;
        const d = new Date(mi.createdAt);
        if (isNaN(d)) continue;
        const mkey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        if (!months.includes(mkey)) continue;
        maint += mi.actualCost || 0;
      }
      const totalFees = booking + service + txn;
      return {
        propertyId: pid,
        propertyName: propertyById[pid]?.name || pid,
        gross: round2(gross),
        bookingFees: round2(booking),
        serviceFees: round2(service),
        transactionFees: round2(txn),
        totalFees: round2(totalFees),
        hostEarnings: round2(host),
        maintenance: round2(maint),
        netPL: round2(host - maint),
        occupancy,
        turnovers,
      };
    });

    // Per-room rows when a single property is selected.
    let rooms = [];
    if (propertyIdFilter) {
      const roomTotals = {};
      for (const r of filteredRecords) {
        const pid = recordPropertyId(r);
        if (pid !== propertyIdFilter) continue;
        const roomKey = (r.roomNumber || r.roomId || '').toString().trim();
        if (!roomKey) continue;
        if (!roomTotals[roomKey]) {
          roomTotals[roomKey] = {
            roomNumber: roomKey, gross: 0, bookingFees: 0, serviceFees: 0,
            transactionFees: 0, hostEarnings: 0,
          };
        }
        const t = roomTotals[roomKey];
        t.gross += r.grossAmount || 0;
        t.bookingFees += Math.abs(r.bookingFee || 0);
        t.serviceFees += Math.abs(r.serviceFee || 0);
        t.transactionFees += Math.abs(r.transactionFee || 0);
        t.hostEarnings += r.hostEarnings || 0;
      }
      rooms = Object.values(roomTotals).map((t) => ({
        roomNumber: t.roomNumber,
        gross: round2(t.gross),
        bookingFees: round2(t.bookingFees),
        serviceFees: round2(t.serviceFees),
        transactionFees: round2(t.transactionFees),
        totalFees: round2(t.bookingFees + t.serviceFees + t.transactionFees),
        hostEarnings: round2(t.hostEarnings),
      }));
      rooms.sort((a, b) => {
        const an = parseInt(a.roomNumber, 10);
        const bn = parseInt(b.roomNumber, 10);
        if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
        return String(a.roomNumber).localeCompare(String(b.roomNumber));
      });
    }

    return res.json({
      hasData: true,
      months,
      allMonths,
      byMonth,
      byProperty,
      rooms,
      properties: properties.map((p) => ({ id: p.id, name: p.name })),
    });
  } catch (err) {
    console.error('financial pnl error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/financials/report.pdf ──────────────────────
// Branded multi-page PDF version of the P&L report.

router.get('/report.pdf', async (req, res) => {
  try {
    // Reuse the JSON endpoint by calling its handler logic via fetch
    // would be silly — reuse the data by inlining a minimal repeat.
    // We'll just hit the same dataset using existing helpers.
    const orgId = req.user.organizationId;
    const propertyIdFilter = req.query.propertyId && req.query.propertyId !== 'all'
      ? req.query.propertyId : null;
    // Multi-property filter — comma-separated ids. Takes precedence over
    // the single propertyId param when present.
    const propertyIdsFilter = req.query.propertyIds
      ? String(req.query.propertyIds).split(',').map((s) => s.trim()).filter(Boolean)
      : null;
    const fromMonth = req.query.from && /^\d{4}-\d{2}$/.test(req.query.from) ? req.query.from : null;
    const toMonth = req.query.to && /^\d{4}-\d{2}$/.test(req.query.to) ? req.query.to : null;

    // Re-use the /pnl endpoint via internal call for data parity.
    const pnlReq = { user: req.user, query: { propertyId: propertyIdFilter || 'all', from: fromMonth || undefined, to: toMonth || undefined } };
    let pnl = null;
    await new Promise((resolve) => {
      const fakeRes = {
        json(payload) { pnl = payload; resolve(); },
        status() { return this; },
      };
      // Look up the route handler from router.stack.
      const layer = router.stack.find((l) => l.route && l.route.path === '/pnl' && l.route.methods.get);
      if (!layer) return resolve();
      layer.route.stack[0].handle(pnlReq, fakeRes, () => resolve());
    });
    if (!pnl || !pnl.hasData) {
      return res.status(400).json({ error: 'No financial data available' });
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true },
    });
    const propLabel = propertyIdsFilter && propertyIdsFilter.length > 0
      ? (propertyIdsFilter.length === 1
          ? (pnl.byProperty.find((p) => p.propertyId === propertyIdsFilter[0])?.propertyName || 'Property')
          : `${propertyIdsFilter.length} properties`)
      : (propertyIdFilter
          ? (pnl.byProperty.find((p) => p.propertyId === propertyIdFilter)?.propertyName || 'Property')
          : 'All properties');
    const dateLabel = pnl.months.length > 0
      ? `${monthLabel(pnl.months[0])} – ${monthLabel(pnl.months[pnl.months.length - 1])}`
      : '—';

    const filename = `financial-report-${propLabel.replace(/[^A-Za-z0-9]/g, '_')}-${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    doc.pipe(res);

    const SAGE = '#6B8F71';
    const TEXT = '#2C2C2C';
    const MUTED = '#8A8580';

    function drawHeader(doc) {
      // Sage green bar at the top
      doc.save();
      doc.rect(0, 0, doc.page.width, 36).fill(SAGE);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(14)
        .text('RoomReport', 48, 11, { width: doc.page.width - 96, align: 'left' });
      doc.fontSize(10).font('Helvetica')
        .text(org?.name || '', 48, 13, { width: doc.page.width - 96, align: 'right' });
      doc.restore();
      doc.y = 60;
    }

    function fmtMoney(n) {
      if (n == null || isNaN(n)) return '$0';
      return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    }

    // ── Page 1: Portfolio Summary ──
    drawHeader(doc);
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(20).text('Financial report');
    doc.moveDown(0.2);
    doc.fontSize(11).font('Helvetica').fillColor(MUTED).text(`${propLabel} · ${dateLabel}`);
    doc.moveDown(1);

    // Portfolio totals (sum byMonth)
    const totals = pnl.byMonth.reduce((acc, m) => {
      acc.gross += m.gross; acc.totalFees += m.totalFees;
      acc.host += m.hostEarnings; acc.maint += m.maintenance;
      acc.netPL += m.netPL; acc.turnovers += m.turnovers;
      return acc;
    }, { gross: 0, totalFees: 0, host: 0, maint: 0, netPL: 0, turnovers: 0 });
    const avgOccupancy = (() => {
      const valid = pnl.byMonth.filter((m) => m.occupancy != null);
      if (!valid.length) return null;
      return valid.reduce((s, m) => s + m.occupancy, 0) / valid.length;
    })();

    const summaryRows = [
      ['Gross collected',   fmtMoney(totals.gross)],
      ['Platform fees',     fmtMoney(totals.totalFees)],
      ['Host earnings',     fmtMoney(totals.host)],
      ['Maintenance costs', fmtMoney(totals.maint)],
      ['Net P&L',           fmtMoney(totals.netPL)],
      ['Avg occupancy',     avgOccupancy != null ? `${avgOccupancy.toFixed(1)}%` : '—'],
      ['Turnovers',         String(totals.turnovers)],
    ];
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(12).text('Portfolio summary');
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(11);
    for (const [k, v] of summaryRows) {
      doc.text(k, { continued: true, width: 220 });
      doc.fillColor(TEXT).text(v, { align: 'right' });
      doc.fillColor(TEXT);
    }
    doc.moveDown(1);

    // Monthly breakdown table
    doc.font('Helvetica-Bold').fontSize(12).text('Monthly breakdown');
    doc.moveDown(0.4);
    const cols = ['Month', 'Gross', 'Fees', 'Host', 'Maint', 'Net P&L', 'Occ', 'Turn'];
    const colW = [70, 70, 60, 70, 60, 70, 50, 40];
    let x = doc.x;
    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(MUTED);
    for (let i = 0; i < cols.length; i++) {
      doc.text(cols[i], x + colW.slice(0, i).reduce((a, b) => a + b, 0), y, { width: colW[i], align: i === 0 ? 'left' : 'right' });
    }
    y += 16;
    doc.font('Helvetica').fontSize(10).fillColor(TEXT);
    for (const m of pnl.byMonth) {
      const row = [
        monthLabel(m.month), fmtMoney(m.gross), fmtMoney(m.totalFees),
        fmtMoney(m.hostEarnings), fmtMoney(m.maintenance), fmtMoney(m.netPL),
        m.occupancy != null ? `${m.occupancy.toFixed(1)}%` : '—',
        String(m.turnovers),
      ];
      for (let i = 0; i < row.length; i++) {
        doc.text(row[i], x + colW.slice(0, i).reduce((a, b) => a + b, 0), y, { width: colW[i], align: i === 0 ? 'left' : 'right' });
      }
      y += 14;
      if (y > doc.page.height - 60) { doc.addPage(); drawHeader(doc); y = doc.y; }
    }

    // ── Pages per property ──
    const propsToRender = propertyIdsFilter && propertyIdsFilter.length > 0
      ? pnl.byProperty.filter((p) => propertyIdsFilter.includes(p.propertyId))
      : (propertyIdFilter
          ? pnl.byProperty.filter((p) => p.propertyId === propertyIdFilter)
          : pnl.byProperty);
    for (const p of propsToRender) {
      doc.addPage();
      drawHeader(doc);
      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(18).text(p.propertyName);
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(dateLabel);
      doc.moveDown(0.8);

      const propRows = [
        ['Gross collected',   fmtMoney(p.gross)],
        ['Platform fees',     fmtMoney(p.totalFees)],
        ['Host earnings',     fmtMoney(p.hostEarnings)],
        ['Maintenance',       fmtMoney(p.maintenance)],
        ['Net P&L',           fmtMoney(p.netPL)],
        ['Occupancy',         p.occupancy != null ? `${p.occupancy.toFixed(1)}%` : '—'],
        ['Turnovers',         String(p.turnovers)],
      ];
      doc.font('Helvetica').fontSize(11).fillColor(TEXT);
      for (const [k, v] of propRows) {
        doc.text(k, { continued: true, width: 220 });
        doc.text(v, { align: 'right' });
      }

      // Per-room when this is a single-property report.
      if (propertyIdFilter && pnl.rooms.length > 0) {
        doc.moveDown(0.8);
        doc.font('Helvetica-Bold').fontSize(12).text('Room-level detail');
        doc.moveDown(0.3);
        const rcols = ['Room', 'Gross', 'Fees', 'Host'];
        const rcolW = [80, 100, 100, 100];
        let rx = doc.x, ry = doc.y;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(MUTED);
        for (let i = 0; i < rcols.length; i++) {
          doc.text(rcols[i], rx + rcolW.slice(0, i).reduce((a, b) => a + b, 0), ry,
            { width: rcolW[i], align: i === 0 ? 'left' : 'right' });
        }
        ry += 16;
        doc.font('Helvetica').fontSize(10).fillColor(TEXT);
        for (const r of pnl.rooms) {
          const row = [
            r.roomNumber, fmtMoney(r.gross), fmtMoney(r.totalFees), fmtMoney(r.hostEarnings),
          ];
          for (let i = 0; i < row.length; i++) {
            doc.text(row[i], rx + rcolW.slice(0, i).reduce((a, b) => a + b, 0), ry,
              { width: rcolW[i], align: i === 0 ? 'left' : 'right' });
          }
          ry += 14;
          if (ry > doc.page.height - 60) { doc.addPage(); drawHeader(doc); ry = doc.y; }
        }
      }
    }

    doc.end();
  } catch (err) {
    console.error('pnl pdf error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
});

function monthLabel(s) {
  if (!s) return '';
  const [y, m] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ─── GET /api/financials/property/:propertyId ────────────

router.get('/property/:propertyId', async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const property = await prisma.property.findFirst({
      where: { id: req.params.propertyId, organizationId: orgId, deletedAt: null },
    });
    if (!property) return res.status(404).json({ error: 'Property not found' });

    const months = await prisma.financialUpload.findMany({
      where: { organizationId: orgId },
      orderBy: { earningsMonth: 'desc' },
      take: 1,
      select: { earningsMonth: true },
    });
    if (months.length === 0) return res.json({ hasData: false });
    const latestMonth = months[0].earningsMonth;

    // Resolve PadSplit address(es) that map to this property.
    const mappings = await prisma.padSplitPropertyMapping.findMany({
      where: { organizationId: orgId, propertyId: property.id },
    });
    const mappedNorms = new Set(mappings.map((m) => m.padsplitAddress));

    // If no explicit mapping, fuzzy-match.
    if (mappedNorms.size === 0) {
      const distinct = await prisma.financialRecord.findMany({
        where: { organizationId: orgId, propertyAddress: { not: null } },
        select: { propertyAddress: true },
        distinct: ['propertyAddress'],
      });
      let bestNorm = null, bestScore = 0;
      for (const r of distinct) {
        const s = matchScore(r.propertyAddress, property);
        if (s > bestScore) { bestScore = s; bestNorm = normalizeAddress(r.propertyAddress); }
      }
      if (bestNorm && bestScore >= 1) mappedNorms.add(bestNorm);
    }
    if (mappedNorms.size === 0) return res.json({ hasData: false });

    // Pull all collected history for these address(es).
    const allHistory = await prisma.financialRecord.findMany({
      where: {
        organizationId: orgId,
        recordType: 'COLLECTED',
      },
      select: {
        earningsMonth: true,
        propertyAddress: true,
        roomNumber: true,
        roomId: true,
        memberId: true,
        memberName: true,
        billType: true,
        grossAmount: true,
        hostEarnings: true,
        recordDate: true,
      },
    });
    const history = allHistory.filter((r) => {
      const norm = normalizeAddress(r.propertyAddress);
      return mappedNorms.has(norm);
    });
    if (history.length === 0) return res.json({ hasData: false });

    // Build per-room intervals + per-room latest-month totals.
    const grouped = {}; // roomKey → memberId → month → slot
    const firstMonthByRoom = {};
    const latestMonthRoomTotals = {}; // roomKey → { gross, host, residentName, dailyRateSamples }
    const dailyRateSums = {}; // roomKey → { sum, count } for typical daily rate
    for (const r of history) {
      const roomKey = (r.roomNumber || r.roomId || '').toString().trim();
      if (!roomKey) continue;
      const memberId = (r.memberId || '').toString().trim();
      if (!firstMonthByRoom[roomKey] || r.earningsMonth < firstMonthByRoom[roomKey]) {
        firstMonthByRoom[roomKey] = r.earningsMonth;
      }
      if (memberId) {
        if (!grouped[roomKey]) grouped[roomKey] = {};
        if (!grouped[roomKey][memberId]) grouped[roomKey][memberId] = {};
        if (!grouped[roomKey][memberId][r.earningsMonth]) {
          grouped[roomKey][memberId][r.earningsMonth] = {
            net: 0, firstPos: null, lastPos: null, name: r.memberName || null,
          };
        }
        const slot = grouped[roomKey][memberId][r.earningsMonth];
        slot.net += (r.grossAmount || 0);
        if (r.memberName && !slot.name) slot.name = r.memberName;
        if ((r.grossAmount || 0) > 0 && r.recordDate) {
          const d = new Date(r.recordDate);
          if (!isNaN(d.getTime())) {
            if (!slot.firstPos || d < slot.firstPos) slot.firstPos = d;
            if (!slot.lastPos || d > slot.lastPos) slot.lastPos = d;
          }
        }
      }
      if (r.earningsMonth === latestMonth) {
        if (!latestMonthRoomTotals[roomKey]) {
          latestMonthRoomTotals[roomKey] = { gross: 0, host: 0, residentName: null, residentLastSeen: null };
        }
        latestMonthRoomTotals[roomKey].gross += r.grossAmount || 0;
        latestMonthRoomTotals[roomKey].host += r.hostEarnings || 0;
      }
      // Typical daily rate per room across history (membership dues only).
      if (isDuesBillType(r.billType)) {
        const dim2 = daysInMonth(r.earningsMonth);
        const monthKey = `${roomKey}|${r.earningsMonth}`;
        if (!dailyRateSums[roomKey]) dailyRateSums[roomKey] = { byMonth: {}, sumDaily: 0, count: 0 };
        dailyRateSums[roomKey].byMonth[monthKey] = (dailyRateSums[roomKey].byMonth[monthKey] || 0) + (r.grossAmount || 0);
      }
    }
    // Finalize daily-rate averages.
    for (const roomKey of Object.keys(dailyRateSums)) {
      const obj = dailyRateSums[roomKey];
      let sumDaily = 0, count = 0;
      for (const monthKey of Object.keys(obj.byMonth)) {
        const total = obj.byMonth[monthKey];
        if (total <= 0) continue;
        const month = monthKey.split('|')[1];
        sumDaily += total / daysInMonth(month);
        count += 1;
      }
      obj.dailyRate = count > 0 ? sumDaily / count : 0;
    }

    // Per-room maintenance (this property, all-time + last 30d).
    const maintAll = await prisma.maintenanceItem.findMany({
      where: {
        organizationId: orgId,
        propertyId: property.id,
        deletedAt: null,
        actualCost: { not: null },
      },
      select: { roomId: true, actualCost: true },
    });
    const maintByRoom = {};
    for (const m of maintAll) {
      if (!m.roomId) continue;
      maintByRoom[m.roomId] = (maintByRoom[m.roomId] || 0) + (m.actualCost || 0);
    }

    // Build occupancy intervals + the resident name for latest month.
    const intervalsByRoom = {};
    const residentByRoom = {};
    for (const roomKey of Object.keys(grouped)) {
      const intervals = [];
      for (const memberId of Object.keys(grouped[roomKey])) {
        const months2 = grouped[roomKey][memberId];
        let firstDate = null, lastDate = null;
        let memberName = null;
        const positiveMonths = new Set();
        for (const month of Object.keys(months2)) {
          const m2 = months2[month];
          if (!memberName && m2.name) memberName = m2.name;
          const netRounded = Math.round(m2.net * 100) / 100;
          if (netRounded > 1) {
            positiveMonths.add(month);
            if (m2.firstPos && (!firstDate || m2.firstPos < firstDate)) firstDate = m2.firstPos;
            if (m2.lastPos && (!lastDate || m2.lastPos > lastDate)) lastDate = m2.lastPos;
            if (month === latestMonth) {
              residentByRoom[roomKey] = memberName || (m2.name || null);
            }
          }
        }
        if (positiveMonths.size === 0) continue;
        if (!firstDate) {
          const earliest = [...positiveMonths].sort()[0];
          const [y, mo] = earliest.split('-').map(Number);
          firstDate = new Date(Date.UTC(y, mo - 1, 1));
        }
        if (!lastDate) {
          const latest = [...positiveMonths].sort().pop();
          const [y, mo] = latest.split('-').map(Number);
          lastDate = new Date(Date.UTC(y, mo - 1, daysInMonth(latest)));
        }
        intervals.push({ memberId, memberName, firstDate, lastDate });
      }
      intervals.sort((a, b) => a.firstDate - b.firstDate);
      intervalsByRoom[roomKey] = intervals;
    }

    // Get RoomReport's room IDs so we can join maintenance by RR room id.
    const rrRooms = await prisma.room.findMany({
      where: { propertyId: property.id, deletedAt: null },
      select: { id: true, label: true },
    });
    // Map RR-room-label → roomId for joining (best-effort).
    const rrRoomByLabel = {};
    for (const r of rrRooms) {
      const label = (r.label || '').toString().trim();
      // Try common patterns: "Room 3", "3", "Cedar (Room 3)"
      const m = label.match(/(?:room\s*)?(\d+)/i);
      if (m) rrRoomByLabel[m[1]] = r.id;
    }

    const dim = daysInMonth(latestMonth);

    // Last 6 months of host earnings per room → mini sparkline.
    const sortedMonths = [...new Set(allHistory.map((r) => r.earningsMonth))].sort();
    const last6 = sortedMonths.slice(-6);
    const monthlyHostByRoom = {}; // roomKey → { month → host }
    for (const r of history) {
      const roomKey = (r.roomNumber || r.roomId || '').toString().trim();
      if (!roomKey) continue;
      if (!last6.includes(r.earningsMonth)) continue;
      if (!monthlyHostByRoom[roomKey]) monthlyHostByRoom[roomKey] = {};
      monthlyHostByRoom[roomKey][r.earningsMonth] =
        (monthlyHostByRoom[roomKey][r.earningsMonth] || 0) + (r.hostEarnings || 0);
    }

    const rooms = {};
    const allRoomKeys = new Set([
      ...Object.keys(latestMonthRoomTotals),
      ...Object.keys(intervalsByRoom),
      ...Object.keys(firstMonthByRoom),
    ]);
    const nowDate = new Date();
    for (const roomKey of allRoomKeys) {
      const fm = firstMonthByRoom[roomKey];
      if (fm && latestMonth < fm) continue; // room not yet onboarded
      const totals = latestMonthRoomTotals[roomKey] || { gross: 0, host: 0 };
      const dailyRate = dailyRateSums[roomKey]?.dailyRate || 0;
      const vacantDays = vacantDaysInMonthForRoom(intervalsByRoom[roomKey] || [], latestMonth, fm);
      const rrRoomId = rrRoomByLabel[roomKey];
      const maintenanceCost = rrRoomId ? (maintByRoom[rrRoomId] || 0) : 0;

      // Current resident tenure — from the latest interval that includes
      // the current month. Months from firstDate to today.
      const intervals = intervalsByRoom[roomKey] || [];
      const currentInterval = intervals.length > 0 ? intervals[intervals.length - 1] : null;
      let tenureMonths = null;
      let residentSince = null;
      if (currentInterval && residentByRoom[roomKey]) {
        residentSince = currentInterval.firstDate || null;
        if (residentSince) {
          tenureMonths = (nowDate - residentSince) / (1000 * 60 * 60 * 24 * 30.4375);
        }
      }

      // Sparkline — host earnings per last 6 months, in order.
      const sparkline = last6.map((m) => ({
        month: m,
        host: round2(monthlyHostByRoom[roomKey]?.[m] || 0),
      }));

      rooms[roomKey] = {
        roomNumber: roomKey,
        rrRoomId: rrRoomId || null,
        residentName: residentByRoom[roomKey] || null,
        residentSince,
        tenureMonths: tenureMonths != null ? Number(tenureMonths.toFixed(1)) : null,
        gross: round2(totals.gross),
        host: round2(totals.host),
        vacantDays,
        dailyRate: round2(dailyRate),
        maintenanceCost: round2(maintenanceCost),
        sparkline,
      };
    }

    return res.json({
      hasData: true,
      latestMonth,
      daysInMonth: dim,
      rooms,
    });
  } catch (err) {
    console.error('property financial detail error:', err);
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

// Inclusive month count between two YYYY-MM strings.
function monthsBetween(startMonth, endMonth) {
  const [y1, m1] = startMonth.split('-').map(Number);
  const [y2, m2] = endMonth.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

// Day-level vacancy check for a room in a given month, given its
// sorted occupancy intervals (rejected members already filtered).
// Hoisted to module scope so both the dashboard and timeseries
// endpoints can use it.
function vacantDaysInMonthForRoom(intervals, monthStr, roomFirstMonthStr) {
  if (roomFirstMonthStr && monthStr < roomFirstMonthStr) return 0;
  const dim = daysInMonth(monthStr);
  if (!intervals || intervals.length === 0) return dim;
  const [y, m] = monthStr.split('-').map(Number);
  const FAR_FUTURE = new Date(8640000000000000);
  const effective = intervals.map((intv, i) => ({
    start: intv.firstDate,
    end: i === intervals.length - 1 ? FAR_FUTURE : intv.lastDate,
  }));
  const isRoomsFirstMonth = roomFirstMonthStr && monthStr === roomFirstMonthStr;
  const firstStart = effective[0].start;
  let occupied = 0;
  let skipped = 0;
  for (let day = 1; day <= dim; day++) {
    const d = new Date(Date.UTC(y, m - 1, day));
    if (isRoomsFirstMonth && d < firstStart) { skipped += 1; continue; }
    for (const e of effective) {
      if (d >= e.start && d <= e.end) { occupied += 1; break; }
    }
  }
  return dim - occupied - skipped;
}

function turnoversInMonthForRoom(intervals, monthStr) {
  if (!intervals || intervals.length < 2) return 0;
  const [y, m] = monthStr.split('-').map(Number);
  const monthStart = new Date(Date.UTC(y, m - 1, 1));
  const monthEnd = new Date(Date.UTC(y, m - 1, daysInMonth(monthStr)));
  let count = 0;
  for (let i = 1; i < intervals.length; i++) {
    const cur = intervals[i];
    const prev = intervals[i - 1];
    if (cur.memberId === prev.memberId) continue;
    if (cur.firstDate >= monthStart && cur.firstDate <= monthEnd) count += 1;
  }
  return count;
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
