# --- build ---
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Toolchain para compilar el binario nativo de better-sqlite3.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY server/package.json ./server/package.json
RUN npm install --workspace server --include-workspace-root

COPY server ./server
RUN npm run build -w server

# --- runtime ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json

WORKDIR /app/server
EXPOSE 4000
# Crea el directorio de datos y arranca con seed idempotente.
CMD ["sh", "-c", "node dist/db/seed.js || true; node dist/index.js"]
