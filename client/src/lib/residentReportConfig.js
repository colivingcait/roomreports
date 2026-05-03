// ─── Resident maintenance wizard configuration ───────────
//
// Single source of truth for the resident-facing categories,
// subcategories, and emergency / advisory popups. The wizard maps the
// resident-friendly category to an internal flagCategory so the
// existing PM kanban + priority rules continue to work.

export const DEFAULT_COMMON_AREAS = [
  'Kitchen',
  'Bathroom (shared)',
  'Living room',
  'Laundry',
  'Exterior / yard',
  'Garage / parking',
  'Other common area',
];

const PM_PHONE_PLACEHOLDER = '__PM_PHONE__';
export const PM_PHONE_TOKEN = PM_PHONE_PLACEHOLDER;
function pmCall() {
  return `<p style="margin:8px 0 0;">${PM_PHONE_PLACEHOLDER}</p>`;
}

// ─── Popups ───────────────────────────────────────────────

const POPUP_WATER_SHUTOFF = {
  tone: 'emergency',
  title: 'Stop the water first',
  html: `
    <p style="margin:0 0 10px;">Before submitting this report, try to stop or slow the leak:</p>
    <p style="margin:0 0 6px;"><strong>Toilet:</strong> Look behind the toilet near the floor. Turn the oval valve clockwise (righty-tighty) until it stops.</p>
    <p style="margin:0 0 6px;"><strong>Sink:</strong> Open the cabinet below the sink. Turn the valve(s) on the supply lines clockwise until closed.</p>
    <p style="margin:0 0 6px;"><strong>If you can't find a shutoff valve, or water is coming from the ceiling or walls:</strong> Turn off the main water supply. This is usually a large valve near the water heater or where the main water line enters the house.</p>
    <p style="margin:0;">Place towels or buckets to catch water and move electronics and valuables away from the water.</p>
    ${pmCall()}
  `,
};

const POPUP_ELECTRICAL = {
  tone: 'emergency',
  title: 'Electrical emergency — act now',
  html: `
    <p style="margin:0 0 8px;font-weight:600;">If there are active flames:</p>
    <ol style="margin:0 0 10px;padding-left:18px;">
      <li>If the fire is <strong>SMALL</strong> (smaller than a trash can) and contained to one spot, use the fire extinguisher in your room or kitchen. Remember <strong>PASS</strong>: Pull the pin, Aim at the base, Squeeze the handle, Sweep side to side.</li>
      <li>If the fire is spreading, producing heavy smoke, or you feel unsafe — <strong>LEAVE IMMEDIATELY</strong>. Close the door behind you, alert other residents, and call 911 from outside.</li>
      <li>Do <strong>NOT</strong> use water on an electrical fire.</li>
    </ol>
    <p style="margin:0 0 8px;font-weight:600;">If there is sparking or burning smell but no flames:</p>
    <ol style="margin:0;padding-left:18px;">
      <li>Do <strong>NOT</strong> touch the outlet, switch, or fixture.</li>
      <li>Locate the electrical panel (usually in a closet, garage, basement, or laundry area — look for a gray metal box).</li>
      <li>If there is a main breaker (the large switch at the top), flip it to OFF.</li>
      <li>If there is no main breaker, flip ALL individual breakers to OFF.</li>
      <li>Do not turn the power back on until the issue has been inspected.</li>
    </ol>
    ${pmCall()}
  `,
};

const POPUP_GAS = {
  tone: 'emergency',
  title: 'Do you smell gas?',
  html: `
    <p style="margin:0 0 8px;"><strong>If you smell gas:</strong> Do NOT turn on any lights, light matches, or use electronics near the stove. Open windows, leave the unit, and call 911 or your gas company's emergency line from outside.</p>
    <p style="margin:0;">If you do NOT smell gas, continue with your report.</p>
    ${pmCall()}
  `,
};

