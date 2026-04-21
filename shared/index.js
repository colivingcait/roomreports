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

// Compliance / lease-violation pill palette.
// Keyed by the pill's display text (which is also stored as the
// InspectionItem.text server-side). Each entry pairs a soft unselected
// background with a saturated "selected" background that reads as the
// same hue but clearly asserts the pill is on.
//   bg / fg / border  — idle
//   selBg / selFg     — selected (border matches selBg)
export const COMPLIANCE_PILL_COLORS = {
  'Messy':                            { bg: '#F1E5D6', fg: '#6B4524', border: '#D8B88E', selBg: '#7A4A25', selFg: '#fff' },
  'Bad odor':                         { bg: '#EFE9CC', fg: '#5F5213', border: '#CEC182', selBg: '#7A6D1F', selFg: '#fff' },
  'Smoking':                          { bg: '#E6E3DF', fg: '#3E3B39', border: '#B9B5B1', selBg: '#4A4543', selFg: '#fff' },
  'Unauthorized guests':              { bg: '#EADCEC', fg: '#5A2075', border: '#C9A7CE', selBg: '#6D2B8A', selFg: '#fff' },
  'Pets':                             { bg: '#D6EAE6', fg: '#1F5754', border: '#95C7BE', selBg: '#2B6D6D', selFg: '#fff' },
  'Open food':                        { bg: '#F8E2CB', fg: '#8C4F13', border: '#E6B98D', selBg: '#B06D2B', selFg: '#fff' },
  'Pests/bugs':                       { bg: '#D8E8D7', fg: '#235029', border: '#9AC6A1', selBg: '#2D6D3B', selFg: '#fff' },
  'Open flames/candles':              { bg: '#F8EBC6', fg: '#8A6609', border: '#E6CE82', selBg: '#B58A0F', selFg: '#fff' },
  'Overloaded outlets':               { bg: '#F4D6D0', fg: '#7F241A', border: '#DA968C', selBg: '#A03020', selFg: '#fff' },
  'Kitchen appliances in room':       { bg: '#DBE3ED', fg: '#2C3F5F', border: '#9FB1C9', selBg: '#3A5680', selFg: '#fff' },
  'Lithium batteries':                { bg: '#F6DBC7', fg: '#8B4917', border: '#E3A97F', selBg: '#B86020', selFg: '#fff' },
  'Modifications (paint, holes, etc.)': { bg: '#DEE8D9', fg: '#3C5D34', border: '#A6C098', selBg: '#4F7A43', selFg: '#fff' },
  'Drug paraphernalia':               { bg: '#F0D6E2', fg: '#6F2048', border: '#D79AB5', selBg: '#8A2B5A', selFg: '#fff' },
  'Weapons':                          { bg: '#E8D0D0', fg: '#5E1818', border: '#C48E8E', selBg: '#7A1F1F', selFg: '#fff' },
  'Unclear egress path':              { bg: '#F5E2C2', fg: '#6F470B', border: '#DDB978', selBg: '#8A5A0F', selFg: '#fff' },
};

// Default for any pill text not in the map (future-proof)
export const COMPLIANCE_PILL_DEFAULT = {
  bg: '#F5F2EF', fg: '#4A4543', border: '#D4D0CE', selBg: '#C0392B', selFg: '#fff',
};

export function pillColors(text) {
  return COMPLIANCE_PILL_COLORS[text] || COMPLIANCE_PILL_DEFAULT;
}

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

