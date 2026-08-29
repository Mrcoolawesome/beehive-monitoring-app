// Server Actions live at the same URL as the page whose <form> calls them,
// which middleware.ts's /admin/:path* matcher does cover - but relying on
// that alone would make an admin action's real authorization boundary
// "whatever route Next.js happens to associate this POST with," which is
// exactly the kind of implicit coupling that quietly stops protecting
// anything if a page ever moves. Call this at the top of every admin
// Server Action instead, so authorization travels with the action itself.

import { auth } from "@/lib/auth";

export async function requireAdmin() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    throw new Error("Forbidden: admin access required");
  }
  return session.user;
}
