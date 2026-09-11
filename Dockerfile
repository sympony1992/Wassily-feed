# One Next.js process: pages, API routes and the ingest loop.
# Run a single replica with a persistent volume mounted at /data.
FROM node:24-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Public values are baked into the browser bundle at build time.
ARG NEXT_PUBLIC_CONTRACT_ADDRESS=
ARG NEXT_PUBLIC_GITHUB_URL=
ARG NEXT_PUBLIC_X_URL=
ARG NEXT_PUBLIC_DEFAULT_PERSONA=hoeffding
ARG NEXT_PUBLIC_DEFAULT_BOUND=
ARG NEXT_PUBLIC_HERO_VIDEO=/videos/hero.mp4
ARG NEXT_PUBLIC_HERO_POSTER=
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    DATA_SOURCE=dexscreener
VOLUME ["/data"]
EXPOSE 3000

CMD ["npx", "next", "start"]
