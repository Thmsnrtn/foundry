FROM node:20-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --production=false

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ARG FOUNDRY_COMMIT=unknown
ENV FOUNDRY_COMMIT=$FOUNDRY_COMMIT
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/db/migrations ./src/db/migrations
COPY --from=builder /app/src/public ./src/public
# THE RECURSION READS THESE, AND THE IMAGE DID NOT HAVE THEM.
#
# `observeFoundryRepositoryReality` compares the live schema against the
# committed snapshot at docs/db/schema.snapshot.sql, and baseline liveness reads
# the six baseline files beside it. None of docs/ was in the runtime image, so
# in a deployed container self-observation returned
# {observed:false, reason:'snapshot_unreadable'} — honestly, but every time.
# Foundry-on-Foundry would have looked deployed and observed nothing, forever.
#
# Verified by running the check against a directory shaped like this image; the
# refusal is real, not theoretical. `a-recursion-that-shipped-without-its-eyes`
# pins the paths the checks read to what the image copies.
COPY --from=builder /app/docs/db ./docs/db
COPY package.json ./

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/internal/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
