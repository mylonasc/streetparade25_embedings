FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STREETPARADE_DB=/data/streetparade_embeddings.sqlite3 \
    PYTHONPATH=/app/ml_pipeline/1_labeling/backend:/app/src

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY src ./src
COPY ml_pipeline/1_labeling/backend ./ml_pipeline/1_labeling/backend

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch \
    && pip install --no-cache-dir -e .

WORKDIR /app/ml_pipeline/1_labeling/backend

EXPOSE 8100

CMD ["python", "scripts/run_annotation_api.py"]
