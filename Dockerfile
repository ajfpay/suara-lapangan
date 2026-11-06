FROM node:22-alpine AS build

WORKDIR /app

# `npm ci` installs exactly what package-lock.json pins, so image builds are
# reproducible — `npm install` was free to resolve newer versions.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drop dev-only packages before they are copied into the runtime image. The
# `puppeteer` devDependency bundles its own Chromium (hundreds of MB) that
# production never uses — production uses the apk-installed chromium at
# /usr/bin/chromium via CHROME_PATH.
RUN npm prune --omit=dev


FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV CHROME_PATH=/usr/bin/chromium

# Chromium needs these at runtime; the Alpine base does not ship them.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next ./.next
COPY --from=build --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# lib/server/asr/vocabulary.ts reads fixtures/transcripts at startup to derive
# keyword bias. Without the corpus the read throws and the seed list silently
# falls back to empty, so the runtime image has to carry it.
COPY --from=build --chown=nextjs:nodejs /app/fixtures/transcripts ./fixtures/transcripts

# The PDF route snapshots rendered files under ./data/pdf; the non-root
# runtime user must be able to create it.
RUN mkdir -p /app/data/pdf && chown -R nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000
CMD ["npm", "start"]
