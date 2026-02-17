"""
RunPod Serverless Handler for HeartMuLa Music Generation
"""

import os
import subprocess
import time
import uuid
import logging
import tempfile
from pathlib import Path

import torch
import runpod

# ─── Logging ───
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("heartmula-worker")

# ─── Global singleton: load model ONCE, reuse across requests ───
PIPELINE = None
CHECKPOINTS_PATH = os.environ.get("CHECKPOINTS_PATH", "/runpod-volume/checkpoints")

# ─── Limits ───
MAX_DURATION_MS = int(os.environ.get("MAX_DURATION_MS", "240000"))  # 4 minutes max
JOB_TIMEOUT_SEC = int(os.environ.get("JOB_TIMEOUT_SEC", "300"))     # 5 minutes max


def _parse_int(value, default, min_value=None, max_value=None):
    """Parse int safely with optional bounds."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default

    if min_value is not None:
        parsed = max(min_value, parsed)
    if max_value is not None:
        parsed = min(max_value, parsed)
    return parsed


def _parse_float(value, default, min_value=None, max_value=None):
    """Parse float safely with optional bounds."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default

    if min_value is not None:
        parsed = max(min_value, parsed)
    if max_value is not None:
        parsed = min(max_value, parsed)
    return parsed


def ensure_checkpoints():
    """Download checkpoints to network volume if not already present.

    Uses a marker file to avoid re-downloading on subsequent cold starts.
    The network volume persists across worker restarts.
    """
    marker = Path(CHECKPOINTS_PATH) / ".download_complete"
    if marker.exists():
        log.info("Checkpoints already on network volume (marker found).")
        return

    log.info("Checkpoints not found on network volume. Downloading...")
    os.makedirs(CHECKPOINTS_PATH, exist_ok=True)

    downloads = [
        ("HeartMuLa/HeartMuLaGen", CHECKPOINTS_PATH),
        ("HeartMuLa/HeartMuLa-oss-3B-happy-new-year", f"{CHECKPOINTS_PATH}/HeartMuLa-oss-3B"),
        ("HeartMuLa/HeartCodec-oss-20260123", f"{CHECKPOINTS_PATH}/HeartCodec-oss"),
    ]

    for repo_id, local_dir in downloads:
        log.info(f"  Downloading {repo_id} → {local_dir}")
        start = time.time()
        subprocess.run(
            ["huggingface-cli", "download", repo_id, "--local-dir", local_dir],
            check=True,
        )
        elapsed = time.time() - start
        log.info(f"  {repo_id} downloaded in {elapsed:.0f}s")

    # Mark download complete
    marker.touch()
    log.info("All checkpoints downloaded successfully.")


def load_model():
    """Load HeartMuLa pipeline once (singleton pattern for cold start optimization)."""
    global PIPELINE

    if PIPELINE is not None:
        log.info("Pipeline already loaded, reusing.")
        return PIPELINE

    # Ensure checkpoints are on the network volume
    ensure_checkpoints()

    log.info(f"Loading HeartMuLa pipeline from {CHECKPOINTS_PATH} ...")
    start = time.time()

    from heartlib import HeartMuLaGenPipeline

    PIPELINE = HeartMuLaGenPipeline.from_pretrained(
        pretrained_path=CHECKPOINTS_PATH,
        device={"mula": torch.device("cuda"), "codec": torch.device("cuda")},
        dtype={"mula": torch.bfloat16, "codec": torch.float32},
        version="3B",
        lazy_load=False,
    )

    elapsed = time.time() - start
    log.info(f"Pipeline loaded in {elapsed:.1f}s")
    return PIPELINE


def handler(job):
    """
    RunPod handler function.

    Expected input:
    {
        "lyrics": "your lyrics here...",
        "tags": "piano, happy, pop",
        "duration_ms": 120000,       # optional, default 120s
        "temperature": 1.0,          # optional
        "topk": 50,                  # optional
        "cfg_scale": 1.5             # optional
    }

    Returns:
    {
        "status": "success",
        "audio_base64": "...",       # base64 encoded MP3
        "duration_sec": 120,
        "inference_time_sec": 45.2
    }
    """
    job_input = job["input"]

    # ─── Validate input ───
    lyrics = job_input.get("lyrics", "").strip()
    tags = job_input.get("tags", "").strip()

    if not lyrics:
        return {"status": "error", "message": "lyrics is required"}
    if not tags:
        return {"status": "error", "message": "tags is required"}

    duration_ms = _parse_int(job_input.get("duration_ms", 120000), 120000, min_value=1000, max_value=MAX_DURATION_MS)
    temperature = _parse_float(job_input.get("temperature", 1.0), 1.0, min_value=0.1, max_value=5.0)
    topk = _parse_int(job_input.get("topk", 50), 50, min_value=1, max_value=200)
    cfg_scale = _parse_float(job_input.get("cfg_scale", 1.5), 1.5, min_value=0.1, max_value=10.0)

    log.info(f"Job {job['id']}: lyrics={len(lyrics)} chars, tags='{tags}', duration={duration_ms}ms")

    # ─── Load model ───
    try:
        pipe = load_model()
    except Exception as e:
        log.error(f"Model load failed: {e}")
        return {"status": "error", "message": f"Model load failed: {str(e)}"}

    # ─── Generate ───
    try:
        start = time.time()

        # Create temp file for output
        tmp_path = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4().hex}.mp3")

        pipe(
            {"lyrics": lyrics, "tags": tags},
            save_path=tmp_path,
            max_audio_length_ms=duration_ms,
            temperature=temperature,
            topk=topk,
            cfg_scale=cfg_scale,
        )

        inference_time = time.time() - start
        log.info(f"Job {job['id']}: generated in {inference_time:.1f}s")

        # ─── Read and encode MP3 ───
        import base64
        with open(tmp_path, "rb") as f:
            audio_bytes = f.read()
        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")

        # Clean up temp file
        os.remove(tmp_path)

        file_size_mb = len(audio_bytes) / (1024 * 1024)
        log.info(f"Job {job['id']}: output {file_size_mb:.1f}MB, inference {inference_time:.1f}s")

        return {
            "status": "success",
            "audio_base64": audio_base64,
            "duration_ms": duration_ms,
            "inference_time_sec": round(inference_time, 1),
            "file_size_mb": round(file_size_mb, 2),
        }

    except Exception as e:
        log.error(f"Job {job['id']} generation failed: {e}")
        return {"status": "error", "message": f"Generation failed: {str(e)}"}


# ─── Entry point ───
if __name__ == "__main__":
    log.info("Starting HeartMuLa worker...")
    log.info(f"CHECKPOINTS_PATH: {CHECKPOINTS_PATH}")
    log.info(f"MAX_DURATION_MS: {MAX_DURATION_MS}")
    log.info(f"CUDA available: {torch.cuda.is_available()}")

    if torch.cuda.is_available():
        log.info(f"GPU: {torch.cuda.get_device_name(0)}")
        log.info(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
        log.info(f"CUDA arch: {torch.cuda.get_device_capability(0)}")

    # Diagnostics: verify bitsandbytes CUDA support
    try:
        import bitsandbytes as bnb
        log.info(f"bitsandbytes version: {bnb.__version__}")
    except Exception as e:
        log.warning(f"bitsandbytes import issue: {e}")

    # Preload model (downloads checkpoints on first run, then loads into GPU)
    try:
        load_model()
    except Exception as e:
        log.warning(f"Preload skipped due to startup issue: {e}")

    runpod.serverless.start({"handler": handler})
