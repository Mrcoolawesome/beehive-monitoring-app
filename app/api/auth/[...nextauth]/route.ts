// Auth.js's catch-all route - handles /api/auth/signin, /callback,
// /session, /csrf, etc. The actual provider/callback config lives in
// lib/auth.ts; this file just wires that config into the App Router.

import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
