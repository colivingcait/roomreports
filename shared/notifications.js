// Shared notification catalog. Both server and client import from here.
//
// - type: stable string key stored in DB
// - label: shown in settings page
// - desc: short description under the toggle
// - defaultEmail: default for new users (can't override in-app bell)
// - category: grouping on the settings page
// - roles: which roles can receive this type (hidden for others)
// - color: accent color (icon background / bell dot) for the client UI
// - icon: short emoji the bell uses when we don't have a proper icon handy

export const NOTIFICATION_TYPES = {
  // Owner / PM
  INSPECTION_SUBMITTED: {
    label: 'New inspection submitted',
    desc: 'When a cleaner or resident submits an inspection.',
    defaultEmail: true,
    category: 'Inspections',
    roles: ['OWNER', 'PM'],
    color: '#3B6D11',
    icon: '📋',
  },
  MAINTENANCE_STATUS_CHANGED: {
    label: 'Maintenance ticket status changed by handyperson',
    desc: 'When a handyperson moves a ticket to In Progress or Resolved.',
    defaultEmail: true,
    category: 'Maintenance',
    roles: ['OWNER', 'PM'],
    color: '#854F0B',
    icon: '🔧',
  },
  MAINTENANCE_RESIDENT_REPORTED: {
    label: 'New maintenance reported by resident',
    desc: 'When a resident submits a maintenance report via a public link.',
    defaultEmail: true,
    category: 'Maintenance',
    roles: ['OWNER', 'PM'],
    color: '#C4703F',
    icon: '🏠',
  },
  MAINTENANCE_OVERDUE: {
    label: 'Maintenance ticket overdue',
    desc: 'Daily summary of tickets still open after 7+ days.',
    defaultEmail: true,
    category: 'Maintenance',
    roles: ['OWNER', 'PM'],
    color: '#A02420',
    icon: '⏰',
  },
  TEAM_INVITE_ACCEPTED: {
    label: 'Team member accepted invite',
    desc: 'When someone you invited creates their account.',
    defaultEmail: true,
    category: 'Team',
    roles: ['OWNER', 'PM'],
    color: '#6B8F71',
    icon: '👋',
  },
  WEEKLY_DIGEST: {
    label: 'Weekly summary digest',
    desc: 'All activity across your properties, sent every Monday morning.',
    defaultEmail: false,
    category: 'Digest',
    roles: ['OWNER', 'PM'],
    color: '#4A4543',
    icon: '📊',
  },

  // Cleaner
  ROOM_TURN_NEEDED: {
    label: 'New room turn needed',
    desc: 'When a room needs to be turned for a new resident.',
    defaultEmail: true,
    category: 'Assignments',
    roles: ['CLEANER'],
    color: '#C4703F',
    icon: '🧹',
  },
  INSPECTION_DUE: {
    label: 'Recurring inspection due',
    desc: 'When a scheduled inspection is due on one of your properties.',
    defaultEmail: true,
    category: 'Assignments',
    roles: ['CLEANER', 'OWNER', 'PM'],
    color: '#3B6D11',
    icon: '📅',
  },
  TASK_ASSIGNED: {
    label: 'Task assigned to you',
    desc: 'When someone assigns you a task.',
    defaultEmail: true,
    category: 'Assignments',
    roles: ['CLEANER', 'HANDYPERSON'],
    color: '#2B5F8A',
    icon: '📝',
  },
  INSPECTION_APPROVED: {
    label: 'Inspection approved or reviewed by PM',
    desc: 'When your submitted inspection has been reviewed.',
    defaultEmail: true,
    category: 'Assignments',
    roles: ['CLEANER'],
    color: '#6B8F71',
    icon: '✅',
  },
  PROPERTY_ASSIGNED: {
    label: 'New property assigned to you',
    desc: 'When a manager adds you to a property.',
    defaultEmail: true,
    category: 'Assignments',
    roles: ['CLEANER', 'HANDYPERSON'],
    color: '#6B8F71',
    icon: '🏘️',
  },

  // Handyperson
  MAINTENANCE_ASSIGNED: {
    label: 'New maintenance ticket assigned to you',
    desc: 'When a ticket is routed to you for work.',
    defaultEmail: true,
    category: 'Tickets',
    roles: ['HANDYPERSON'],
    color: '#854F0B',
    icon: '🔧',
  },
  MAINTENANCE_PRIORITY_CHANGED: {
    label: 'Ticket priority changed / escalated',
    desc: 'When a PM changes the priority of a ticket assigned to you.',
    defaultEmail: true,
    category: 'Tickets',
    roles: ['HANDYPERSON'],
    color: '#A02420',
    icon: '⚡',
  },
  MAINTENANCE_PM_UPDATE: {
    label: 'New note or photo added to your ticket by PM',
    desc: 'When a PM attaches notes / photos to your ticket.',
    defaultEmail: true,
    category: 'Tickets',
    roles: ['HANDYPERSON'],
    color: '#2B5F8A',
    icon: '📎',
  },
  MAINTENANCE_DEADLINE: {
    label: 'Ticket deadline approaching',
    desc: 'When a ticket you own is about to hit its deadline.',
    defaultEmail: true,
    category: 'Tickets',
    roles: ['HANDYPERSON'],
    color: '#A02420',
    icon: '⏰',
  },
};

export const NOTIFICATION_CATEGORY_ORDER = [
  'Inspections',
  'Maintenance',
  'Tickets',
  'Assignments',
  'Team',
  'Digest',
];

export function notificationMeta(type) {
  return NOTIFICATION_TYPES[type] || {
    label: type,
    desc: '',
    defaultEmail: true,
    category: 'Other',
    roles: ['OWNER', 'PM', 'CLEANER', 'HANDYPERSON'],
    color: '#4A4543',
    icon: '🔔',
  };
}

export function typesForRole(role) {
  return Object.entries(NOTIFICATION_TYPES)
    .filter(([, meta]) => meta.roles.includes(role))
    .map(([type]) => type);
}

// Email default for a type when the user hasn't set a preference.
export function defaultEmailFor(type) {
  return notificationMeta(type).defaultEmail;
}
