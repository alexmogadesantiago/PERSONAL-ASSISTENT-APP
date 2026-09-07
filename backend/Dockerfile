# Automation Center backend. Multi-arch (amd64/arm64) via python:slim.
#
# BUILD CONTEXT IS THE REPOSITORY ROOT, not ./backend:
#   docker build --target test -f backend/Dockerfile .
# The test stage checks the committed n8n workflow JSONs for secrets, and those
# live at the repo root - outside a ./backend context, no COPY can reach them.
# Only the test stage receives them; the runtime image is unchanged.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/pyproject.toml ./
# Install runtime deps only (resolved from pyproject).
RUN pip install --no-cache-dir "." && pip uninstall -y automation-center-backend

COPY backend/app ./app
COPY backend/migrations ./migrations
COPY backend/scripts ./scripts
COPY backend/alembic.ini ./
COPY backend/entrypoint.sh ./

RUN useradd --system --uid 10001 appuser && chown -R appuser /app
USER appuser

# Listen on $PORT when the platform injects one (Render, Railway), else 8080
# (docker-compose, local). EXPOSE stays 8080 for the compose default.
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=10 --start-period=20s \
    CMD curl -fsS "http://localhost:${PORT:-8080}/api/health" || exit 1

ENTRYPOINT ["./entrypoint.sh"]
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]

# --- test stage: `docker build --target test` runs the suite ---
FROM base AS test
USER root
RUN pip install --no-cache-dir "pytest==8.3.4" "pytest-cov==6.0.0" "anyio==4.7.0"
COPY backend/tests ./tests
# `tests/test_workflows.py` resolves parents[2] of its own path, which is `/`
# inside the image. The workflow JSONs are an n8n asset the API never reads, so
# they are copied here and never into the runtime image.
COPY workflows /workflows
ENV AC_ENVIRONMENT=testing AC_DATABASE_URL=sqlite+pysqlite:///:memory:
RUN pytest -q --tb=short -rf
