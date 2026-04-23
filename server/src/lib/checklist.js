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
//
// Each area is a separate "card" the inspector picks. Items are zoned by
// `<AreaKey>` so the frontend can group them. Section headings within an
// area are represented as items with `options: ['_section']` (the
// frontend renders them as dividers, not as pass/fail rows). Per-area
// completion is tracked with an `_Completed:<AreaKey>` marker, mirroring
// the quarterly room flow.
//
// AreaKey conventions:
//   `Kitchen:<label>`     — one per configured kitchen
//   `Bathroom:<label>`    — one per configured shared bathroom
//   `Laundry`             — always included
//   `Living`              — always included
//   `Exterior`            — always included
//
// MISC items are added dynamically by the user during inspection
// (zone `Misc:<AreaKey>`) — the generator does not pre-create them.

function generateCommonArea(property) {
  const items = [];
  const pf = (zone, text) => item(zone, text, ['Pass', 'Fail']);
  const section = (zone, text) => ({ zone, text, options: ['_section'], status: '' });
  const completed = (zone) => ({ zone: `_Completed:${zone}`, text: 'Area completed', options: ['Yes'], status: '' });

  // Kitchens (repeat per labeled kitchen)
  for (const kitchen of property.kitchens || []) {
    const z = `Kitchen:${kitchen.label || 'Kitchen'}`;
    items.push(
      section(z, 'Surfaces'),
      pf(z, 'Counters clean'),
      pf(z, 'Sink clean and functional'),
      pf(z, 'Cabinet fronts/handles clean'),
      pf(z, 'Floors clean'),
      section(z, 'Appliances'),
      pf(z, 'Stove/oven clean'),
      pf(z, 'Fridge clean interior/exterior'),
      pf(z, 'Microwave clean'),
      pf(z, 'Dishwasher/garbage disposal working'),
      section(z, 'Reset'),
      pf(z, 'Trash taken to curb'),
      pf(z, 'Supplies stocked (paper towels, soap, trash bags)'),
      pf(z, 'Lights working'),
      pf(z, 'No pests, mold, odors, etc.'),
      pf(z, 'No visible water leak under the sink/around the faucet'),
      completed(z),
    );
  }

  // Shared Bathrooms (repeat per labeled bathroom)
  for (const bathroom of property.bathrooms || []) {
    const z = `Bathroom:${bathroom.label || 'Shared Bathroom'}`;
    items.push(
      section(z, 'Surfaces'),
      pf(z, 'Counters clean'),
      pf(z, 'Mirror clean'),
      pf(z, 'Sink clean and functional'),
      pf(z, 'Floors clean'),
      section(z, 'Fixtures'),
      pf(z, 'Shower/tub clean'),
      pf(z, 'Shower head/faucet clean'),
      pf(z, 'Toilet clean and functional'),
      pf(z, 'Shower curtain/door in good condition'),
      pf(z, 'Lights functional'),
      section(z, 'Reset'),
      pf(z, 'Exhaust fan working'),
      pf(z, 'No visible leaks under sink'),
      pf(z, 'No leaks around toilet or running water noise'),
      pf(z, 'Supplies stocked (toilet paper, soap)'),
      pf(z, 'No pests, mold, odors, etc.'),
      completed(z),
    );
  }

  // Laundry — always included
  items.push(
    pf('Laundry', 'Washer clean and functional'),
    pf('Laundry', 'Dryer clean and functional'),
    pf('Laundry', 'Lint trap cleaned'),
    pf('Laundry', 'Floor clean'),
    pf('Laundry', 'No visible water leaks on floor'),
    pf('Laundry', 'Lights working'),
    completed('Laundry'),
  );

  // Living / Common Areas — always included
  items.push(
    pf('Living', 'Furniture in good condition'),
    pf('Living', 'Floors clean'),
    pf('Living', 'Windows/blinds clean'),
    pf('Living', 'Lights working'),
    pf('Living', 'No clutter'),
    pf('Living', 'Vents/filters clean'),
    completed('Living'),
  );

  // Exterior — always included
  items.push(
    pf('Exterior', 'Porch/steps in good condition'),
    pf('Exterior', 'Exterior lighting working'),
    pf('Exterior', 'Front door functional'),
    pf('Exterior', 'Back door functional'),
    pf('Exterior', 'Landscaping looks maintained'),
    pf('Exterior', 'Trash area clean'),
    pf('Exterior', 'Parking area clear'),
    pf('Exterior', 'No standing water/visible water leaks'),
    completed('Exterior'),
  );

  return items;
}

