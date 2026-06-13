# --- build ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY web/package.json ./web/package.json
RUN npm install --workspace web --include-workspace-root
COPY web ./web
RUN npm run build -w web

# --- runtime (nginx sirve la SPA y hace proxy de /api y /ws) ---
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
