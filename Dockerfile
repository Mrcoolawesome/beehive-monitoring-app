# One image, three jobs. docker-compose.yml runs this same image three
# different ways: `next start` for the web dashboard, `prisma migrate
# deploy` as a one-shot job that applies pending migrations before anything
# else starts, and `tsx scripts/watcher.ts` for the ingestion watcher. They
# share an image (rather than three separate Dockerfiles) because they're
# really the same app wearing different hats, and keeping one build means
# there's only one place dependency/version drift could happen.
#
# The watcher runs `scripts/watcher.ts` as TypeScript, live, via tsx rather
# than a compiled JS bundle — same as it does outside Docker (`pnpm watch`)
# — so this image intentionally keeps its full node_modules (including dev
# dependencies like tsx) and raw source rather than trying to build a
# stripped-down "standalone" runtime image. That trades a larger image for
# not having to fight Next.js's build-output tracing, which only follows
# imports reachable from Next's own pages/routes and has no idea
# scripts/watcher.ts exists.

FROM node:22-alpine AS base
# Alpine's minimal base is missing OpenSSL and glibc compatibility shims
# that Prisma's query engine binary needs to run — without these, Prisma
# fails at runtime with an obscure "cannot find libssl" error rather than
# something obviously actionable.
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable
WORKDIR /app

# Installing dependencies in their own stage, before copying the rest of the
# source, means Docker's layer cache can skip the (slow) `pnpm install` step
# on rebuilds where only application code changed, not package.json.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generates app/generated/prisma (the typed database client) from
# prisma/schema.prisma — needed before `next build`, since the app imports
# from it.
RUN pnpm exec prisma generate
RUN pnpm run build

FROM base AS runner
ENV NODE_ENV=production

# Run as an unprivileged user by default — standard container hardening,
# and this image never needs root to serve the web app or run migrations.
# The watcher service overrides this at the compose level (see
# docker-compose.yml's WATCH_UID/WATCH_GID) to instead match whatever host
# user owns the bind-mounted WATCH_DIR, since it needs to write there.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

COPY --chown=nextjs:nodejs --from=builder /app ./

USER nextjs
EXPOSE 3000

# The web dashboard is the default; docker-compose.yml overrides `command:`
# for the migrate and watcher services to reuse this same image differently.
CMD ["node_modules/.bin/next", "start"]
