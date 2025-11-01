# Multi-runtime container: Node 20 + Python 3 to run backend (Node) and assistant (Python)
FROM node:20-bullseye

# Install Python 3 + pip
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package manifests first for better caching
COPY soft-sme-backend/package*.json ./soft-sme-backend/
COPY soft-sme-backend/tsconfig*.json ./soft-sme-backend/

# Install Node deps and build
WORKDIR /app/soft-sme-backend
RUN npm ci

# Copy the rest of the backend and agent code
WORKDIR /app
COPY . .

# Build TypeScript
WORKDIR /app/soft-sme-backend
RUN npm run build

# Install Python requirements for assistant
WORKDIR /app
RUN pip3 install -r Aiven.ai/requirements.txt

# Expose no extra ports; Python listens on 127.0.0.1:5001 internally

# Render will run the default command; ensure script is executable
WORKDIR /app/soft-sme-backend
RUN chmod +x /app/start.sh

CMD ["/bin/bash", "/app/start.sh"]

