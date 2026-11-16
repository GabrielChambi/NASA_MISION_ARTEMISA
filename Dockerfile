# Public assets; secrets are only supplied when the container runs.
FROM node:22-bookworm-slim AS web
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
COPY data/i18n/ /build/data/i18n/
RUN npm run build

FROM python:3.11-slim-bookworm AS python_deps
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
    AI_PROVIDER=gemini AI_MODEL=gemini-3.5-flash-lite \
    LUNAR_REQUIRE_GEMINI=1 PORT=8000 GDAL_CACHEMAX=16 MALLOC_ARENA_MAX=2
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libgomp1 libexpat1 && rm -rf /var/lib/apt/lists/*
COPY api/requirements.txt /app/api/requirements.txt
RUN pip install --no-cache-dir -r /app/api/requirements.txt

# Pin and cache the scientific layer independently from application edits.
FROM python_deps AS scientific_data
COPY api/scripts/acquire_runtime_data.py /app/api/scripts/acquire_runtime_data.py
COPY data/prepared/landing_surface.json data/prepared/spice_manifest.json /app/data/prepared/
COPY data/pinned/ /app/data/pinned/
RUN --mount=type=cache,id=lunar-oracle-pinned-sources-v1,target=/app/data/raw,sharing=locked python /app/api/scripts/acquire_runtime_data.py && cp -a /app/data/raw /app/pinned_raw

FROM python_deps AS runtime
COPY api/ /app/api/
COPY data/ /app/data/
COPY --from=scientific_data /app/pinned_raw/ /app/data/raw/
COPY --from=web /build/frontend/dist/ /app/frontend/dist/
RUN useradd --create-home --uid 10001 lunar && mkdir -p /app/data/cache && chown -R lunar:lunar /app/data/cache
USER lunar
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/api/ready',timeout=4)"
CMD ["python","-m","api.scripts.start_production"]
