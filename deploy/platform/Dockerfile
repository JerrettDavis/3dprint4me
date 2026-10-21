FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY lib ./lib
COPY api ./api
COPY public/assets/js ./public/assets/js
COPY scripts/platform-server.mjs scripts/platform-jobs.mjs scripts/platform-status.mjs scripts/print-estimate-maintenance.mjs scripts/rehearse-inquiry.mjs ./scripts/
USER node
EXPOSE 8080
CMD ["node","scripts/platform-server.mjs"]
