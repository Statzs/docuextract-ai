FROM python:3.12-slim AS base
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /bin/uv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

# Tesseract OCR (English + Spanish) for scanned PDFs and photos: the free, private fallback
# when AI is unavailable or the user chooses private mode. ~30 MB.
RUN apt-get update     && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-spa     && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./

RUN useradd --create-home --uid 10001 appuser
USER appuser
ENV PATH="/app/.venv/bin:$PATH" ENVIRONMENT=production PORT=8000
EXPOSE 8000
# Forwarded headers are NOT trusted here: anyone can send them. The app reads the client IP
# itself, and only behind the origin lock (ORIGIN_SECRET + CLIENT_IP_HEADER).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --no-proxy-headers"]
