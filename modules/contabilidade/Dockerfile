FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

# System dependencies for PDF/image processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libzbar0 libdmtx0b libdmtx-dev wget \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY backend/app ./app

# Use module_main which wraps the original app with module contract compliance
CMD ["uvicorn", "app.module_main:app", "--host", "0.0.0.0", "--port", "4003"]
