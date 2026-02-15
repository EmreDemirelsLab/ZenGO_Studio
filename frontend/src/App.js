import React, { useState, useRef, useCallback } from "react";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:3001";
const POLL_INTERVAL = 3000;

const STYLES = {
  container: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #0f0c29 0%, #1a1a2e 50%, #16213e 100%)",
    color: "#e0e0e0",
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "40px 20px",
  },
  header: {
    textAlign: "center",
    marginBottom: 40,
  },
  title: {
    fontSize: 42,
    fontWeight: 800,
    background: "linear-gradient(90deg, #a78bfa, #ec4899, #f59e0b)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    margin: 0,
  },
  subtitle: {
    color: "#8b8ba7",
    fontSize: 16,
    marginTop: 8,
  },
  card: {
    background: "rgba(255,255,255,0.05)",
    borderRadius: 16,
    padding: 32,
    width: "100%",
    maxWidth: 600,
    backdropFilter: "blur(10px)",
    border: "1px solid rgba(255,255,255,0.1)",
  },
  label: {
    display: "block",
    fontSize: 14,
    fontWeight: 600,
    color: "#a78bfa",
    marginBottom: 6,
    marginTop: 20,
  },
  textarea: {
    width: "100%",
    minHeight: 120,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 10,
    color: "#e0e0e0",
    fontSize: 15,
    padding: 14,
    resize: "vertical",
    outline: "none",
    boxSizing: "border-box",
  },
  input: {
    width: "100%",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 10,
    color: "#e0e0e0",
    fontSize: 15,
    padding: "12px 14px",
    outline: "none",
    boxSizing: "border-box",
  },
  select: {
    width: "100%",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 10,
    color: "#e0e0e0",
    fontSize: 15,
    padding: "12px 14px",
    outline: "none",
    boxSizing: "border-box",
  },
  button: {
    width: "100%",
    padding: "16px",
    fontSize: 18,
    fontWeight: 700,
    border: "none",
    borderRadius: 12,
    cursor: "pointer",
    marginTop: 28,
    background: "linear-gradient(90deg, #7c3aed, #ec4899)",
    color: "white",
    transition: "opacity 0.2s",
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  statusBox: {
    marginTop: 24,
    padding: 16,
    borderRadius: 10,
    background: "rgba(167,139,250,0.1)",
    border: "1px solid rgba(167,139,250,0.3)",
    textAlign: "center",
  },
  audioSection: {
    marginTop: 24,
    textAlign: "center",
  },
  audio: {
    width: "100%",
    marginTop: 12,
  },
  downloadBtn: {
    display: "inline-block",
    marginTop: 12,
    padding: "10px 24px",
    background: "linear-gradient(90deg, #10b981, #059669)",
    color: "white",
    borderRadius: 8,
    textDecoration: "none",
    fontWeight: 600,
    fontSize: 14,
  },
  error: {
    marginTop: 24,
    padding: 16,
    borderRadius: 10,
    background: "rgba(239,68,68,0.15)",
    border: "1px solid rgba(239,68,68,0.4)",
    color: "#fca5a5",
    textAlign: "center",
  },
};

const DURATION_OPTIONS = [
  { label: "30 seconds", value: 30000 },
  { label: "1 minute", value: 60000 },
  { label: "2 minutes", value: 120000 },
  { label: "3 minutes", value: 180000 },
  { label: "4 minutes (max)", value: 240000 },
];

const STATUS_MESSAGES = {
  IN_QUEUE: "Waiting in queue...",
  IN_PROGRESS: "Generating your music...",
  COMPLETED: "Done!",
  FAILED: "Generation failed.",
};

