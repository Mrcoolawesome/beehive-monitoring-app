// One-off CLI to create (or promote) an admin account. Signup always
// creates a VIEWER (see app/signup/actions.ts) - there's no self-serve path
// to ADMIN, on purpose, so the very first admin has to be created this way.
// Once that account exists, it can promote others through the admin panel
// (Phase 3) instead of needing this script again.
//
// Usage: pnpm tsx scripts/create-admin.ts <email> <password> [name]

import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db";

async function main() {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password) {
    console.error(
      "Usage: pnpm tsx scripts/create-admin.ts <email> <password> [name]",
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  // upsert rather than create: also useful for resetting an existing
  // account's password (e.g. forgot it - there's no reset-email flow yet)
  // or promoting an existing VIEWER to ADMIN by re-running this against
  // their email.
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, hashedPassword, name: name ?? null, role: "ADMIN" },
    update: { hashedPassword, role: "ADMIN" },
  });

  console.log(`${user.email} is now an ADMIN (id: ${user.id}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
