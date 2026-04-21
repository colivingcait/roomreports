// ─── Plan & feature catalog ─────────────────────────────
//
// Used on BOTH the client and the server so gating decisions agree.
// During the beta period (org.isBeta === true) every feature is
// unlocked regardless of plan — canAccess always returns true.

export const PLANS = ['STARTER', 'GROWTH', 'OPERATOR'];

export const PLAN_LABELS = {
  STARTER: 'Starter',
  GROWTH: 'Growth',
  OPERATOR: 'Operator',
};

export const PLAN_PRICES = {
  STARTER: '$19/mo',
  GROWTH: '$39/mo',
  OPERATOR: '$79/mo',
};

export const PLAN_TAGLINES = {
  STARTER: 'Up to 2 properties',
  GROWTH: 'Up to 5 properties',
  OPERATOR: 'Unlimited properties',
};

// Feature → minimum plan required.
// "Everything in Starter" features are marked STARTER. Adding GROWTH
// unlocks Growth-exclusives; OPERATOR unlocks operator-exclusives.
export const FEATURES = {
  // ── Starter-level (everyone on a paid plan gets) ──
  inspections: 'STARTER',
  maintenance: 'STARTER',
  residentLinks: 'STARTER',
  offline: 'STARTER',
  basicReports: 'STARTER',
  toDo: 'STARTER',

  // ── Growth-level ──
  vendors: 'GROWTH',
  teamScoping: 'GROWTH',
  customTemplates: 'GROWTH',
  fullReportsPDF: 'GROWTH',
  leaseViolations: 'GROWTH',
  unlimitedTeam: 'GROWTH',

  // ── Operator-level ──
  batchWorkOrders: 'OPERATOR',
  csvExport: 'OPERATOR',
  prioritySupport: 'OPERATOR',
  unlimitedProperties: 'OPERATOR',
};

// Friendly labels + descriptions for the upgrade modal.
export const FEATURE_META = {
  inspections: { label: 'Inspections', desc: 'All inspection types: Room, Common Area, Move-In, Self-Check.' },
  maintenance: { label: 'Maintenance tracking', desc: 'Kanban board for maintenance tickets.' },
  residentLinks: { label: 'Resident links', desc: 'QR codes for move-in, self-check, and maintenance reports.' },
  offline: { label: 'Offline support', desc: 'Inspect without an internet connection; syncs when you\'re back online.' },
  basicReports: { label: 'Basic reporting', desc: 'Maintenance metrics without PDF export.' },
  toDo: { label: 'To-Do board', desc: 'Personal task list alongside maintenance tickets.' },
  vendors: { label: 'Vendor management', desc: 'Vendor directory with specialties, job history, and spend tracking.' },
  teamScoping: { label: 'Team roles & property scoping', desc: 'Limit what cleaners, handypeople, and PMs can see per property.' },
  customTemplates: { label: 'Custom inspection templates', desc: 'Tailor checklist items for your org.' },
  fullReportsPDF: { label: 'Full reporting + PDF export', desc: 'Summary and full-detail inspection PDFs, exportable work orders.' },
  leaseViolations: { label: 'Lease violation tracking', desc: 'Log violations, escalation history, and per-resident tracking.' },
  unlimitedTeam: { label: 'Unlimited team members', desc: 'Invite as many people as you need.' },
  batchWorkOrders: { label: 'Batch work orders', desc: 'Combine multiple maintenance tickets into one PDF work order.' },
  csvExport: { label: 'CSV export', desc: 'Download any report as CSV for accounting or analytics.' },
  prioritySupport: { label: 'Priority support', desc: 'Faster response times and a direct line to the team.' },
  unlimitedProperties: { label: 'Unlimited properties', desc: 'Add as many properties as your portfolio needs.' },
};

// Plan → per-resource limits. Infinity means no limit.
export const PLAN_LIMITS = {
  STARTER: { properties: 2, teamMembers: 3 },
  GROWTH: { properties: 5, teamMembers: Infinity },
  OPERATOR: { properties: Infinity, teamMembers: Infinity },
};

const PLAN_RANK = { STARTER: 1, GROWTH: 2, OPERATOR: 3 };

export function requiredPlan(feature) {
  return FEATURES[feature] || 'STARTER';
}

export function featureLabel(feature) {
  return FEATURE_META[feature]?.label || feature;
}

export function featureDescription(feature) {
  return FEATURE_META[feature]?.desc || '';
}

// Is this org allowed to use `feature`?
//   - org.isBeta → always yes
//   - otherwise compare plan rank
export function canAccess(org, feature) {
  if (!org) return false;
  if (org.isBeta) return true;
  const required = FEATURES[feature];
  if (!required) return true; // unknown / unlisted → don't gate
  const plan = org.plan || 'STARTER';
  return (PLAN_RANK[plan] || 0) >= (PLAN_RANK[required] || 0);
}

// Numeric limit for a given resource on this org.
// During beta, limits are effectively Infinity.
export function planLimit(org, resource) {
  if (!org) return 0;
  if (org.isBeta) return Infinity;
  const plan = org.plan || 'STARTER';
  return PLAN_LIMITS[plan]?.[resource] ?? Infinity;
}

// True if adding one more of `resource` would exceed the limit.
export function wouldExceed(org, resource, currentCount) {
  const limit = planLimit(org, resource);
  if (!isFinite(limit)) return false;
  return currentCount >= limit;
}