const POPUP_CO = {
  tone: 'emergency',
  title: 'Carbon monoxide detected — leave now',
  html: `
    <p style="margin:0 0 8px;">If your carbon monoxide detector is beeping continuously, leave the house immediately and call 911 from outside. Do not re-enter until emergency services say it's safe.</p>
    <p style="margin:0;">A single beep every 30–60 seconds usually means low battery — but continuous beeping or 4 short beeps means CO is detected. When in doubt, leave and call 911.</p>
    ${pmCall()}
  `,
};

const POPUP_BED_BUGS = {
  tone: 'advisory',
  title: 'Bed bug protocol',
  html: `
    <ul style="margin:0;padding-left:18px;">
      <li>Do NOT move your mattress, bedding, or furniture to another room — this spreads them to other areas.</li>
      <li>Do NOT throw out your mattress or furniture without talking to your property manager first.</li>
      <li>Bag and seal your bedding in plastic bags.</li>
      <li>Your property manager will schedule a professional treatment.</li>
    </ul>
    ${pmCall()}
  `,
};

const POPUP_WASPS = {
  tone: 'advisory',
  title: 'Wasps or bees',
  html: `<p style="margin:0;">Do not attempt to remove a nest yourself. Stay away from the area and report the location below.</p>`,
};

const POPUP_RODENTS = {
  tone: 'advisory',
  title: 'Mice or rats',
  html: `<p style="margin:0;">Check for gaps around pipes under sinks and near baseboards. Store food in sealed containers.</p>`,
};

const POPUP_MOLD = {
  tone: 'advisory',
  title: 'Visible mold',
  html: `<p style="margin:0;">Do not try to clean mold yourself — especially if the area is larger than a few square feet. Keep the area ventilated (open a window if possible) and avoid sleeping in the room if the mold is extensive. Your property manager will arrange professional remediation.</p>`,
};

const POPUP_LOCKED_OUT = {
  tone: 'advisory',
  title: "Locked out? Here's what to do",
  html: `
    <ul style="margin:0;padding-left:18px;">
      <li>Call your property manager for help.</li>
      <li>If it's late at night or you can't reach your PM, check if any housemates can let you in.</li>
      <li>Do NOT try to force the door or window open.</li>
    </ul>
    ${pmCall()}
  `,
};

const POPUP_LOCK_BATTERY = {
  tone: 'advisory',
  title: 'Lock battery tip',
  html: `<p style="margin:0;">This usually means the batteries need replacing. If you have 4 AA batteries, you can try replacing them yourself — the battery compartment is usually on the inside of the lock. Otherwise, submit this report and we'll take care of it.</p>`,
};

const POPUP_FRIDGE = {
  tone: 'advisory',
  title: 'Fridge tips while we work on this',
  html: `<p style="margin:0;">If your fridge has stopped cooling: avoid opening the door to keep food cold longer. Check if the outlet has power by plugging in something else. If the fridge is leaking, place towels around the base.</p>`,
};

const POPUP_BROKEN_GLASS = {
  tone: 'advisory',
  title: 'Be careful around broken glass',
  html: `<p style="margin:0;">If the window is shattered, cover the opening with cardboard or plastic and tape to keep weather and pests out until it's repaired.</p>`,
};

const POPUP_ROUTER_TIP = {
  tone: 'advisory',
  title: 'Try restarting the router',
  html: `<p style="margin:0;">Unplug it, wait 30 seconds, plug it back in. The router is usually in a common area — check the living room, hallway closet, or laundry area for a small box with blinking lights.</p>`,
};

const POPUP_SMOKE_LOW_BATT = {
  tone: 'advisory',
  title: 'Smoke detector beeping',
  html: `<p style="margin:0;">A chirp every 30–60 seconds usually means the battery needs replacing. If the alarm is continuous, leave the building and call 911.</p>`,
};

