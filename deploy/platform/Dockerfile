FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY contracts/partner ./contracts/partner
COPY lib ./lib
COPY api ./api
COPY public/assets/js ./public/assets/js
COPY scripts/platform-server.mjs scripts/platform-jobs.mjs scripts/platform-status.mjs scripts/print-estimate-maintenance.mjs scripts/rehearse-inquiry.mjs ./scripts/
COPY scripts/blob-recovery.mjs ./scripts/
USER node
EXPOSE 8080
CMD ["node","scripts/platform-server.mjs"]
