FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install heartlib from GitHub
RUN pip install --no-cache-dir git+https://github.com/HeartMuLa/heartlib.git

# Download model checkpoints directly into the image (no volume needed!)
RUN pip install --no-cache-dir huggingface_hub && \
    huggingface-cli download HeartMuLa/HeartMuLaGen --local-dir /app/checkpoints && \
    huggingface-cli download HeartMuLa/HeartMuLa-oss-3B-happy-new-year --local-dir /app/checkpoints/HeartMuLa-oss-3B && \
    huggingface-cli download HeartMuLa/HeartCodec-oss-20260123 --local-dir /app/checkpoints/HeartCodec-oss

# Copy handler
COPY handler.py .

# Environment - point to embedded checkpoints
ENV CHECKPOINTS_PATH=/app/checkpoints
ENV MAX_DURATION_MS=240000
ENV JOB_TIMEOUT_SEC=300
ENV PYTHONUNBUFFERED=1

CMD ["python", "-u", "handler.py"]
