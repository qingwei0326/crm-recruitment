# ============================================================
# Stage 1: Build React frontend
# ============================================================
FROM node:20-alpine AS frontend-builder
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

# ============================================================
# Stage 2: Python runtime + frontend static
# ============================================================
FROM python:3.12-slim
WORKDIR /app

# System dependencies for SQLite + bcrypt compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc build-essential libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Backend source
COPY app/ ./app/
COPY init_db.py .

# Frontend static from stage 1
COPY --from=frontend-builder /build/dist/ ./frontend/dist/

# Data volume mount point
RUN mkdir -p /app/data
VOLUME ["/app/data"]

# Environment
ENV FRONTEND_DIR=/app/frontend/dist
ENV DATABASE_PATH=/app/data/crm.db
ENV DEEPSEEK_API_KEY=

EXPOSE 8000

# Startup: init DB (idempotent) then start uvicorn
CMD ["sh", "-c", "\
    python init_db.py && \
    python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 \
"]
