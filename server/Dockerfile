# Imagen del API (servicio independiente). La base de datos es PostgreSQL externo
# (variable DATABASE_URL).

# --- build ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json ./server/package.json
RUN npm install --workspace server --include-workspace-root
COPY server ./server
RUN npm run build -w server

# --- runtime ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# npm workspaces eleva las dependencias al node_modules raíz; Node las resuelve
# hacia arriba desde /app/server/dist.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json

RUN chown -R node:node /app
USER node

WORKDIR /app/server
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "node dist/db/seed.js || true; exec node dist/index.js"]
