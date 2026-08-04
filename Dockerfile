FROM python:3.11-slim

ARG API_PROFILE=minimal
ARG ENABLE_SONG_DL_AND_EMBEDINGS=0
ARG STREETPARADE_VECTOR_STORE=numpy

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/src \
    ENABLE_SONG_DL_AND_EMBEDINGS=$ENABLE_SONG_DL_AND_EMBEDINGS \
    STREETPARADE_VECTOR_STORE=$STREETPARADE_VECTOR_STORE \
    STREETPARADE_NUMPY_VECTOR_DIR=/data/vectorstore \
    STREETPARADE_DB=/data/streetparade_embeddings.sqlite3

WORKDIR /app

RUN apt-get update \
    && if [ "$API_PROFILE" = "full" ]; then apt-get install -y --no-install-recommends ffmpeg curl; else apt-get install -y --no-install-recommends curl; fi \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY src ./src

RUN pip install --upgrade pip \
    && if [ "$API_PROFILE" = "full" ]; then pip install --index-url https://download.pytorch.org/whl/cpu torch && pip install -e '.[full]'; else pip install -e .; fi

EXPOSE 8000

CMD ["sh", "-c", "python -m streetparade_embeddings.bootstrap && uvicorn streetparade_embeddings.api:app --host 0.0.0.0 --port 8000"]
