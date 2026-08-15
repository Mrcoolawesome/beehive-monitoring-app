// The full Auth.js (next-auth v5) config - Node.js only (Server Components,
// API routes, Server Actions), never imported by middleware.ts. Credentials
// provider here does the actual password check against Prisma, which is
// exactly what auth.config.ts (the Edge-safe subset middleware uses) is
// deliberately kept free of.
//
// Credentials-only (no OAuth providers) means JWT sessions are the only
// option Auth.js actually supports here - its Credentials provider doesn't
// work with database sessions at all:
// https://authjs.dev/getting-started/authentication/credentials.
//
// That trades away "revoke a session by deleting a DB row" for "sessions
// are stateless signed tokens" - the jwt callback below claws most of that
// back by re-reading the user's current role from the database on every
// Node-context request rather than only embedding it once at sign-in, so a
// role change (or the user being deleted) takes effect promptly. Note this
// refresh only happens where this file (not auth.config.ts) runs - see
// that file's header. The type augmentation and the base `session`
// callback (copying id/role from token to session.user) live in
// auth.config.ts, not here - see that file's header for why.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { authConfig, type AppJWT } from "@/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const passwordMatches = await bcrypt.compare(
          password,
          user.hashedPassword,
        );
        if (!passwordMatches) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    // Spread first so the jwt override below wins for that one key -
    // object spread is shallow, so without this, authConfig.callbacks'
    // `authorized`/`session` would vanish entirely (this object's own
    // `callbacks` key would replace authConfig's whole callbacks object
    // instead of merging with it), breaking middleware's route protection
    // and the token->session.user copy this file's authorize() depends on.
    ...authConfig.callbacks,
    // Runs on sign-in (`user` present) and on every subsequent request
    // that reads the session (`user` absent). Re-fetching on every request
    // is what makes role changes take effect promptly despite JWT sessions
    // having no server-side revocation of their own - see file header.
    async jwt({ token, user }) {
      const t = token as AppJWT;
      if (user) {
        // Non-null: authorize() above always returns both alongside each
        // other. user.id/role are typed optional only because Auth.js's
        // base User type has to accommodate providers that don't set them.
        t.id = user.id!;
        t.role = user.role!;
        return t;
      }

      if (t.id) {
        const current = await prisma.user.findUnique({
          where: { id: t.id },
          select: { role: true },
        });
        if (!current) {
          // User no longer exists (deleted) - clearing id here makes the
          // session callback (in auth.config.ts) produce a session with no
          // usable identity, effectively signing them out on their next
          // request.
          t.id = "";
        } else {
          t.role = current.role;
        }
      }
      return t;
    },
  },
});
