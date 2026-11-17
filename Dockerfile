# Vite emits architecture-independent assets; run its native build tools without QEMU.
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force
COPY server ./server
COPY --from=frontend-build /app/web/dist ./web/dist

RUN mkdir -p /data \
    && chown -R node:node /app /data

USER node
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
