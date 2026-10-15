# Saga OS: one image with the gateway API, the worker and the web app.
FROM node:22-alpine AS web
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/web ./
ARG NEXT_PUBLIC_BASE_PATH=""
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    SAGA_HOST=0.0.0.0 SAGA_PORT=7700 SAGA_WEB_DIR=/app/web SAGA_DATA_DIR=/data
WORKDIR /app
COPY apps/api/pyproject.toml apps/api/
COPY apps/api/saga_api apps/api/saga_api
RUN pip install --no-cache-dir ./apps/api
# Hermes, the engine Saga OS runs for "Use my Claude API key" (WITH_HERMES=0 for a smaller image).
ARG WITH_HERMES=1
RUN if [ "$WITH_HERMES" = "1" ]; then python -m venv /opt/hermes && \
      /opt/hermes/bin/pip install --no-cache-dir "hermes-agent[anthropic,mcp,messaging,cron,web]"; fi
ENV SAGA_HERMES_BIN=/opt/hermes/bin/hermes
COPY --from=web /web/out /app/web
RUN useradd -r -u 10001 saga && mkdir -p /data && chown saga /data
USER saga
VOLUME /data
EXPOSE 7700
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7700/healthz')"
CMD ["saga-api"]
