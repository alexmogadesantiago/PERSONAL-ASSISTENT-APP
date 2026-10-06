# Local / self-hosted build of the Automation Center frontend.
# Vercel does NOT use this file — it runs `npm run build` and serves `dist/`
# directly. This image is only for `docker compose up frontend` (local mode).

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Baked at build time (Vite inlines VITE_* vars). For local mode the browser
# reaches the backend on the host-published port.
ARG VITE_API_URL=http://localhost:8080
ARG VITE_WS_URL=ws://localhost:8080
ARG VITE_APP_ENV=local
# The n8n editor as the browser sees it (OAuth redirect URI, "Open n8n").
ARG VITE_N8N_URL=http://localhost:5678
ENV VITE_API_URL=$VITE_API_URL VITE_WS_URL=$VITE_WS_URL VITE_APP_ENV=$VITE_APP_ENV VITE_N8N_URL=$VITE_N8N_URL
RUN npm run build

FROM nginx:1.27-alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --retries=5 \
  CMD wget -q --spider http://localhost:3000/ || exit 1
