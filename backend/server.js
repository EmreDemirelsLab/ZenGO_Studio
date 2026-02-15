require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Config ───
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const RUNPOD_BASE = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}`;

if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
  console.error("RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID are required");
  process.exit(1);
}

// ─── Middleware ───
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
  })
);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many requests, please try again later." },
});
app.use("/api/", limiter);

// ─── Health check ───
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", endpoint: RUNPOD_ENDPOINT_ID });
});

// ─── POST /api/generate ───
app.post("/api/generate", async (req, res) => {
  try {
    const { lyrics, tags, duration_ms, temperature, topk, cfg_scale } = req.body;

    if (!lyrics || !lyrics.trim()) {
      return res.status(400).json({ error: "lyrics is required" });
    }
    if (!tags || !tags.trim()) {
      return res.status(400).json({ error: "tags is required" });
    }

    const duration = Math.min(parseInt(duration_ms) || 120000, 240000);

    const payload = {
      input: {
        lyrics: lyrics.trim(),
        tags: tags.trim(),
        duration_ms: duration,
        temperature: parseFloat(temperature) || 1.0,
        topk: parseInt(topk) || 50,
        cfg_scale: parseFloat(cfg_scale) || 1.5,
      },
    };

    console.log(`[generate] Submitting job: lyrics=${lyrics.length} chars, tags="${tags}", duration=${duration}ms`);

    const response = await fetch(`${RUNPOD_BASE}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[generate] RunPod error: ${response.status} ${text}`);
      return res.status(502).json({ error: "Failed to submit job to RunPod" });
    }

    const data = await response.json();
    console.log(`[generate] Job submitted: ${data.id}`);

    res.json({ jobId: data.id, status: data.status });
  } catch (err) {
    console.error(`[generate] Error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/status/:jobId ───
app.get("/api/status/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    const response = await fetch(`${RUNPOD_BASE}/status/${jobId}`, {
      headers: {
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[status] RunPod error: ${response.status} ${text}`);
      return res.status(502).json({ error: "Failed to get job status" });
    }

    const data = await response.json();

    const result = {
      jobId: data.id,
      status: data.status,
    };

    if (data.status === "COMPLETED" && data.output) {
      result.output = data.output;
    }

    if (data.status === "FAILED") {
      result.error = data.error || "Job failed";
    }

    res.json(result);
  } catch (err) {
    console.error(`[status] Error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Cancel job ───
app.post("/api/cancel/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    const response = await fetch(`${RUNPOD_BASE}/cancel/${jobId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
      },
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(`[cancel] Error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Serve frontend ───
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Start server ───
app.listen(PORT, () => {
  console.log(`HeartMuLa backend running on port ${PORT}`);
  console.log(`RunPod Endpoint: ${RUNPOD_ENDPOINT_ID}`);
});
