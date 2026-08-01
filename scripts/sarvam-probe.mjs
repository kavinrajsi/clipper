// Probe the Sarvam batch speech-to-text API.
//
//   npm run sarvam:probe                 # synthesised 10s WAV
//   npm run sarvam:probe -- ./clip.mp4   # also answers the MP4 question
//
// Why this exists: src/lib/ai/providers/sarvam.js was written against Sarvam's
// published docs and their official skills repo, and has never been run — no
// SARVAM_API_KEY existed when it was written. Every request and response shape
// in it is therefore a claim, not a fact. This script is what turns those
// claims into evidence, the same job `npm run razorpay:probe` does for
// Razorpay Route.
//
// It creates a real job and spends real credits — a few paise for ten seconds.
// It uploads nothing but a tone it generates itself unless you hand it a file.
//
// THE QUESTION THIS ANSWERS THAT NOTHING ELSE CAN: whether Sarvam accepts an
// MP4 directly. If it does, /studio needs no changes. If it does not, ffmpeg
// audio extraction goes in prepareAudio() and nowhere else. Pass a real video
// file as the first argument to settle it.
import { readFileSync } from "node:fs";

const BASE = "https://api.sarvam.ai/v1";
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const mark = ok === null ? "–" : ok ? "✓" : "✗";
  console.log(`${mark}  ${name}${detail ? `  ${detail}` : ""}`);
}

function env(key) {
  if (process.env[key]) return process.env[key];
  for (const file of [".env.development.local", ".env.local"]) {
    try {
      const line = readFileSync(file, "utf8")
        .split("\n")
        .reverse()
        .find((l) => l.trim().replace(/^export\s+/, "").startsWith(`${key}=`));
      if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
    } catch {}
  }
  return undefined;
}

const KEY = env("SARVAM_API_KEY");
if (!KEY) {
  console.error("SARVAM_API_KEY is not set (checked env, .env.development.local, .env.local).");
  console.error("Add it and re-run. Nothing was sent.");
  process.exit(2);
}

async function call(path, { method = "POST", body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "api-subscription-key": KEY,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 300) };
  }
  return { ok: response.ok, status: response.status, payload };
}

/** A 10-second 440Hz mono 16kHz WAV, built here so the repo carries no binary. */
function toneWav(seconds = 10, rate = 16000) {
  const samples = seconds * rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function probe(bytes, filename, mimeType, label) {
  console.log(`\n=== ${label} (${filename}, ${(bytes.byteLength / 1024).toFixed(0)} KB) ===`);

  const init = await call("/speech-to-text/job/v1", {
    body: {
      job_parameters: {
        model: "saaras:v3",
        mode: "transcribe",
        language_code: "unknown",
        with_diarization: true,
        with_timestamps: true,
      },
    },
  });

  record(`${label}: init job`, init.ok, init.ok ? "" : `HTTP ${init.status} ${JSON.stringify(init.payload).slice(0, 160)}`);
  if (!init.ok) return;

  const jobId = init.payload?.job_id ?? init.payload?.id;
  record(`${label}: job id returned`, Boolean(jobId), jobId ?? JSON.stringify(init.payload).slice(0, 160));
  if (!jobId) return;

  const urls = await call("/speech-to-text/job/v1/upload-urls", {
    body: { job_id: jobId, file_names: [filename] },
  });
  record(`${label}: upload urls`, urls.ok, urls.ok ? "" : `HTTP ${urls.status} ${JSON.stringify(urls.payload).slice(0, 160)}`);
  if (!urls.ok) return;

  const list = urls.payload?.upload_urls ?? urls.payload?.urls ?? [];
  const target = typeof list[0] === "string" ? list[0] : list[0]?.url;
  record(`${label}: presigned url present`, Boolean(target), target ? new URL(target).host : JSON.stringify(urls.payload).slice(0, 160));
  if (!target) return;

  // The shape our relay actually sends — Content-Length set, blob-type header
  // included. If this 400s, the relay in transcription.js is wrong too.
  const put = await fetch(target, {
    method: "PUT",
    headers: {
      "Content-Length": String(bytes.byteLength),
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": mimeType,
    },
    body: bytes,
  });
  record(`${label}: PUT with Content-Length`, put.ok, put.ok ? "" : `HTTP ${put.status} ${(await put.text()).slice(0, 200)}`);
  if (!put.ok) return;

  const started = await call("/speech-to-text/job/v1/start", { body: { job_id: jobId } });
  record(`${label}: start job`, started.ok, started.ok ? "" : `HTTP ${started.status} ${JSON.stringify(started.payload).slice(0, 160)}`);
  if (!started.ok) return;

  let state = null;
  let status = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    status = await call(`/speech-to-text/job/v1/${encodeURIComponent(jobId)}/status`, { method: "GET" });
    state = status.payload?.job_state ?? status.payload?.status;
    process.stdout.write(`\r   polling… ${state ?? "?"}          `);
    if (state === "Completed" || state === "Failed") break;
  }
  process.stdout.write("\r");

  record(`${label}: reached a terminal state`, state === "Completed" || state === "Failed", String(state));
  if (state !== "Completed") {
    record(`${label}: TRANSCRIBED`, false, JSON.stringify(status?.payload).slice(0, 240));
    return;
  }

  const files = (status.payload?.job_details ?? [])
    .map((d) => d?.output_file_name ?? d?.file_name)
    .filter(Boolean);
  record(`${label}: status names output files`, files.length > 0, files.join(", ") || "(falling back to 0.json)");

  const out = await call("/speech-to-text/job/v1/download-files", {
    body: { job_id: jobId, files: files.length ? files : ["0.json"] },
  });
  record(`${label}: download transcript`, out.ok, out.ok ? "" : `HTTP ${out.status} ${JSON.stringify(out.payload).slice(0, 200)}`);
  if (!out.ok) return;

  const first = Array.isArray(out.payload) ? out.payload[0] : (out.payload?.files?.[0] ?? out.payload);
  const entries = first?.diarized_transcript?.entries ?? first?.entries ?? [];
  record(`${label}: diarized entries present`, entries.length > 0, `${entries.length} entries`);
  record(
    `${label}: entries carry timestamps`,
    entries.length > 0 && entries[0] && ("start_time_seconds" in entries[0] || "start" in entries[0]),
    entries[0] ? JSON.stringify(entries[0]).slice(0, 200) : ""
  );
  console.log(`   normaliseTranscript() reads: ${JSON.stringify(entries[0] ?? first).slice(0, 300)}`);
}

const mediaPath = process.argv[2];

await probe(toneWav(), "probe.wav", "audio/wav", "audio");

if (mediaPath) {
  const bytes = readFileSync(mediaPath);
  const ext = mediaPath.split(".").pop().toLowerCase();
  const mime = ext === "mp4" ? "video/mp4" : ext === "mp3" ? "audio/mpeg" : "application/octet-stream";
  await probe(bytes, `probe.${ext}`, mime, `media(${ext})`);
} else {
  record("media: MP4 accepted directly?", null, "not tested — re-run with a path to a real video file");
  console.log("   This is the one question that decides whether ffmpeg is needed.");
}

const failed = results.filter((r) => r.ok === false);
console.log(`\n${results.filter((r) => r.ok).length} checks passed, ${failed.length} failed.`);
if (failed.length) {
  console.log("\nEvery failure above is a place src/lib/ai/providers/sarvam.js guessed wrong.");
  process.exit(1);
}
