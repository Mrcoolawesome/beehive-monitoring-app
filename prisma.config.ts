// Configuration for the Prisma CLI itself (`prisma migrate`, `prisma
// studio`, etc.) — not used by the running app. The app's own database
// connection is set up separately in lib/db.ts, since Prisma 7 requires the
// application code to supply its own driver adapter rather than reading the
// connection string from here.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Used by the CLI to connect for migrations and to spin up its
    // "shadow database" (a throwaway DB it uses to diff schema changes —
    // the beehive_app Postgres role needs CREATEDB permission for this to
    // work, see README.md).
    url: process.env["DATABASE_URL"],
  },
});
