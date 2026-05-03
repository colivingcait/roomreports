// ─── Resident maintenance wizard configuration ───────────
//
// Single source of truth for the resident-facing categories, triage
// questions, and popup copy. The PM-side `flagCategory` is mapped from
// the resident category so the existing maintenance kanban / priority
// rules continue to work.

export const COMMON_AREAS = [
  { id: 'kitchen',   label: 'Kitchen' },
  { id: 'bath',      label: 'Bathroom (shared)' },
  { id: 'living',    label: 'Living room' },
  { id: 'laundry',   label: 'Laundry' },
  { id: 'exterior',  label: 'Exterior / yard' },
  { id: 'garage',    label: 'Garage / parking' },
  { id: 'common',    label: 'Other common area' },
];

// Each entry maps to the existing FLAG_CATEGORIES set in shared/index.js.
// The label and emoji are resident-facing.
export const CATEGORIES = [
  { value: 'plumbing',   label: 'Plumbing (sink, toilet, shower)',                emoji: '💧', flagCategory: 'Plumbing',     photos: 'required'  },
  { value: 'electrical', label: 'Electrical (outlets, lights, switches)',         emoji: '⚡', flagCategory: 'Electrical',   photos: 'encouraged'},
  { value: 'hvac',       label: 'Heating & cooling (AC, heat, thermostat)',       emoji: '🌡️', flagCategory: 'HVAC',         photos: 'encouraged'},
  { value: 'lock',       label: 'Lock or key issue',                              emoji: '🔑', flagCategory: 'General',      photos: 'encouraged'},
  { value: 'appliance',  label: 'Appliance not working (fridge, stove, washer)',  emoji: '🔌', flagCategory: 'Appliance',    photos: 'required'  },
  { value: 'pests',      label: 'Pests or bugs',                                  emoji: '🐛', flagCategory: 'Pest Control', photos: 'required'  },
  { value: 'leak',       label: 'Leak or water damage',                           emoji: '💦', flagCategory: 'Plumbing',     photos: 'required'  },
  { value: 'door',       label: 'Door or window problem',                         emoji: '🚪', flagCategory: 'General',      photos: 'required'  },
  { value: 'internet',   label: 'Internet or cable',                              emoji: '📶', flagCategory: 'General',      photos: 'optional'  },
  { value: 'cleaning',   label: 'Cleaning issue',                                 emoji: '🧹', flagCategory: 'General',      photos: 'encouraged'},
  { value: 'safety',     label: 'Safety concern (smoke detector, CO detector)',   emoji: '🚨', flagCategory: 'Safety',       photos: 'required'  },
  { value: 'other',      label: 'Something else',                                 emoji: '❓', flagCategory: 'General',      photos: 'optional'  },
];

// ─── Triage configuration ─────────────────────────────────
//
// Each triage step is one of:
//   - { id, kind: 'yesno',    question, onYes?: <popup>, onNo?: <popup> }
//   - { id, kind: 'choice',   question, options: [string, ...], popupsByOption?: { option: <popup> } }
//   - { id, kind: 'multi',    question, options: [string, ...], popupsByOption?: { option: <popup> } }
//
// A popup is { tone: 'emergency' | 'advisory', title, html, dismissLabel? }.
// Popups DO NOT block submission — the resident dismisses them and
// continues. Their primary job is harm-reduction guidance.

const PM_PHONE_PLACEHOLDER = '__PM_PHONE__';
function pmCall() {
  // Placeholder replaced at render time with a tappable tel: link or
  // muted "Contact your property manager" text when no phone is set.
  return `<p style="margin:8px 0 0;">${PM_PHONE_PLACEHOLDER}</p>`;
}

export const PM_PHONE_TOKEN = PM_PHONE_PLACEHOLDER;

