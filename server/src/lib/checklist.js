// ─── Inspection Checklist Generator ─────────────────────
//
// Dynamically generates inspection items based on:
//   - Inspection type
//   - Property config (kitchens, bathrooms, labels)
//   - Room config (features, furniture)
//
// Each item: { zone, text, options, status }

const STATUS_OPTIONS = ['Pass', 'Fail', 'N/A'];
const CONDITION_OPTIONS = ['Good', 'Fair', 'Poor', 'Missing'];
const DETAILED_CONDITION = ['Excellent', 'Good', 'Fair', 'Damaged', 'Heavily Damaged'];
const CLEAN_OPTIONS = ['Clean', 'Needs Attention', 'Dirty'];
const YES_NO = ['Yes', 'No'];

function item(zone, text, options = STATUS_OPTIONS) {
  return { zone, text, options, status: '' };
}

// ─── COMMON_AREA ────────────────────────────────────────

function generateCommonArea(property) {
  const items = [];

  // Entryway / Exterior
  items.push(
    item('Entryway', 'Front door and lock functioning'),
    item('Entryway', 'Doorbell / intercom working'),
    item('Entryway', 'Mailbox area clean and organized'),
    item('Entryway', 'Hallway floors swept/mopped'),
    item('Entryway', 'Hallway lights working'),
    item('Entryway', 'Shoe rack / storage area tidy'),
  );

  // Living / Common Room
  items.push(
    item('Common Room', 'Floors vacuumed/mopped'),
    item('Common Room', 'Furniture clean and in good condition', CONDITION_OPTIONS),
    item('Common Room', 'Windows clean'),
    item('Common Room', 'Blinds/curtains condition', CONDITION_OPTIONS),
    item('Common Room', 'Light fixtures working'),
    item('Common Room', 'Trash emptied'),
    item('Common Room', 'TV/entertainment area tidy'),
  );

  // Kitchens (dynamic per property)
  for (const kitchen of property.kitchens || []) {
    const z = kitchen.label || 'Kitchen';
    items.push(
      item(z, 'Countertops wiped down', CLEAN_OPTIONS),
      item(z, 'Sink clean and draining', CLEAN_OPTIONS),
      item(z, 'Stovetop/oven clean', CLEAN_OPTIONS),
      item(z, 'Microwave clean (inside and out)', CLEAN_OPTIONS),
      item(z, 'Refrigerator clean (interior)', CLEAN_OPTIONS),
      item(z, 'Refrigerator clean (exterior)', CLEAN_OPTIONS),
      item(z, 'Dishwasher empty and clean'),
      item(z, 'Trash and recycling emptied'),
      item(z, 'Floor swept and mopped', CLEAN_OPTIONS),
      item(z, 'Cabinets organized'),
      item(z, 'No expired food'),
      item(z, 'Paper towels / soap stocked', YES_NO),
    );
  }

  // Bathrooms (dynamic per property)
  for (const bathroom of property.bathrooms || []) {
    const z = bathroom.label || 'Bathroom';
    items.push(
      item(z, 'Toilet clean', CLEAN_OPTIONS),
      item(z, 'Sink and counter clean', CLEAN_OPTIONS),
      item(z, 'Mirror clean'),
      item(z, 'Shower/tub clean', CLEAN_OPTIONS),
      item(z, 'Floor clean', CLEAN_OPTIONS),
      item(z, 'Trash emptied'),
      item(z, 'Toilet paper stocked', YES_NO),
      item(z, 'Hand soap stocked', YES_NO),
      item(z, 'Drain flowing properly'),
      item(z, 'No mold or mildew'),
      item(z, 'Exhaust fan working'),
    );
  }

  // Laundry
  items.push(
    item('Laundry', 'Washer clean and empty'),
    item('Laundry', 'Dryer lint trap cleaned'),
    item('Laundry', 'Laundry area floor clean', CLEAN_OPTIONS),
    item('Laundry', 'Detergent / supplies stocked', YES_NO),
  );

  // Outdoor / Exterior
  items.push(
    item('Exterior', 'Porch/patio swept'),
    item('Exterior', 'Outdoor furniture condition', CONDITION_OPTIONS),
    item('Exterior', 'Trash bins at curb / organized'),
    item('Exterior', 'Yard / lawn maintained'),
    item('Exterior', 'Exterior lights working'),
  );

  return items;
}

