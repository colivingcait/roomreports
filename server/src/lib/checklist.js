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

  // Room structure
  items.push(
    item('Structure', 'Walls — cracks, water damage, or peeling paint', CONDITION_OPTIONS),
    item('Structure', 'Ceiling — stains, cracks, or sagging', CONDITION_OPTIONS),
    item('Structure', 'Floor — damage, warping, or loose tiles', CONDITION_OPTIONS),
    item('Structure', 'Door — hinges, handle, and lock', CONDITION_OPTIONS),
    item('Structure', 'Windows — seals, glass, screens', CONDITION_OPTIONS),
  );

  // Safety
  items.push(
    item('Safety', 'Smoke detector — present and tested'),
    item('Safety', 'CO detector — present and tested'),
    item('Safety', 'No fire hazards (blocked exits, overloaded outlets)'),
    item('Safety', 'No unauthorized space heaters'),
    item('Safety', 'Electrical outlets — no damage or sparking', CONDITION_OPTIONS),
  );

  // Furniture condition
  for (const f of room?.furniture || []) {
    items.push(item('Furniture', `${f} — condition check`, CONDITION_OPTIONS));
  }

  // Feature-specific checks
  if (room?.features?.includes('Ensuite Bathroom')) {
    items.push(
      item('Ensuite Bathroom', 'Plumbing — no leaks'),
      item('Ensuite Bathroom', 'Caulking condition', CONDITION_OPTIONS),
      item('Ensuite Bathroom', 'Grout condition', CONDITION_OPTIONS),
      item('Ensuite Bathroom', 'Ventilation adequate'),
    );
  }

  if (room?.features?.includes('Window AC')) {
    items.push(
      item('HVAC', 'AC unit — filter replaced/cleaned'),
      item('HVAC', 'AC unit — no leaks or unusual noise'),
    );
  }

  // Pest check
  items.push(
    item('Pest', 'No signs of pests (droppings, damage, nests)'),
    item('Pest', 'No signs of bed bugs'),
  );

  // Cleanliness
  items.push(
    item('Cleanliness', 'Overall room cleanliness', CLEAN_OPTIONS),
    item('Cleanliness', 'No excessive clutter or hoarding'),
    item('Cleanliness', 'No unauthorized modifications to room'),
  );

  return items;
}

// ─── RESIDENT_SELF_CHECK ────────────────────────────────

function generateResidentSelfCheck(property, room) {
  const items = [];

  items.push(
    item('General', 'Smoke detector working (press test button)', YES_NO),
    item('General', 'All lights and switches working', YES_NO),
    item('General', 'All outlets working', YES_NO),
    item('General', 'Door lock functioning properly', YES_NO),
    item('General', 'Windows open and close properly', YES_NO),
  );

  // Maintenance concerns
  items.push(
    item('Maintenance', 'Any water leaks or water damage?', YES_NO),
    item('Maintenance', 'Any pest issues?', YES_NO),
    item('Maintenance', 'Any mold or mildew?', YES_NO),
    item('Maintenance', 'Any damage to walls, floor, or ceiling?', YES_NO),
    item('Maintenance', 'Any broken furniture or fixtures?', YES_NO),
  );

  if (room?.features?.includes('Ensuite Bathroom')) {
    items.push(
      item('Ensuite Bathroom', 'Toilet flushing properly', YES_NO),
      item('Ensuite Bathroom', 'Sink draining properly', YES_NO),
      item('Ensuite Bathroom', 'Shower draining properly', YES_NO),
      item('Ensuite Bathroom', 'Any mold in bathroom?', YES_NO),
    );
  }

  if (room?.features?.includes('Mini Fridge')) {
    items.push(item('Appliances', 'Mini fridge working properly', YES_NO));
  }

  if (room?.features?.includes('Window AC')) {
    items.push(item('Appliances', 'AC unit working properly', YES_NO));
  }

  // Cleanliness self-assessment
  items.push(
    item('Cleanliness', 'Room is reasonably clean and tidy', YES_NO),
    item('Cleanliness', 'Trash is taken out regularly', YES_NO),
  );

  return items;
}

// ─── MOVE_IN_OUT ────────────────────────────────────────

