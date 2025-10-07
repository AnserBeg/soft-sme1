# ---------- build stage ----------
FROM node:22-bookworm-slim AS build

# System packages you might need during build (keep minimal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching)
COPY soft-sme-backend/package*.json ./
RUN npm ci --include=dev

# Copy source and build
COPY soft-sme-backend/ ./
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-bookworm-slim AS runtime

# Install Tesseract + English data (and Poppler if you convert PDFs -> images)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    poppler-utils \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=10000

WORKDIR /app

# Only runtime files
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev

# Built JS
COPY --from=build /app/dist ./dist

# (Optional) If your app reads TESSERACT_PATH explicitly:
ENV TESSERACT_PATH=/usr/bin/tesseract

EXPOSE 10000
# Bind to the port Render injects (we default to 10000 here)
CMD ["node", "dist/index.js"]