// ─── ROOM_TURN ──────────────────────────────────────────

function generateRoomTurn(property, room) {
  const items = [];

  // General room condition
  items.push(
    item('General', 'Walls — no marks, holes, or damage', CONDITION_OPTIONS),
    item('General', 'Ceiling — no stains or damage', CONDITION_OPTIONS),
    item('General', 'Floor — clean and undamaged', CONDITION_OPTIONS),
    item('General', 'Door and lock functioning'),
    item('General', 'Windows open/close properly'),
    item('General', 'Window screens intact'),
    item('General', 'Light switches working'),
    item('General', 'Outlets working'),
    item('General', 'Smoke detector present and working'),
  );

  // Furniture (dynamic from room config)
  for (const f of room?.furniture || []) {
    items.push(item('Furniture', `${f} — present and condition`, CONDITION_OPTIONS));
  }

  // Features (dynamic from room config)
  if (room?.features?.includes('Ensuite Bathroom')) {
    items.push(
      item('Ensuite Bathroom', 'Toilet clean and functioning', CLEAN_OPTIONS),
      item('Ensuite Bathroom', 'Sink clean and draining', CLEAN_OPTIONS),
      item('Ensuite Bathroom', 'Shower/tub clean', CLEAN_OPTIONS),
      item('Ensuite Bathroom', 'Mirror clean'),
      item('Ensuite Bathroom', 'Floor clean', CLEAN_OPTIONS),
      item('Ensuite Bathroom', 'No mold or mildew'),
      item('Ensuite Bathroom', 'Exhaust fan working'),
    );
  }

  if (room?.features?.includes('Mini Fridge')) {
    items.push(
      item('Appliances', 'Mini fridge — clean and functioning', CONDITION_OPTIONS),
    );
  }

  if (room?.features?.includes('Window AC')) {
    items.push(
      item('Appliances', 'Window AC — functioning and filter clean', CONDITION_OPTIONS),
    );
  }

  if (room?.features?.includes('In-Unit Washer/Dryer')) {
    items.push(
      item('Appliances', 'Washer — functioning', CONDITION_OPTIONS),
      item('Appliances', 'Dryer — functioning and lint trap clean', CONDITION_OPTIONS),
    );
  }

  if (room?.features?.includes('Balcony/Patio')) {
    items.push(
      item('Balcony/Patio', 'Balcony/patio swept and clean'),
      item('Balcony/Patio', 'Railing secure'),
    );
  }

  if (room?.features?.includes('Separate Entry')) {
    items.push(
      item('Entry', 'Separate entry door and lock functioning'),
    );
  }

  // Cleaning checklist
  items.push(
    item('Cleaning', 'All surfaces dusted'),
    item('Cleaning', 'Floor vacuumed/mopped'),
    item('Cleaning', 'Inside closet/wardrobe cleaned'),
    item('Cleaning', 'Windows cleaned'),
    item('Cleaning', 'Trash removed'),
    item('Cleaning', 'Linens fresh (if provided)', YES_NO),
  );

  return items;
}

// ─── QUARTERLY ──────────────────────────────────────────

