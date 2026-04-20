import prisma from './prisma.js';

// Roles that see every property in the org. Everyone else is scoped to
// the properties they have a PropertyAssignment for.
const UNRESTRICTED_ROLES = new Set(['OWNER', 'PM']);

export async function assignedPropertyIds(userId) {
  const rows = await prisma.propertyAssignment.findMany({
    where: { userId },
    select: { propertyId: true },
  });
  return rows.map((r) => r.propertyId);
}

// Returns a Prisma `where` fragment that scopes to the user's properties.
// Use by spreading: { ...await propertyScope(req.user) }.
// The fragment targets an `id` field (for property queries); for queries
// that reference properties via `propertyId`, use `propertyIdScope` instead.
export async function propertyScope(user) {
  if (UNRESTRICTED_ROLES.has(user.role)) return {};
  const ids = await assignedPropertyIds(user.id);
  return { id: { in: ids } };
}

export async function propertyIdScope(user) {
  if (UNRESTRICTED_ROLES.has(user.role)) return {};
  const ids = await assignedPropertyIds(user.id);
  return { propertyId: { in: ids } };
}
