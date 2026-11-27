# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS development
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git openssl openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && chown node:node /app
USER node

RUN mkdir -p -m 700 /home/node/.codex

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY --chown=node:node . .
CMD ["npm", "run", "dev"]
