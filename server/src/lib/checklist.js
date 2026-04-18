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
  const pf = (zone, text) => item(zone, text, ['Pass', 'Fail']);

  // Kitchens (repeat per labeled kitchen)
  for (const kitchen of property.kitchens || []) {
    const z = kitchen.label || 'Kitchen';
    items.push(
      pf(z, 'Counters and surfaces clean'),
      pf(z, 'Sink clean and draining properly'),
      pf(z, 'Stovetop and oven clean'),
      pf(z, 'Refrigerator clean, temp OK, no expired food'),
      pf(z, 'Microwave clean and working'),
      pf(z, 'Disposal working (if applicable)'),
      pf(z, 'Dishwasher clean and working (if applicable)'),
      pf(z, 'Cabinets clean'),
      pf(z, 'Floors clean, no damage'),
      pf(z, 'Trash and recycling taken to curb'),
      pf(z, 'Light fixtures working'),
      pf(z, 'No pest evidence'),
      pf(z, 'No mold or mildew'),
      pf(z, 'No unusual odors'),
      pf(z, 'Supplies stocked (paper towels, dish soap, Clorox wipes)'),
    );
  }

  // Shared Bathrooms (repeat per labeled bathroom)
  for (const bathroom of property.bathrooms || []) {
    const z = bathroom.label || 'Shared Bathroom';
    items.push(
      pf(z, 'Toilet clean, flushing properly, no leaks'),
      pf(z, 'Sink clean and draining properly'),
      pf(z, 'Shower/tub clean, draining, caulk intact'),
      pf(z, 'Shower curtain or door clean & intact'),
      pf(z, 'Mirror clean'),
      pf(z, 'Exhaust fan clean & working'),
      pf(z, 'Floors clean, no damage'),
      pf(z, 'No leaks under sink'),
      pf(z, 'Light fixtures working'),
      pf(z, 'Supplies stocked (toilet paper, hand soap)'),
      pf(z, 'No mold or mildew'),
      pf(z, 'No pest evidence'),
      pf(z, 'No unusual odors'),
    );
  }

  // Common Areas
  items.push(
    pf('Common Areas', 'Furniture clean and in good condition'),
    pf('Common Areas', 'Floors clean, no damage'),
    pf('Common Areas', 'Windows/blinds clean'),
    pf('Common Areas', 'Light fixtures dusted & working'),
    pf('Common Areas', 'No clutter or personal items left out'),
    pf('Common Areas', 'Vents clean and working'),
    pf('Common Areas', 'Washer and dryer clean and working'),
    pf('Common Areas', 'Lint trap cleaned, no debris around machines'),
  );

  // Exterior
  items.push(
    pf('Exterior', 'Porch/steps clean, no hazards'),
    pf('Exterior', 'Exterior lighting working (front and back)'),
    pf('Exterior', 'Front door and lock functional'),
    pf('Exterior', 'Back door and lock functional'),
    pf('Exterior', 'Landscaping maintained'),
    pf('Exterior', 'Address numbers visible'),
    pf('Exterior', 'Back porch/patio clean, no hazards'),
    pf('Exterior', 'Trash cans/dumpster area clean and organized'),
    pf('Exterior', 'Parking area clear, no debris'),
    pf('Exterior', 'No standing water or drainage issues'),
  );

  // Misc
  items.push(
    pf('Misc', 'Misc (catch-all for anything not covered above)'),
  );

  return items;
}

// ─── ROOM_TURN ──────────────────────────────────────────

