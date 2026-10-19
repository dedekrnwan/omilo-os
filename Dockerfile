# Omilo: one image with the gateway API, the worker and the web app.
FROM node:22-alpine AS web
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/web ./
ARG NEXT_PUBLIC_BASE_PATH=""
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    OMILO_HOST=0.0.0.0 OMILO_PORT=7700 OMILO_WEB_DIR=/app/web OMILO_DATA_DIR=/data \
    OMILO_EMBEDDED_WORKER=true
WORKDIR /app
COPY apps/api/pyproject.toml apps/api/
COPY apps/api/omilo_api apps/api/omilo_api
RUN pip install --no-cache-dir ./apps/api
# Claude Code, the engine helpers run on (your API key or the subscription pool). WITH_CLAUDE_CODE=0 for a smaller image.
ARG WITH_CLAUDE_CODE=1
COPY --from=web /usr/local/bin/node /usr/local/bin/node
COPY --from=web /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    if [ "$WITH_CLAUDE_CODE" = "1" ]; then npm install -g --no-audit --no-fund @anthropic-ai/claude-code && \
      ln -sf /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js /usr/local/bin/claude; fi
COPY --from=web /web/out /app/web
# The knowledge base's local embedding model downloads once into /data/models on first use. PRELOAD_EMBEDDINGS=1 bakes
# it into the image instead (~220 MB, works offline from the first start).
ARG PRELOAD_EMBEDDINGS=0
RUN if [ "$PRELOAD_EMBEDDINGS" = "1" ]; then mkdir -p /opt/models && python -c "from fastembed import TextEmbedding; \
      TextEmbedding('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2', cache_dir='/opt/models')" && chmod -R a+rX /opt/models; fi
ENV OMILO_MODELS_DIR=${PRELOAD_EMBEDDINGS:+/opt/models}
RUN useradd -r -u 10001 omilo && mkdir -p /data && chown omilo /data
USER omilo
VOLUME /data
EXPOSE 7700
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7700/healthz')"
CMD ["omilo-api"]
