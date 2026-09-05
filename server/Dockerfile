# Loot Divers API (TASK-707). Two-stage build: compile TypeScript with dev
# dependencies, then ship a production-only image. argon2 resolves a prebuilt
# linux-x64 binary at install time (no toolchain needed in either stage).

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
