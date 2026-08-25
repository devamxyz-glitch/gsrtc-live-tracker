# ST Tracker — no build step, no runtime dependencies for the server itself.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8787 \
    BIND=0.0.0.0

WORKDIR /app

# The server uses only the Node standard library; package.json is copied for the version string.
COPY package.json ./
COPY server ./server
COPY web ./web

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/proxy.mjs"]