function generateMoveInOut(property, room) {
  const items = [];

  // Room condition documentation
  items.push(
    item('Walls', 'North wall condition', CONDITION_OPTIONS),
    item('Walls', 'South wall condition', CONDITION_OPTIONS),
    item('Walls', 'East wall condition', CONDITION_OPTIONS),
    item('Walls', 'West wall condition', CONDITION_OPTIONS),
    item('Ceiling', 'Ceiling condition', CONDITION_OPTIONS),
    item('Floor', 'Floor condition', CONDITION_OPTIONS),
  );

  // Door and windows
  items.push(
    item('Door', 'Door condition', CONDITION_OPTIONS),
    item('Door', 'Door handle and lock', CONDITION_OPTIONS),
    item('Windows', 'Window glass condition', CONDITION_OPTIONS),
    item('Windows', 'Window screens', CONDITION_OPTIONS),
    item('Windows', 'Window locks functioning'),
  );

  // Closet
  items.push(
    item('Closet', 'Closet door/curtain', CONDITION_OPTIONS),
    item('Closet', 'Closet shelves/rod', CONDITION_OPTIONS),
    item('Closet', 'Closet interior', CLEAN_OPTIONS),
  );

  // Electrical
  items.push(
    item('Electrical', 'Light fixture(s) condition', CONDITION_OPTIONS),
    item('Electrical', 'All switches working'),
    item('Electrical', 'All outlets working'),
    item('Electrical', 'Smoke detector present and working'),
  );

  // Furniture inventory (dynamic)
  for (const f of room?.furniture || []) {
    items.push(item('Furniture', `${f} — present and condition`, CONDITION_OPTIONS));
  }

  // Feature-specific
  if (room?.features?.includes('Ensuite Bathroom')) {
    items.push(
      item('Ensuite Bathroom', 'Toilet condition', CONDITION_OPTIONS),
      item('Ensuite Bathroom', 'Sink condition', CONDITION_OPTIONS),
      item('Ensuite Bathroom', 'Shower/tub condition', CONDITION_OPTIONS),
      item('Ensuite Bathroom', 'Mirror condition', CONDITION_OPTIONS),
      item('Ensuite Bathroom', 'Tile/grout condition', CONDITION_OPTIONS),
      item('Ensuite Bathroom', 'Caulking condition', CONDITION_OPTIONS),
      item('Ensuite Bathroom', 'Floor condition', CONDITION_OPTIONS),
      item('Ensuite Bathroom', 'Exhaust fan working'),
      item('Ensuite Bathroom', 'Plumbing — no leaks'),
    );
  }

  if (room?.features?.includes('Mini Fridge')) {
    items.push(item('Appliances', 'Mini fridge condition', CONDITION_OPTIONS));
  }

  if (room?.features?.includes('Window AC')) {
    items.push(item('Appliances', 'Window AC condition', CONDITION_OPTIONS));
  }

  if (room?.features?.includes('In-Unit Washer/Dryer')) {
    items.push(
      item('Appliances', 'Washer condition', CONDITION_OPTIONS),
      item('Appliances', 'Dryer condition', CONDITION_OPTIONS),
    );
  }

  if (room?.features?.includes('Balcony/Patio')) {
    items.push(
      item('Balcony/Patio', 'Balcony/patio surface condition', CONDITION_OPTIONS),
      item('Balcony/Patio', 'Railing condition', CONDITION_OPTIONS),
    );
  }

  if (room?.features?.includes('Separate Entry')) {
    items.push(
      item('Entry', 'Separate entry door condition', CONDITION_OPTIONS),
      item('Entry', 'Entry lock condition', CONDITION_OPTIONS),
    );
  }

  // Overall
  items.push(
    item('Overall', 'General cleanliness', CLEAN_OPTIONS),
    item('Overall', 'Room is move-in ready', YES_NO),
  );

  return items;
}

// ─── Main generator ─────────────────────────────────────

export function generateChecklist(type, property, room) {
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
      return generateMoveInOut(property, room);
    default:
      throw new Error(`Unknown inspection type: ${type}`);
  }
}

// Types that require a room
export const ROOM_TYPES = ['ROOM_TURN', 'QUARTERLY', 'RESIDENT_SELF_CHECK', 'MOVE_IN_OUT'];
export const PROPERTY_ONLY_TYPES = ['COMMON_AREA'];
