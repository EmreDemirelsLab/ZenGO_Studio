"""
RunPod Serverless Handler for HeartMuLa Music Generation
"""

import os
import time
import uuid
import logging
import tempfile

import torch
import runpod

# ─── Logging ───
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("heartmula-worker")

# ─── Global singleton: load model ONCE, reuse across requests ───
PIPELINE = None
CHECKPOINTS_PATH = os.environ.get("CHECKPOINTS_PATH", "/app/checkpoints")

# ─── Limits ───
MAX_DURATION_MS = int(os.environ.get("MAX_DURATION_MS", "240000"))  # 4 minutes max
JOB_TIMEOUT_SEC = int(os.environ.get("JOB_TIMEOUT_SEC", "300"))     # 5 minutes max


def load_model():
    """Load HeartMuLa pipeline once (singleton pattern for cold start optimization)."""
    global PIPELINE

    if PIPELINE is not None:
        log.info("Pipeline already loaded, reusing.")
        return PIPELINE

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

    duration_ms = min(int(job_input.get("duration_ms", 120000)), MAX_DURATION_MS)
    temperature = float(job_input.get("temperature", 1.0))
    topk = int(job_input.get("topk", 50))
    cfg_scale = float(job_input.get("cfg_scale", 1.5))

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

    # Verify checkpoints exist
    if os.path.exists(CHECKPOINTS_PATH):
        items = os.listdir(CHECKPOINTS_PATH)
        log.info(f"Checkpoints found: {items}")
    else:
        log.error(f"CHECKPOINTS_PATH NOT FOUND: {CHECKPOINTS_PATH}")

    # Preload model at startup (reduces first request latency)
    load_model()

    runpod.serverless.start({"handler": handler})
