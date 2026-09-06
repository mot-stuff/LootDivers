# Loot Divers API (TASK-707). Two-stage build: bundle TypeScript with dev
# dependencies, then ship a production-only image. argon2 resolves a prebuilt
# linux-x64 binary at install time (no toolchain needed in either stage).
#
# TASK-717 (DEC-043): the build CONTEXT is the repo root, not server/ — the
# save-validation module bundles the client's `src/core`/`src/persistence`
# sources into dist/server.js via esbuild. Build with:
#   docker build -f server/Dockerfile .
# docker-compose.yml and the CI job both pass the root context; the root
# .dockerignore keeps the context down to exactly these paths.

FROM node:24-slim AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
COPY src /app/src
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist ./dist
COPY server/migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
