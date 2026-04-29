FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn install --immutable

# Copy application
COPY src/ ./src/
COPY config/ ./config/

# Create data directory
RUN mkdir -p data logs

ENV NODE_ENV=production

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["node", "src/index.js"]
