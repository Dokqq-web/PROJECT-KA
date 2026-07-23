FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY dashboard ./dashboard
COPY demo ./demo
COPY examples ./examples
RUN pnpm run build && pnpm prune --prod

RUN groupadd --system qabot \
    && useradd --system --gid qabot --home /app qabot \
    && mkdir -p /app/data /app/artifacts \
    && chown -R qabot:qabot /app

USER qabot
EXPOSE 8080
CMD ["node", "dist/api/server.js"]

