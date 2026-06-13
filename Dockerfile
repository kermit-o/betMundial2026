# Imagen combinada para despliegue de UN SOLO servicio (p. ej. Railway):
# compila el frontend y el backend, y el servidor Express sirve la SPA, la API
# y el WebSocket desde el mismo origen.

# --- build ---
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Toolchain para compilar el binario nativo de better-sqlite3.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm install

COPY . .
RUN npm run build         # compila server (server/dist) y web (web/dist)

# --- runtime ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Ruta de la SPA compilada que servirá Express.
ENV WEB_DIST=/app/web/dist

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/web/dist ./web/dist

# Datos persistentes (montar un Volume de Railway en /data).
RUN mkdir -p /data && chown -R node:node /data /app
USER node

WORKDIR /app/server
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Seed idempotente y arranque. `exec` deja a node como PID 1 (recibe SIGTERM).
CMD ["sh", "-c", "node dist/db/seed.js || true; exec node dist/index.js"]
