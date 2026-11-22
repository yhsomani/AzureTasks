# Multi-stage production container for WorkOps Platform
# Stage 1: Build application artifacts
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy full repository source code
COPY . .

# Build backend and frontend bundle
RUN npm run build

# Stage 2: Minimal production runtime
FROM node:22-alpine AS runner

WORKDIR /app

# Install standard enterprise CA certificates
RUN apk add --no-cache ca-certificates

# Create non-root workops user with explicit UID/GID 10001
RUN addgroup -g 10001 -S workops && \
    adduser -u 10001 -S workops -G workops

# Set production environment variables
ENV NODE_ENV=production \
    PORT=3000

# Copy package manifests and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled artifacts from builder stage
COPY --from=builder --chown=workops:workops /app/dist ./dist

# Create runtime state and log directories with non-root ownership
RUN mkdir -p /app/data /tmp/workops && \
    chown -R workops:workops /app /tmp/workops

# Switch to unprivileged non-root user
USER 10001

# Expose unprivileged application port
EXPOSE 3000

# Healthcheck probe using liveness endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O - http://127.0.0.1:3000/api/health || exit 1

# Launch application
CMD ["node", "dist/index.js"]
