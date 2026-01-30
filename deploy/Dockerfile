FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src/ ./src/

# Build
RUN npm run build

# --- Production stage ---
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Set environment
ENV NODE_ENV=production

# Run the CLI in start mode
# Configure via environment variables:
#   SESSION_KEY - Your session wallet private key
#   DRONE_ID    - Your Operator License token ID
CMD ["node", "dist/index.js", "start"]
