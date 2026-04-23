##########################################################################
# Stage 1: deps — install all (including dev) to build
##########################################################################
FROM node:22-alpine AS deps
WORKDIR /app

RUN npm install -g pnpm@9

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

##########################################################################
# Stage 2: builder — compile TypeScript, run prisma generate
##########################################################################
FROM node:22-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@9

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .

RUN pnpm --filter @asistencia/shared run build
RUN pnpm --filter @asistencia/api run prisma:generate
RUN pnpm --filter @asistencia/api run build

##########################################################################
# Stage 3: runner — minimal production image
##########################################################################
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 appuser

RUN npm install -g pnpm@9

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma ./apps/api/prisma

RUN pnpm install --prod --frozen-lockfile --ignore-scripts

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
# Copy the generated Prisma client from pnpm virtual store in builder
COPY --from=builder /app/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma \
     ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma
# Replace OpenSSL 1.1 binary with OpenSSL 3 binary (Alpine 3.17+ ships OpenSSL 3 only)
RUN PRISMA_DIR=/app/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client && \
    cp "$PRISMA_DIR/libquery_engine-linux-musl-openssl-3.0.x.so.node" \
       "$PRISMA_DIR/libquery_engine-linux-musl.so.node"
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY apps/api/assets ./apps/api/assets

USER appuser
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s \
  CMD node -e "require('http').get('http://127.0.0.1:4000/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/api/dist/src/main.js"]