function generateRoomTurn(property, room) {
  const items = [];
  const pf = (zone, text) => item(zone, text, ['Pass', 'Fail']);

  // Room Turn Clean
  items.push(
    pf('Room Turn Clean', 'All surfaces wiped down and sanitized'),
    pf('Room Turn Clean', 'Floors mopped/vacuumed'),
    pf('Room Turn Clean', 'Baseboards wiped clean'),
    pf('Room Turn Clean', 'Ceiling fan(s) dusted'),
    pf('Room Turn Clean', 'Vents/registers dusted'),
    pf('Room Turn Clean', 'Windows wiped and dusted'),
    pf('Room Turn Clean', 'Blinds cleaned'),
    pf('Room Turn Clean', 'Light switches and outlets wiped down'),
    pf('Room Turn Clean', 'Door and handle cleaned and sanitized'),
    pf('Room Turn Clean', 'Closet shelves/rod wiped clean'),
  );

  // Door & Locks
  items.push(
    pf('Door & Locks', 'Door lock working and code removed'),
    pf('Door & Locks', 'Keypad cleaned'),
    pf('Door & Locks', 'Door closes and latches properly'),
  );

  // Mattress & Bedding
  items.push(
    pf('Mattress & Bedding', 'Mattress encasement replaced with new'),
    pf('Mattress & Bedding', 'Mattress in good condition (no stains, sagging)'),
  );

  // Furniture & Electronics (per-furniture-item + standard)
  for (const f of room?.furniture || []) {
    items.push(pf('Furniture & Electronics', `${f} present and in good condition`));
  }
  items.push(
    pf('Furniture & Electronics', 'TV remote present, working, and cleaned'),
    pf('Furniture & Electronics', 'Fan remote present, working, and cleaned'),
    pf('Furniture & Electronics', 'Trash can present and clean'),
  );

  // Paint & Surfaces
  items.push(
    pf('Paint & Surfaces', 'Walls — paint touch-ups needed?'),
    pf('Paint & Surfaces', 'Ceiling — paint touch-ups needed?'),
    pf('Paint & Surfaces', 'Trim/baseboards — paint touch-ups needed?'),
    pf('Paint & Surfaces', 'Door — paint touch-ups needed?'),
  );

  // Safety
  items.push(
    pf('Safety', 'Smoke detector present and tested'),
    pf('Safety', 'Fire extinguisher present'),
  );

  // Pest Check
  items.push(pf('Pest Check', 'No signs of pests'));

  // Feature-specific (auto-added based on room features)
  if (room?.features?.includes('Mini Fridge')) {
    items.push(pf('Features', 'Mini fridge cleaned inside and out, working'));
  }
  if (room?.features?.includes('Window AC')) {
    items.push(pf('Features', 'Window AC filter cleaned, drains properly'));
  }
  if (room?.features?.includes('Microwave')) {
    items.push(pf('Features', 'Microwave cleaned inside and out, working'));
  }
  if (room?.features?.includes('Separate Entry')) {
    items.push(
      pf('Features', 'Separate entry lock working, code removed'),
      pf('Features', 'Exterior entry light working'),
    );
  }
  if (room?.features?.includes('Balcony/Patio')) {
    items.push(pf('Features', 'Balcony/patio swept, railing secure'));
  }
  if (room?.features?.includes('Basement Room')) {
    items.push(pf('Features', 'No basement moisture or seepage'));
  }
  if (room?.features?.includes('In-Unit Washer/Dryer')) {
    items.push(pf('Features', 'Washer/dryer cleaned, vent clear'));
  }

  // Ensuite Bathroom (only if room has this feature)
  if (room?.features?.includes('Ensuite Bathroom')) {
    items.push(
      pf('Ensuite Bathroom', 'Toilet cleaned and sanitized'),
      pf('Ensuite Bathroom', 'Sink cleaned and draining properly'),
      pf('Ensuite Bathroom', 'Shower/tub cleaned, draining, caulk intact'),
      pf('Ensuite Bathroom', 'Shower curtain or door cleaned'),
      pf('Ensuite Bathroom', 'Mirror cleaned'),
      pf('Ensuite Bathroom', 'Exhaust fan cleaned and working'),
      pf('Ensuite Bathroom', 'Floors cleaned'),
      pf('Ensuite Bathroom', 'Under sink — no leaks, cleaned'),
      pf('Ensuite Bathroom', 'Light fixtures working'),
      pf('Ensuite Bathroom', 'No mold or mildew'),
    );
  }

  // Misc catch-all
  items.push(pf('Misc', 'Misc'));

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
  if (room?.features?.includes('Microwave')) {
    items.push(pf('Features', 'Microwave clean and working'));
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

  // Misc catch-all
  items.push(pf('Misc', 'Misc (catch-all for anything not covered above)'));

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

  // Misc catch-all
  items.push(item('Misc', 'Misc (catch-all for anything not covered above)', ['Pass', 'Fail']));

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
