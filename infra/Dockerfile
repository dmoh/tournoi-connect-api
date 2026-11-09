# syntax=docker/dockerfile:1
# Image unique pour l'API et le worker :
#   API    : commande par défaut (node dist/main.js)
#   worker : node dist/worker.js
# Construction depuis la racine du dépôt : docker build -f infra/Dockerfile .

FROM node:26-alpine AS base
RUN npm install --global pnpm@12.18.0

FROM base AS build
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/engine/package.json packages/engine/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @tournoi-connect/api build \
 && pnpm --filter @tournoi-connect/api deploy --prod --legacy /out

FROM node:26-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health/live" || exit 1
CMD ["node", "dist/main.js"]