export default function App() {
  const [lyrics, setLyrics] = useState("");
  const [tags, setTags] = useState("");
  const [durationMs, setDurationMs] = useState(120000);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [audioSrc, setAudioSrc] = useState(null);
  const [inferenceTime, setInferenceTime] = useState(null);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(
    (jobId) => {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API_URL}/api/status/${jobId}`);
          const data = await res.json();

          setStatus(data.status);

          if (data.status === "COMPLETED" && data.output) {
            stopPolling();
            setLoading(false);

            if (data.output.status === "success" && data.output.audio_base64) {
              const blob = base64ToBlob(data.output.audio_base64, "audio/mpeg");
              const url = URL.createObjectURL(blob);
              setAudioSrc(url);
              setInferenceTime(data.output.inference_time_sec);
            } else {
              setError(data.output.message || "Generation failed");
            }
          }

          if (data.status === "FAILED") {
            stopPolling();
            setLoading(false);
            setError(data.error || "Job failed");
          }
        } catch (err) {
          console.error("Poll error:", err);
        }
      }, POLL_INTERVAL);
    },
    [stopPolling]
  );

  const handleGenerate = async () => {
    if (!lyrics.trim() || !tags.trim()) return;

    setLoading(true);
    setError(null);
    setAudioSrc(null);
    setStatus("SUBMITTING");
    setInferenceTime(null);
    stopPolling();

    try {
      const res = await fetch(`${API_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lyrics: lyrics.trim(),
          tags: tags.trim(),
          duration_ms: durationMs,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Request failed");
      }

      const data = await res.json();
      setStatus(data.status || "IN_QUEUE");
      pollStatus(data.jobId);
    } catch (err) {
      setError(err.message);
      setLoading(false);
      setStatus(null);
    }
  };

  return (
    <div style={STYLES.container}>
      <div style={STYLES.header}>
        <h1 style={STYLES.title}>HeartMuLa</h1>
        <p style={STYLES.subtitle}>AI-Powered Music Generation</p>
      </div>

      <div style={STYLES.card}>
        <label style={{ ...STYLES.label, marginTop: 0 }}>Lyrics</label>
        <textarea
          style={STYLES.textarea}
          placeholder="Write your song lyrics here..."
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          disabled={loading}
        />

        <label style={STYLES.label}>Style / Tags</label>
        <input
          style={STYLES.input}
          placeholder="e.g. pop, piano, happy, female vocal"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          disabled={loading}
        />

        <label style={STYLES.label}>Duration</label>
        <select
          style={STYLES.select}
          value={durationMs}
          onChange={(e) => setDurationMs(Number(e.target.value))}
          disabled={loading}
        >
          {DURATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <button
          style={{
            ...STYLES.button,
            ...(loading || !lyrics.trim() || !tags.trim() ? STYLES.buttonDisabled : {}),
          }}
          onClick={handleGenerate}
          disabled={loading || !lyrics.trim() || !tags.trim()}
        >
          {loading ? "Generating..." : "Generate Music"}
        </button>

        {status && status !== "COMPLETED" && (
          <div style={STYLES.statusBox}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>
              {status === "IN_QUEUE" && "\u23f3"}
              {status === "IN_PROGRESS" && "\u{1f3b5}"}
              {status === "SUBMITTING" && "\u{1f680}"}
            </div>
            {STATUS_MESSAGES[status] || `Status: ${status}`}
            {(status === "IN_QUEUE" || status === "IN_PROGRESS") && (
              <div style={{ fontSize: 12, color: "#8b8ba7", marginTop: 6 }}>
                This may take 1-3 minutes. The model is generating your music...
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={STYLES.error}>{error}</div>
        )}

        {audioSrc && (
          <div style={STYLES.audioSection}>
            <div style={{ fontSize: 20, marginBottom: 8, color: "#10b981" }}>
              Your music is ready!
            </div>
            {inferenceTime && (
              <div style={{ fontSize: 13, color: "#8b8ba7", marginBottom: 12 }}>
                Generated in {inferenceTime}s
              </div>
            )}
            <audio controls style={STYLES.audio} src={audioSrc} />
            <div>
              <a href={audioSrc} download="heartmula-output.mp3" style={STYLES.downloadBtn}>
                Download MP3
              </a>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 40, fontSize: 13, color: "#555" }}>
        Powered by HeartMuLa AI
      </div>
    </div>
  );
}

function base64ToBlob(base64, mimeType) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    arr[i] = bytes.charCodeAt(i);
  }
  return new Blob([arr], { type: mimeType });
}
