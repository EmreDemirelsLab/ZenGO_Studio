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

# Copy handler
COPY handler.py .

# Environment
ENV CHECKPOINTS_PATH=/runpod-volume/checkpoints
ENV MAX_DURATION_MS=240000
ENV JOB_TIMEOUT_SEC=300
ENV PYTHONUNBUFFERED=1

CMD ["python", "-u", "handler.py"]