function popupHeatSummer() {
  return {
    tone: 'advisory',
    title: 'Stay cool while we work on this',
    html: `
      <p style="margin:0 0 8px;">While waiting for a repair: close blinds and curtains, use fans if available, stay hydrated, and spend time in common areas if they have working AC.</p>
      <p style="margin:0;">If you feel dizzy, nauseous, or overheated, call 911 — heat exhaustion is serious.</p>
      ${pmCall()}
    `,
  };
}
function popupHeatWinter() {
  return {
    tone: 'advisory',
    title: 'Stay warm while we work on this',
    html: `
      <p style="margin:0 0 8px;">While waiting for a repair: use extra blankets, wear layers, and keep doors closed to retain heat.</p>
      <p style="margin:0 0 8px;">If you have a space heater, keep it away from furniture and curtains and never leave it unattended. Do <strong>NOT</strong> use your oven or stove for heat.</p>
      <p style="margin:0;">If indoor temperature drops below 50°F and you feel unsafe, call your property manager immediately.</p>
      ${pmCall()}
    `,
  };
}

// ─── Categories ───────────────────────────────────────────
//
// `flagCategory` maps to one of FLAG_CATEGORIES in shared/index.js so
// the PM kanban + priority rules continue to work without changes.
// `photos`: 'required' | 'encouraged' | 'optional'
// `subcategories`: array of strings
// `popupsBySub`: { subLabel: popup }
// `requirePhotosForSub`: optional Set; only those subs trigger required-photos
// `inlineFollowUp`: { sub: { question, options, popupsByOption } }

