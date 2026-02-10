# C3-Agent Dockerfile
# ══════════════════════════════════════════════════════════════════════════════
# Multi-stage build: deps → build → production
# ══════════════════════════════════════════════════════════════════════════════

# ─── Stage 1: Dependencies ─────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev

# ─── Stage 2: Build (obfuscation if enabled) ──────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Optional: obfuscate source (set BUILD_OBFUSCATE=1)
ARG BUILD_OBFUSCATE=0
RUN if [ "$BUILD_OBFUSCATE" = "1" ]; then \
      npm install -g javascript-obfuscator && \
      node scripts/obfuscate.js; \
    fi

# ─── Stage 3: Production ──────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

# Security: non-root user
RUN addgroup -S c3 && adduser -S c3 -G c3

# System deps for native modules
RUN apk add --no-cache curl git

# Copy app
COPY --from=build /app/src ./src
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

# Data directory
RUN mkdir -p /data /projects && chown -R c3:c3 /data /projects /app

USER c3

# Environment
ENV NODE_ENV=production \
    C3_PORT=3335 \
    C3_HOST=0.0.0.0 \
    C3_DB_PATH=/data/c3.db \
    OLLAMA_URL=http://ollama:11434

EXPOSE 3335

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3335/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
