FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

WORKDIR /app

# Target all common GPU architectures for CUDA kernel compilation
ENV TORCH_CUDA_ARCH_LIST="7.5;8.0;8.6;8.9;9.0"

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies (install before heartlib so heartlib can override if needed)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install heartlib from GitHub (may compile custom CUDA kernels)
RUN pip install --no-cache-dir git+https://github.com/HeartMuLa/heartlib.git

# Copy handler (checkpoints loaded from network volume at runtime)
COPY handler.py .

# Environment - checkpoints on network volume mounted at /runpod-volume
ENV CHECKPOINTS_PATH=/runpod-volume/checkpoints
ENV MAX_DURATION_MS=240000
ENV JOB_TIMEOUT_SEC=300
ENV PYTHONUNBUFFERED=1

# Allow extra time for first-run checkpoint download
ENV RUNPOD_INIT_TIMEOUT=900

CMD ["python", "-u", "handler.py"]