function generateQuarterly(property, room) {
  const items = [];
  const pf = (zone, text) => item(zone, text, ['Pass', 'Fail']);

  // Room Condition
  items.push(
    pf('Room Condition', 'Room is clean and tidy'),
    pf('Room Condition', 'No unusual odors'),
    pf('Room Condition', 'Walls, floors, and ceiling in good condition'),
    pf('Room Condition', 'Windows and locks functional'),
    pf('Room Condition', 'Door and lock functional'),
    pf('Room Condition', 'No pests or pest evidence'),
    pf('Room Condition', 'No mold or moisture issues'),
    pf('Room Condition', 'All furniture in good condition'),
    pf('Room Condition', 'Mattress encasement in use'),
  );

  // Safety
  items.push(
    pf('Safety', 'Smoke detector present and working'),
    pf('Safety', 'No overloaded outlets or daisy-chaining'),
    pf('Safety', 'Egress path clear'),
  );

  // Compliance
  items.push(
    pf('Compliance', 'No open food or improper food storage'),
    pf('Compliance', 'No smoking evidence'),
    pf('Compliance', 'No open flames, candles, or incense'),
    pf('Compliance', 'No lithium battery chargers (hoverboards, scooters)'),
    pf('Compliance', 'No unauthorized occupants or guests'),
    pf('Compliance', 'No unauthorized pets'),
    pf('Compliance', 'No unauthorized modifications'),
    pf('Compliance', 'No prohibited appliances (space heaters, hot plates)'),
    pf('Compliance', 'No prohibited substances or paraphernalia'),
    pf('Compliance', 'No prohibited weapons'),
  );

  // Feature-specific
  if (room?.features?.includes('Ensuite Bathroom')) {
    items.push(pf('Features', 'Ensuite bathroom clean and functional'));
  }
  if (room?.features?.includes('Mini Fridge')) {
    items.push(pf('Features', 'Mini fridge clean and working'));
  }
  if (room?.features?.includes('Separate Entry')) {
    items.push(pf('Features', 'Separate entry lock functional'));
  }
  if (room?.features?.includes('Window AC')) {
    items.push(pf('Features', 'Window AC unit working properly'));
  }
  if (room?.features?.includes('Basement Room')) {
    items.push(pf('Features', 'No basement moisture or seepage'));
  }

  return items;
}

// ─── RESIDENT_SELF_CHECK ────────────────────────────────

function generateResidentSelfCheck(property, room) {
  const items = [];

  // Overall room condition
  items.push(
    item('Your Room', 'How does your room look overall?', ['Clean', 'Could Use Attention', 'Needs Help']),
  );

  // Under sink check (always applies — shared or ensuite)
  items.push(
    item('Under Sink', 'Any issues under your sink?', ['Looks Good', 'I See a Problem']),
  );

  // Bathroom (if ensuite)
  if (room?.features?.includes('Ensuite Bathroom')) {
    items.push(
      item('Bathroom', 'How\u2019s your bathroom?', ['Clean', 'Needs Cleaning', 'Something\u2019s Broken']),
    );
  }

  // Closet
  items.push(
    item('Closet', 'Check your closet area', ['All Good', 'Issue to Report']),
  );

  // Floors
  items.push(
    item('Floors', 'Look at your floors', ['Good Shape', 'Wear or Damage']),
  );

  // Walls
  items.push(
    item('Walls', 'Check your walls', ['Good Shape', 'Marks or Damage']),
  );

  // Pests
  items.push(
    item('Pests', 'Any pests spotted?', ['None', 'Yes']),
  );

  // Catch-all
  items.push(
    item('Anything Else', 'Anything that needs fixing?', ['Nothing', 'Yes — Let me tell you']),
  );

  return items;
}

// Items (by text) that should strongly prompt photos in the resident UI
export const RESIDENT_PHOTO_PROMPTS = new Set([
  'How does your room look overall?',
  'Any issues under your sink?',
  'How\u2019s your bathroom?',
  'Check your closet area',
]);

// ─── MOVE_IN_OUT ────────────────────────────────────────

