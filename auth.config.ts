// The Edge-safe subset of the Auth.js config - used by middleware.ts, which
// runs in the Edge runtime by default and can't use Prisma's `pg` driver
// adapter (needs Node.js APIs the Edge runtime doesn't have). This file
// must never import lib/db.ts or anything that touches the database.
//
// The `session` callback below (copying id/role from the token onto
// session.user) has to live here, in the config middleware actually uses,
// not only in lib/auth.ts - middleware instantiates its own separate
// NextAuth(authConfig), so a callback only added in lib/auth.ts's instance
// never runs for it. Without this, middleware's authorized() callback saw
// auth.user with no id/role at all (Auth.js's default session shape,
// name/email/image only) and rejected every ADMIN correctly signed in,
// which is exactly what happened before this callback was moved here.
//
// `authorized()` and this `session` callback only read claims already
// embedded in the JWT (decoding/verifying a signed token, and copying its
// fields onto an object, are both Edge-safe - no DB needed). Re-fetching
// the user's current role from the database only happens in lib/auth.ts's
// jwt callback, which runs in Node.js contexts (Server Components, API
// routes) - see that file's header for why that's still "fresh enough" in
// practice despite this split.

import type { NextAuthConfig, DefaultSession } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { UserRole } from "@/app/generated/prisma/enums";

declare module "next-auth" {
  interface User {
    role?: UserRole;
  }
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
  }
}

// Not augmented via `declare module "next-auth/jwt"` - that ambient
// augmentation doesn't resolve under this project's pnpm layout (the `JWT`
// type actually lives in @auth/core, which pnpm doesn't hoist to somewhere
// TS's module augmentation can see). AppJWT + casting to it wherever a
// token's custom fields are read/written is a workaround with the same
// effect, just via an explicit cast instead of interface merging.
export type AppJWT = JWT & { id: string; role: UserRole };

export const authConfig = {
  // Explicit rather than relying on next-auth's "reads AUTH_SECRET from
  // env automatically" convention: this config gets instantiated
  // separately in middleware.ts (Edge runtime) and lib/auth.ts (Node), and
  // the two disagreeing on the secret is exactly the kind of thing that
  // silently breaks session decoding in one context while it keeps working
  // in the other - being explicit here makes sure both actually share one.
  secret: process.env.AUTH_SECRET,
  // Auth.js auto-trusts the request host in development, but that
  // detection didn't reliably apply inside Edge middleware specifically
  // (NODE_ENV isn't necessarily visible there the same way it is in the
  // Node runtime) - explicit here removes the ambiguity for both
  // instances rather than relying on an environment-dependent default.
  trustHost: true,
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [], // real providers (Credentials) are added in lib/auth.ts
  callbacks: {
    authorized({ auth, request }) {
      const isAdminRoute = request.nextUrl.pathname.startsWith("/admin");
      if (!isAdminRoute) return true;
      return auth?.user?.role === "ADMIN";
    },
    session({ session, token }) {
      const t = token as AppJWT;
      if (t.id) {
        session.user.id = t.id;
        session.user.role = t.role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
