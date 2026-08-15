// Route protection for /admin/*. Deliberately built from auth.config.ts
// (the Edge-safe subset), not lib/auth.ts - middleware runs in the Edge
// runtime by default, which can't use Prisma's `pg` driver adapter. See
// auth.config.ts's header for the full reasoning.

import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/admin/:path*"],
};