const POPUP_WATER_SHUTOFF = {
  tone: 'emergency',
  title: 'Stop the water first',
  html: `
    <p style="margin:0 0 10px;">Before submitting this report, try to stop or slow the leak:</p>
    <p style="margin:0 0 6px;"><strong>Toilet:</strong> Look behind the toilet near the floor. Turn the oval valve clockwise (righty-tighty) until it stops.</p>
    <p style="margin:0 0 6px;"><strong>Sink:</strong> Open the cabinet below the sink. Turn the valve(s) on the supply lines clockwise until closed.</p>
    <p style="margin:0 0 6px;"><strong>If you can't find a shutoff valve, or water is coming from the ceiling or walls:</strong> Turn off the main water supply. This is usually a large valve near the water heater or where the main water line enters the house.</p>
    <p style="margin:0 0 0;">Place towels or buckets to catch water and move electronics and valuables away from the water.</p>
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
    <ol style="margin:0 0 0;padding-left:18px;">
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
    <p style="margin:0 0 0;">If you do NOT smell gas, continue with your report.</p>
    ${pmCall()}
  `,
};

const POPUP_CO = {
  tone: 'emergency',
  title: 'Carbon monoxide detected — leave now',
  html: `
    <p style="margin:0 0 8px;">If your carbon monoxide detector is beeping continuously, leave the house immediately and call 911 from outside. Do not re-enter until emergency services say it's safe.</p>
    <p style="margin:0 0 0;">A single beep every 30–60 seconds usually means low battery — but continuous beeping or 4 short beeps means CO is detected. When in doubt, leave and call 911.</p>
    ${pmCall()}
  `,
};

const POPUP_BED_BUGS = {
  tone: 'advisory',
  title: 'Bed bug protocol',
  html: `
    <ul style="margin:0 0 0;padding-left:18px;">
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
    <ul style="margin:0 0 0;padding-left:18px;">
      <li>Call your property manager for help.</li>
      <li>If it's late at night or you can't reach your PM, check if any housemates can let you in.</li>
      <li>Do NOT try to force the door or window open.</li>
    </ul>
    ${pmCall()}
  `,
};

const POPUP_FRIDGE = {
  tone: 'advisory',
  title: 'Fridge tips while we work on this',
  html: `<p style="margin:0;">If your fridge has stopped cooling: avoid opening the door to keep food cold longer. Check if the outlet has power by plugging in something else. If the fridge is leaking, place towels around the base.</p>`,
};

const POPUP_BROKEN_GLASS = {
  tone: 'advisory',
  title: 'Be careful around broken glass',
  html: `<p style="margin:0;">Be careful around broken glass. If the window is shattered, cover the opening with cardboard or plastic and tape to keep weather and pests out until it's repaired.</p>`,
};

