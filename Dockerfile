# syntax=docker/dockerfile:1
# Meridian: one image runs the API (serving the built web app), the outbox worker, or the migration CLI.
#   docker run ... meridian                       -> API + web      (node apps/api/dist/main.js)
#   docker run ... meridian node apps/api/dist/worker.js           -> outbox worker (webhooks, notifications)
#   docker run ... meridian node apps/api/dist/db/migrate-cli.js   -> migrations (uses DATABASE_URL_OWNER)

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm --filter @meridian/web build && pnpm --filter @meridian/api build

FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=8080 WEB_DIST=/app/apps/web/dist
WORKDIR /app
# The API bundle inlines the engine; only runtime npm dependencies are installed.
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter @meridian/api... \
 && rm -rf /root/.cache /root/.local/share/pnpm
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/migrations apps/api/migrations
COPY --from=build /repo/apps/web/dist apps/web/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
