# One Next.js process: pages, API routes and the ingest loop.
# Railway: run a single replica and attach a Volume at /data (the VOLUME keyword is not allowed there).
FROM node:24-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Public values are baked into the browser bundle at build time.
# Railway passes service variables with these names as build arguments.
ARG NEXT_PUBLIC_CONTRACT_ADDRESS=
ARG NEXT_PUBLIC_GITHUB_URL=
ARG NEXT_PUBLIC_X_URL=
ARG NEXT_PUBLIC_DEFAULT_PERSONA=hoeffding
ARG NEXT_PUBLIC_DEFAULT_BOUND=
ARG NEXT_PUBLIC_HERO_VIDEO=/videos/hero.mp4
ARG NEXT_PUBLIC_HERO_POSTER=
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Runtime defaults; any Railway variable with the same name overrides them.
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    DATA_SOURCE=dexscreener
EXPOSE 3000

# Run node directly (not through npx) so SIGTERM reaches the app and it saves /data before a redeploy.
CMD ["node", "node_modules/next/dist/bin/next", "start"]