const POPUP_ROUTER_TIP = {
  tone: 'advisory',
  title: 'Where is the router?',
  html: `<p style="margin:0;">The router is usually in a common area — check the living room, hallway closet, or laundry area for a small box with blinking lights. Unplug it, wait 30 seconds, then plug it back in.</p>`,
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

// ─── Per-category triage ──────────────────────────────────

export function triageStepsFor(categoryValue) {
  switch (categoryValue) {
    case 'plumbing':
      return [
        {
          id: 'activeWater', kind: 'yesno',
          question: 'Is there active water leaking right now?',
          onYes: POPUP_WATER_SHUTOFF,
        },
        {
          id: 'leakSource', kind: 'choice',
          question: 'Is the leak coming from a pipe, fixture, or appliance?',
          options: ['Pipe', 'Fixture', 'Appliance', 'Not sure'],
        },
      ];

    case 'electrical':
      return [
        {
          id: 'sparking', kind: 'yesno',
          question: 'Are any outlets, switches, or lights sparking, smoking, or producing a burning smell?',
          onYes: POPUP_ELECTRICAL,
        },
        {
          id: 'electricalIssue', kind: 'choice',
          question: "What's happening?",
          options: [
            'Sparking outlet',
            'Burning smell',
            'Flickering lights',
            'Breaker keeps tripping',
            'Outlet not working',
            'Multiple outlets not working',
          ],
        },
      ];

    case 'hvac': {
      const month = new Date().getMonth(); // 0-11
      const summer = month >= 5 && month <= 8;   // Jun–Sep
      const winter = month >= 10 || month <= 1;  // Nov–Feb
      const popupsByOption = {};
      if (summer) popupsByOption['Completely off'] = popupHeatSummer();
      else if (winter) popupsByOption['Completely off'] = popupHeatWinter();
      return [
        {
          id: 'hvacState', kind: 'choice',
          question: 'Is the unit completely not working, or partially working?',
          options: [
            'Completely off',
            'Running but not heating/cooling properly',
            'Making unusual noises',
            'Thermostat issue',
          ],
          popupsByOption,
        },
      ];
    }

    case 'lock':
      return [
        {
          id: 'lockedOut', kind: 'yesno',
          question: 'Are you locked out right now?',
          onYes: POPUP_LOCKED_OUT,
        },
        {
          id: 'lockIssue', kind: 'choice',
          question: "What's the issue?",
          options: [
            "Can't lock my door",
            "Key doesn't work",
            'Lock is jammed',
            'Keypad not responding',
            'Other',
          ],
        },
      ];

    case 'pests':
      return [
        {
          id: 'pestTypes', kind: 'multi',
          question: 'What type of pests are you seeing?',
          options: [
            'Ants',
            'Roaches',
            'Mice or rats',
            'Bed bugs',
            'Spiders',
            'Flies or gnats',
            'Wasps or bees',
            'Other',
          ],
          popupsByOption: {
            'Bed bugs': POPUP_BED_BUGS,
            'Wasps or bees': POPUP_WASPS,
            'Mice or rats': POPUP_RODENTS,
          },
        },
      ];

    case 'leak':
      return [
        {
          id: 'activeWater', kind: 'yesno',
          question: 'Is there active water leaking right now?',
          onYes: POPUP_WATER_SHUTOFF,
        },
        {
          id: 'leakLocation', kind: 'choice',
          question: 'Where is the water coming from?',
          options: ['Ceiling', 'Wall', 'Floor / baseboard', 'Around a window', 'Not sure'],
        },
        {
          id: 'mold', kind: 'yesno',
          question: 'Is there visible mold?',
          onYes: POPUP_MOLD,
        },
      ];

    case 'appliance':
      return [
        {
          id: 'appliance', kind: 'choice',
          question: 'Which appliance?',
          options: [
            'Refrigerator',
            'Stove / oven',
            'Dishwasher',
            'Washer',
            'Dryer',
            'Garbage disposal',
            'Microwave',
            'Other',
          ],
          popupsByOption: { Refrigerator: POPUP_FRIDGE },
        },
        {
          id: 'stoveType', kind: 'choice',
          question: 'Is this a gas or electric stove?',
          options: ['Gas', 'Electric', 'Not sure'],
          dependsOn: { id: 'appliance', value: 'Stove / oven' },
          popupsByOption: { Gas: POPUP_GAS, 'Not sure': POPUP_GAS },
        },
      ];

    case 'door':
      return [
        {
          id: 'doorIssue', kind: 'choice',
          question: "What's the issue?",
          options: [
            "Won't close or lock properly",
            'Cracked or broken glass',
            'Screen damage',
            "Won't open",
            'Draft or air leak',
          ],
          popupsByOption: { 'Cracked or broken glass': POPUP_BROKEN_GLASS },
        },
      ];

    case 'internet':
      return [
        {
          id: 'restartedRouter', kind: 'choice',
          question: 'Have you tried restarting the router?',
          options: ['Yes', 'No', 'Where is it?'],
          popupsByOption: { 'Where is it?': POPUP_ROUTER_TIP },
        },
      ];

    case 'safety':
      return [
        {
          id: 'safetyType', kind: 'choice',
          question: 'What type of safety issue?',
          options: [
            'Smoke detector beeping',
            'CO detector beeping',
            'Smoke detector missing',
            'Fire extinguisher missing',
            'Egress blocked',
            'Other',
          ],
          popupsByOption: {
            'CO detector beeping': POPUP_CO,
            'Smoke detector beeping': POPUP_SMOKE_LOW_BATT,
          },
        },
      ];

    case 'cleaning':
    case 'other':
    default:
      return [];
  }
}