export const CATEGORIES = [
  {
    value: 'plumbing',
    label: 'Water & Plumbing',
    flagCategory: 'Plumbing',
    photos: 'required',
    subcategories: ['Sink issue', 'Toilet issue', 'Shower/tub issue', 'Active leak', 'Water damage/stain', 'Mold', 'Other'],
    popupsBySub: {
      'Active leak': POPUP_WATER_SHUTOFF,
      'Mold': POPUP_MOLD,
    },
  },
  {
    value: 'electrical',
    label: 'Electrical & Power',
    flagCategory: 'Electrical',
    photos: 'encouraged',
    subcategories: ['Outlet not working', 'Lights not working', 'Breaker tripping', 'Sparking/burning smell', 'Other'],
    popupsBySub: {
      'Sparking/burning smell': POPUP_ELECTRICAL,
    },
  },
  {
    value: 'hvac',
    label: 'Heating & Cooling',
    flagCategory: 'HVAC',
    photos: 'encouraged',
    subcategories: ['AC not working', 'Heat not working', 'Thermostat issue', 'Unusual noises', 'Other'],
    // Seasonal popups resolved at render time.
    seasonalPopups: {
      'AC not working': { months: [5, 6, 7, 8], popup: popupHeatSummer },   // Jun-Sep
      'Heat not working': { months: [10, 11, 0, 1], popup: popupHeatWinter }, // Nov-Feb
    },
  },
  {
    value: 'doors',
    label: 'Doors, Locks & Windows',
    flagCategory: 'Locks & Security',
    photos: 'optional', // overridden per-sub below
    subcategories: [
      'Electronic lock beeping/low battery',
      'Lock not opening',
      'Key not working',
      'Keypad not responding',
      'Locked out',
      "Door won't close/latch",
      "Window won't open/close",
      'Broken glass',
      'Screen damage',
      'Draft/air leak',
      'Other',
    ],
    popupsBySub: {
      'Electronic lock beeping/low battery': POPUP_LOCK_BATTERY,
      'Locked out': POPUP_LOCKED_OUT,
      'Broken glass': POPUP_BROKEN_GLASS,
    },
    requirePhotosForSub: new Set(['Broken glass', 'Screen damage']),
  },
  {
    value: 'appliances',
    label: 'Appliances',
    flagCategory: 'Appliances',
    photos: 'required',
    subcategories: ['Refrigerator', 'Stove/oven', 'Dishwasher', 'Washer', 'Dryer', 'Garbage disposal', 'Microwave', 'Other'],
    popupsBySub: {
      Refrigerator: POPUP_FRIDGE,
    },
    inlineFollowUp: {
      'Stove/oven': {
        id: 'stoveType',
        question: 'Is this a gas or electric stove?',
        options: ['Gas', 'Electric', 'Not sure'],
        popupsByOption: { Gas: POPUP_GAS, 'Not sure': POPUP_GAS },
      },
    },
  },
  {
    value: 'pests',
    label: 'Pests',
    flagCategory: 'Pest Control',
    photos: 'required',
    subcategories: ['Ants', 'Roaches', 'Mice/rats', 'Bed bugs', 'Spiders', 'Flies/gnats', 'Wasps/bees', 'Other'],
    popupsBySub: {
      'Bed bugs': POPUP_BED_BUGS,
      'Wasps/bees': POPUP_WASPS,
      'Mice/rats': POPUP_RODENTS,
    },
  },
  {
    value: 'damage',
    label: 'Damage & Surfaces',
    flagCategory: 'Surfaces',
    photos: 'required',
    subcategories: ['Hole in wall', 'Peeling paint', 'Ceiling damage', 'Floor damage', 'Furniture broken/damaged', 'Blinds broken', 'Other'],
  },
  {
    value: 'cleaning',
    label: 'Cleaning & Trash',
    flagCategory: 'Cleaning',
    photos: 'encouraged',
    subcategories: ['Common area dirty', 'Trash not taken out', 'Trash bins full', 'Bathroom needs cleaning', 'Other'],
  },
  {
    value: 'internet',
    label: 'Internet & Cable',
    flagCategory: 'Internet & Tech',
    photos: 'optional',
    subcategories: ['No internet', 'Slow internet', 'Router issue', 'Cable not working', 'Other'],
    popupsBySub: {
      'No internet': POPUP_ROUTER_TIP,
      'Router issue': POPUP_ROUTER_TIP,
    },
  },
  {
    value: 'safety',
    label: 'Safety',
    flagCategory: 'Safety',
    photos: 'required',
    subcategories: ['Smoke detector beeping', 'Smoke detector missing', 'CO detector beeping', 'Fire extinguisher missing', 'Egress blocked', 'Other'],
    popupsBySub: {
      'CO detector beeping': POPUP_CO,
      'Smoke detector beeping': POPUP_SMOKE_LOW_BATT,
    },
  },
  {
    value: 'parking',
    label: 'Parking',
    flagCategory: 'General',
    photos: 'optional',
    subcategories: ['Someone in my spot', 'Blocked in', 'Parking lot issue', 'Other'],
  },
  {
    value: 'other',
    label: 'Something else',
    flagCategory: 'General',
    photos: 'optional',
    subcategories: [],
  },
];

// Helpers -------------------------------------------------

export function getCategory(value) {
  return CATEGORIES.find((c) => c.value === value);
}

// Returns a popup for the given subcategory pick, considering seasonal
// rules. Used when the resident taps a chip.
export function popupForSub(category, sub, now = new Date()) {
  if (!category) return null;
  const direct = category.popupsBySub?.[sub];
  if (direct) return direct;
  const seasonal = category.seasonalPopups?.[sub];
  if (seasonal && seasonal.months.includes(now.getMonth())) {
    return seasonal.popup();
  }
  return null;
}

// Whether photos are required given the category + selected subs.
export function photoPolicyFor(category, subs = []) {
  if (!category) return 'optional';
  if (category.requirePhotosForSub) {
    if (subs.some((s) => category.requirePhotosForSub.has(s))) return 'required';
  }
  return category.photos || 'optional';
}

// Truncate a description to a tidy ticket title (~60 chars). Cuts on
// the previous word boundary when possible so we don't slice mid-word.
export function makeTicketTitle(description, max = 60) {
  const s = String(description || '').trim().replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trim() + '…';
}
