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

# Directorio de datos con permisos para el usuario no-root incorporado 'node'.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

WORKDIR /app/server
EXPOSE 4000

# Sonda de salud (Node trae fetch global en v22).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Seed idempotente y arranque. `exec` deja a node como PID 1 (recibe SIGTERM).
CMD ["sh", "-c", "node dist/db/seed.js || true; exec node dist/index.js"]