// ─── COMMON_AREA_QUICK ──────────────────────────────────

function generateCommonAreaQuick(property) {
  const items = [];
  const pf = (zone, text) => item(zone, text, ['Pass', 'Fail']);

  for (const kitchen of property.kitchens || []) {
    items.push(pf('Kitchens', kitchen.label || 'Kitchen'));
  }
  for (const bathroom of property.bathrooms || []) {
    items.push(pf('Bathrooms', bathroom.label || 'Bathroom'));
  }

  // Misc catch-all so inspectors can note anything at the property level
  items.push(pf('Misc', 'Anything else worth noting in common areas'));

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

export const QUARTERLY_COMPLIANCE_PILLS = [
  'Messy',
  'Bad odor',
  'Smoking',
  'Unauthorized guests',
  'Pets',
  'Open food',
  'Pests/bugs',
  'Open flames/candles',
  'Overloaded outlets',
  'Kitchen appliances in room',
  'Lithium batteries',
  'Modifications (paint, holes, etc.)',
  'Drug paraphernalia',
  'Weapons',
  'Unclear egress path',
];

function generateQuarterly(property, room) {
  const items = [];
  const pf = (zone, text) => item(zone, text, ['Pass', 'Fail']);

  // ─── Core maintenance items (no section headings in the UI) ─
  items.push(
    pf('Maintenance', 'Door & lock functional'),
    pf('Maintenance', 'Walls, floors, ceiling in good condition'),
    pf('Maintenance', 'Window functional'),
    pf('Maintenance', 'Furniture in good condition'),
    pf('Maintenance', 'Mattress encasement in use'),
    pf('Maintenance', 'Smoke detector working'),
    pf('Maintenance', 'No mold/moisture present'),
  );

  // ─── Feature-specific (shown with a divider + feature label) ─
  if (room?.features?.includes('Ensuite Bathroom')) {
    items.push(
      pf('Ensuite Bathroom', 'Toilet functional'),
      pf('Ensuite Bathroom', 'Sink functional'),
      pf('Ensuite Bathroom', 'Shower/tub functional'),
      pf('Ensuite Bathroom', 'Shower curtain/door in good condition'),
      pf('Ensuite Bathroom', 'Exhaust fan working'),
      pf('Ensuite Bathroom', 'No leaks under sink'),
      pf('Ensuite Bathroom', 'No mold/mildew present'),
      pf('Ensuite Bathroom', 'Floors in good condition'),
    );
  }
  if (room?.features?.includes('Mini Fridge')) {
    items.push(pf('Mini Fridge', 'Mini fridge clean and working'));
  }
  if (room?.features?.includes('Window AC')) {
    items.push(pf('Window AC', 'Window AC unit working'));
  }
  if (room?.features?.includes('Microwave')) {
    items.push(pf('Microwave', 'Microwave clean and working'));
  }
  if (room?.features?.includes('Basement Room')) {
    items.push(
      pf('Basement Room', 'No moisture/water intrusion'),
      pf('Basement Room', 'Dehumidifier working (if applicable)'),
    );
  }
  if (room?.features?.includes('Separate Entry')) {
    items.push(
      pf('Separate Entry', 'Separate entry door & lock functional'),
      pf('Separate Entry', 'Exterior light working'),
    );
  }

  // ─── Compliance — 15 pill options ─
  for (const p of QUARTERLY_COMPLIANCE_PILLS) {
    items.push(pf('Compliance', p));
  }

  // ─── Misc — user adds items dynamically via "+ Add another" ─
  // (no pre-created items)

  // ─── Synthetic marker — set to "Yes" when user hits "Done with Room" ─
  items.push({ zone: '_Completed', text: 'Room completed', options: ['Yes'], status: '' });

  return items;
}


// ─── RESIDENT_SELF_CHECK ────────────────────────────────

function generateResidentSelfCheck(property, room) {
  const items = [];
  const photoItem = (text) => item('Photos', text, ['photo']);
  const yesNoItem = (text) => item('Questions', text, ['Yes', 'No']);

  // Photos (required — one per screen)
  items.push(
    photoItem('Take a photo of Wall 1'),
    photoItem('Take a photo of Wall 2'),
    photoItem('Take a photo of Wall 3'),
    photoItem('Take a photo of Wall 4'),
    photoItem('Take a photo of your mattress'),
    photoItem('Take a photo of your window(s)'),
    photoItem('Take a photo of your smoke detector'),
  );

  // Questions
  items.push(
    yesNoItem('Any pest issues?'),
    yesNoItem('Any mold or mildew?'),
    yesNoItem('Any water leaks?'),
    yesNoItem('Any broken furniture?'),
    yesNoItem('Is your door lock working properly?'),
    yesNoItem('Any other concerns?'),
  );

  return items;
}

// ─── MOVE_IN_OUT ────────────────────────────────────────

function generateMoveInOut(property, room, direction) {
  const items = [];
  const photoItem = (text) => item('Photos', text, ['photo']);
  const yesNoItem = (text) => item('Questions', text, ['Yes', 'No']);

  // Photos (required — baseline condition record)
  items.push(
    photoItem('Take a photo of Wall 1'),
    photoItem('Take a photo of Wall 2'),
    photoItem('Take a photo of Wall 3'),
    photoItem('Take a photo of Wall 4'),
    photoItem('Take a photo of the floor'),
    photoItem('Take a photo of the ceiling'),
    photoItem('Take a photo of your window(s)'),
    photoItem('Take a photo of the closet/clothing rack'),
    photoItem('Take a photo of the mattress'),
  );

  if (room?.features?.includes('Ensuite Bathroom')) {
    items.push(photoItem('Take a photo of the bathroom'));
  }

  // Questions
  items.push(
    yesNoItem('Room is clean and ready?'),
    yesNoItem('No unusual odors?'),
    yesNoItem('All furniture present and in good condition?'),
    yesNoItem('Door lock working properly?'),
    yesNoItem('Lights and outlets all working?'),
    yesNoItem('Smoke detector present?'),
    yesNoItem('Any existing damage to note?'),
    yesNoItem('Everything looks good overall?'),
  );

  return items;
}

// ─── Main generator ─────────────────────────────────────

export function generateChecklist(type, property, room, options = {}) {
  switch (type) {
    case 'COMMON_AREA':
      return generateCommonArea(property);
    case 'COMMON_AREA_QUICK':
      return generateCommonAreaQuick(property);
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
export const PROPERTY_ONLY_TYPES = ['COMMON_AREA', 'COMMON_AREA_QUICK'];

// Template-aware variant: if the org has customized items for this inspection
// type, use those; otherwise fall back to the built-in defaults. Property/
// room-specific items (kitchens, bathrooms, furniture, etc.) are still
// appended from the defaults so the template covers the per-org customizable
// "common" items without duplicating per-room dynamic ones.
export async function buildChecklist(prisma, organizationId, type, property, room, options = {}) {
  // QUARTERLY, COMMON_AREA, and COMMON_AREA_QUICK drive multi-screen UIs
  // that depend on zone structure derived from the property config (per-
  // kitchen / per-bathroom areas, _Completed:<area> markers, _section
  // dividers, etc.). Bypass any org template for these and always use the
  // generator so the UI renders correctly with the latest property config.
  if (type === 'QUARTERLY' || type === 'COMMON_AREA' || type === 'COMMON_AREA_QUICK') {
    return generateChecklist(type, property, room, options);
  }

  const template = await prisma.inspectionTemplate.findUnique({
    where: { organizationId_inspectionType: { organizationId, inspectionType: type } },
    include: { items: { orderBy: { position: 'asc' } } },
  });

  if (!template || template.items.length === 0) {
    return generateChecklist(type, property, room, options);
  }

  return template.items.map((t) => ({
    zone: t.zone,
    text: t.text,
    options: Array.isArray(t.options) && t.options.length > 0 ? t.options : ['Pass', 'Fail', 'N/A'],
    status: '',
  }));
}
