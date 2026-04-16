import { Lucia } from 'lucia';
import { PrismaAdapter } from '@lucia-auth/adapter-prisma';
import prisma from './prisma.js';

const adapter = new PrismaAdapter(prisma.session, prisma.user);

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      secure: process.env.USE_SECURE_COOKIES === 'true',
      sameSite: 'lax',
    },
  },
  getUserAttributes: (attributes) => ({
    email: attributes.email,
    name: attributes.name,
    role: attributes.role,
    organizationId: attributes.organizationId,
    googleId: attributes.googleId,
  }),
});
