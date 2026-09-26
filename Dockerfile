FROM node:20-slim AS build
# build tools in case no prebuilt better-sqlite3 binary matches this platform
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js db.js ./
COPY public ./public
COPY seed ./seed

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --home /app app \
    && mkdir -p /data && chown app:app /data
COPY --from=build --chown=app:app /app /app
USER app
EXPOSE 8080
CMD ["node", "server.js"]