function generateMoveInOut(property, room, direction) {
  const items = [];

  // Metadata item: stores direction (Move-In/Move-Out). Filtered out in UI.
  if (direction) {
    items.push({
      zone: '_Direction',
      text: 'Inspection direction',
      options: ['Move-In', 'Move-Out'],
      status: direction,
    });
  }

  const cond = (zone, text) => item(zone, text, DETAILED_CONDITION);

  // Walls — each direction documented separately
  items.push(
    cond('Walls', 'North wall — condition'),
    cond('Walls', 'South wall — condition'),
    cond('Walls', 'East wall — condition'),
    cond('Walls', 'West wall — condition'),
    cond('Ceiling', 'Ceiling — condition'),
    cond('Floor', 'Floor — condition'),
  );

  // Door and windows
  items.push(
    cond('Door', 'Door — condition'),
    cond('Door', 'Door handle, hinges, and lock'),
    cond('Windows', 'Window #1 — glass condition'),
    cond('Windows', 'Window #1 — screen condition'),
    cond('Windows', 'Window #1 — lock and hardware'),
  );

  // Closet
  items.push(
    cond('Closet', 'Closet door or curtain'),
    cond('Closet', 'Closet rod and shelves'),
    item('Closet', 'Closet interior — cleanliness', CLEAN_OPTIONS),
  );

  // Electrical — itemized
  items.push(
    cond('Electrical', 'Main light fixture — condition'),
    cond('Electrical', 'Light switch — condition'),
    cond('Electrical', 'Outlet #1 — condition and function'),
    cond('Electrical', 'Outlet #2 — condition and function'),
    item('Electrical', 'Smoke detector — present and tested', YES_NO),
    item('Electrical', 'CO detector — present and tested', YES_NO),
  );

  // Furniture inventory (dynamic) — each item individually documented
  for (const f of room?.furniture || []) {
    items.push(cond('Furniture', `${f} — condition`));
  }

  // Feature-specific
  if (room?.features?.includes('Ensuite Bathroom')) {
    items.push(
      cond('Ensuite Bathroom', 'Toilet — condition'),
      cond('Ensuite Bathroom', 'Sink and faucet — condition'),
      cond('Ensuite Bathroom', 'Shower/tub — condition'),
      cond('Ensuite Bathroom', 'Mirror — condition'),
      cond('Ensuite Bathroom', 'Tile and grout — condition'),
      cond('Ensuite Bathroom', 'Caulking — condition'),
      cond('Ensuite Bathroom', 'Floor — condition'),
      cond('Ensuite Bathroom', 'Exhaust fan — function'),
      item('Ensuite Bathroom', 'Plumbing — no leaks', YES_NO),
    );
  }

  if (room?.features?.includes('Mini Fridge')) {
    items.push(cond('Appliances', 'Mini fridge — condition and function'));
  }

  if (room?.features?.includes('Window AC')) {
    items.push(cond('Appliances', 'Window AC — condition and function'));
  }

  if (room?.features?.includes('In-Unit Washer/Dryer')) {
    items.push(
      cond('Appliances', 'Washer — condition and function'),
      cond('Appliances', 'Dryer — condition and function'),
    );
  }

  if (room?.features?.includes('Balcony/Patio')) {
    items.push(
      cond('Balcony/Patio', 'Balcony/patio surface — condition'),
      cond('Balcony/Patio', 'Railing — condition'),
    );
  }

  if (room?.features?.includes('Separate Entry')) {
    items.push(
      cond('Entry', 'Separate entry door — condition'),
      cond('Entry', 'Entry lock — condition'),
    );
  }

  // Overall
  items.push(
    item('Overall', 'General cleanliness', CLEAN_OPTIONS),
    item('Overall', 'Keys and access devices returned', YES_NO),
  );

  return items;
}

// ─── Main generator ─────────────────────────────────────

export function generateChecklist(type, property, room, options = {}) {
  switch (type) {
    case 'COMMON_AREA':
      return generateCommonArea(property);
    case 'ROOM_TURN':
      return generateRoomTurn(property, room);
    case 'QUARTERLY':
      return generateQuarterly(property, room);
    case 'RESIDENT_SELF_CHECK':
      return generateResidentSelfCheck(property, room);
    case 'MOVE_IN_OUT':
      return generateMoveInOut(property, room, options.direction);
    default:
      throw new Error(`Unknown inspection type: ${type}`);
  }
}

// Types that require a room
export const ROOM_TYPES = ['ROOM_TURN', 'QUARTERLY', 'RESIDENT_SELF_CHECK', 'MOVE_IN_OUT'];
export const PROPERTY_ONLY_TYPES = ['COMMON_AREA'];
