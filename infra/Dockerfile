# syntax=docker/dockerfile:1
# Image unique pour l'API et le worker :
#   API    : commande par défaut (node dist/main.js)
#   worker : node dist/worker.js
#   migrations : node_modules/.bin/prisma migrate deploy
# Construction depuis la racine du dépôt : docker build -f infra/Dockerfile .

# Miroir ECR Public des images officielles : pas de limite anonyme Docker Hub.
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:26-alpine
# Image des étapes de construction seulement (ex. avec l'autorité d'un proxy
# d'entreprise) : rien n'en reste dans l'image finale.
ARG BUILD_IMAGE=${NODE_IMAGE}

FROM ${BUILD_IMAGE} AS base
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
RUN pnpm --filter "@tournoi-connect/api..." build \
 && pnpm --filter @tournoi-connect/api deploy --prod --legacy /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
# Migrations jouées au déploiement : prisma migrate deploy (service migrate).
COPY --from=build --chown=node:node /out/prisma ./prisma
COPY --from=build --chown=node:node /out/prisma.config.ts ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health/live" || exit 1
CMD ["node", "dist/main.js"]
