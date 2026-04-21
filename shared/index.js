export const APP_NAME = 'RoomReport';

export const INSPECTION_TYPE_LABELS = {
  COMMON_AREA: 'Common Area',
  COMMON_AREA_QUICK: 'Common Area Quick Check',
  ROOM_TURN: 'Room Turn',
  QUARTERLY: 'Room Inspection',
  RESIDENT_SELF_CHECK: 'Self-Check',
  MOVE_IN_OUT: 'Move-In',
};

// Brand-consistent accents for each inspection type (reused on
// Dashboard, Calendar, Start Inspection picker, etc.)
export const INSPECTION_TYPE_COLORS = {
  QUARTERLY: { bg: '#E8F0E9', color: '#3B6D11' },
  ROOM_TURN: { bg: '#FAEEDA', color: '#854F0B' },
  COMMON_AREA: { bg: '#E3EDF7', color: '#2B5F8A' },
  COMMON_AREA_QUICK: { bg: '#E3EDF7', color: '#2B5F8A' },
  RESIDENT_SELF_CHECK: { bg: '#F5E8F0', color: '#8A2B6D' },
  MOVE_IN_OUT: { bg: '#F0E8E3', color: '#6D3B11' },
};

export {
  PLANS,
  PLAN_LABELS,
  PLAN_PRICES,
  PLAN_TAGLINES,
  FEATURES,
  FEATURE_META,
  PLAN_LIMITS,
  requiredPlan,
  featureLabel,
  featureDescription,
  canAccess,
  planLimit,
  wouldExceed,
} from './features.js';

export const DEFAULT_FEATURES = [
  'Ensuite Bathroom',
  'Mini Fridge',
  'Microwave',
  'Separate Entry',
  'Window AC',
  'In-Unit Washer/Dryer',
  'Balcony/Patio',
  'Basement Room',
];

export const DEFAULT_FURNITURE = [
  'Bed Frame',
  'Mattress',
  'Nightstand',
  'Dresser',
  'Desk',
  'Desk Chair',
  'Clothing Rack',
  'Mirror',
  'Trash Can',
  'Lamp',
  'Curtains/Blinds',
  'TV',
];

// Maintenance/flag categories used across inspections, maintenance filters
export const FLAG_CATEGORIES = [
  'Electrical',
  'Plumbing',
  'HVAC',
  'Locks & Security',
  'Appliances',
  'Pest Control',
  'Exterior & Landscaping',
  'Cleaning',
  'Furniture & Fixtures',
  'Safety',
  'Internet & Tech',
  'Surfaces',
  'General',
];

export const ROLE_LABELS = {
  OWNER: 'Owner',
  PM: 'Property Manager',
  CLEANER: 'Cleaner',
  HANDYPERSON: 'Handyperson',
  RESIDENT: 'Resident',
  OTHER: 'Other',
};

export function roleLabel(role, customRole) {
  if (role === 'OTHER' && customRole) return customRole;
  return ROLE_LABELS[role] || role;
}

// ─── Priority ───────────────────────────────────────────

export const PRIORITIES = ['High', 'Medium', 'Low'];

export const PRIORITY_COLORS = {
  High: '#C0392B',
  Medium: '#C4703F',
  Low: '#6B8F71',
};

// Category → suggested priority. Everything else defaults to Medium.
const HIGH_CATEGORIES = ['Safety', 'Plumbing', 'Electrical'];
const LOW_CATEGORIES = ['Cleaning', 'Surfaces', 'Furniture & Fixtures'];

export function suggestPriority(category) {
  if (HIGH_CATEGORIES.includes(category)) return 'High';
  if (LOW_CATEGORIES.includes(category)) return 'Low';
  return 'Medium';
}

export const ATTACHMENT_LABELS = ['quote', 'receipt', 'invoice', 'other'];

// Map legacy categories to current ones so old data still fits filters
export const LEGACY_CATEGORY_MAP = {
  'Maintenance': 'General',
  'Pest': 'Pest Control',
  'Lease Violation': 'General',
  'Cleanliness': 'Cleaning',
  'Other': 'General',
};

