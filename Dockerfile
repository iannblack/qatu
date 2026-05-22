# ---- Build Stage ----
FROM node:21-alpine3.18 AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache --virtual .gyp python3 make g++ \
    && apk add --no-cache git

# Copy dependency manifests first (Docker layer cache)
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY src ./src
COPY rollup.config.js tsconfig.json ./

# Build TypeScript → dist/
RUN npm run build

# Clean build tools
RUN apk del .gyp

# ---- Production Stage ----
FROM node:21-alpine3.18 AS deploy

WORKDIR /app

ARG PORT=3009
ENV PORT=$PORT
EXPOSE $PORT

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built output and static assets
COPY --from=builder /app/dist ./dist
COPY assets ./assets
COPY dashboard ./dashboard

# Create non-root user
RUN addgroup -g 1001 -S nodejs \
    && adduser -S -u 1001 nodejs

# Create needed directories with correct permissions
RUN mkdir -p sessions uploads && chown -R nodejs:nodejs sessions uploads

USER nodejs

CMD ["npm", "start"]