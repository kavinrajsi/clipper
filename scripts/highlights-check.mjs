// Exercise the pure half of highlight detection against a fixture transcript.
//
//   npm run highlights:check
//
// No API key, no network, no database. Everything in src/lib/ai/highlights.js
// above `detectHighlights` is a plain function over plain data, and this is what
// checks it: transcript flattening, prompt assembly, and — the part that
// actually matters — the validator that decides which of the model's proposed
// moments are worth storing.
//
// That validator is where the real risk lives. A JSON schema guarantees the
// SHAPE of what a model returns, never the SENSE: it will happily propose a
// moment that runs past the end of the recording, or the same moment twice with
// slightly different bounds. Those cases are cheap to assert here and expensive
// to discover in front of a brand.
//
// What this does NOT check is the model call itself. That needs
// AI_GATEWAY_API_KEY and a real transcript.
import {
  buildPrompt,
  clockToSeconds,
  transcriptToLines,
  validateCandidates,
} from "../src/lib/ai/highlights.js";

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"}  ${name}${detail ? `  ${detail}` : ""}`);
};

const transcript = {
  segments: [
    { start: 0, end: 8, speaker: "SPEAKER_00", text: "Welcome back to the show." },
    { start: 8, end: 45, speaker: "SPEAKER_01", text: "Nobody tells you this, but pricing is the whole business." },
    { start: 45, end: 92, speaker: "SPEAKER_00", text: "That is a strong claim. Defend it." },
    { start: 92, end: 140, speaker: "SPEAKER_01", text: "We doubled our price and churn went down." },
    { start: 140, end: 190, text: "Untagged speaker, still transcribed." },
    { start: 190, end: 240, speaker: "SPEAKER_00", text: "" },
    null,
  ],
  duration_seconds: 240,
};

// --- flattening -----------------------------------------------------------
const lines = transcriptToLines(transcript);
check("empty and null segments are dropped", lines.length === 5, `${lines.length} lines`);
check("timestamps are clock-formatted", lines[0].startsWith("[00:00] "), lines[0].slice(0, 20));
check("speaker labels are kept when diarization gave them", lines[1].includes("SPEAKER_01: "));
check("a segment with no speaker still survives", lines[4].includes("Untagged speaker"));
check(
  "past an hour the stamp grows an hours field",
  transcriptToLines({ segments: [{ start: 3725, text: "later" }] })[0].startsWith("[1:02:05]")
);
check("clockToSeconds round-trips", clockToSeconds("1:02:05") === 3725, String(clockToSeconds("1:02:05")));

// --- prompt ---------------------------------------------------------------
const prompt = buildPrompt({ lines, filename: "ep12.mp4", brandVoice: null });
check("prompt carries the transcript", prompt.includes("pricing is the whole business"));
check("prompt names the file", prompt.includes("ep12.mp4"));
check("prompt states the length bounds", prompt.includes("15 and 180 seconds"));

const voiced = buildPrompt({
  lines,
  filename: "ep12.mp4",
  brandVoice: { tone: "Dry, direct", audience: "Founders", banned_terms: ["game-changing"] },
});
check("brand voice reaches the prompt", voiced.includes("Dry, direct") && voiced.includes("game-changing"));
check("no brand voice leaves no empty section", !prompt.includes("Tone:"));

// --- validation: the part that matters ------------------------------------
const { kept, rejected } = validateCandidates(
  [
    { start_seconds: 8, end_seconds: 45, title: "Pricing is the business", rationale: "Strong claim, no setup needed.", quote: "Nobody tells you this" },
    { start_seconds: 10, end_seconds: 44, title: "Near-duplicate", rationale: "Same moment again.", quote: "..." },
    { start_seconds: 92, end_seconds: 140, title: "Doubled the price", rationale: "Concrete result.", quote: "churn went down" },
    { start_seconds: 100, end_seconds: 90, title: "Backwards", rationale: "", quote: "" },
    { start_seconds: 0, end_seconds: 5, title: "Too short", rationale: "", quote: "" },
    { start_seconds: 0, end_seconds: 900, title: "Too long", rationale: "", quote: "" },
    { start_seconds: 3000, end_seconds: 3060, title: "Past the end", rationale: "", quote: "" },
    { start_seconds: "abc", end_seconds: 40, title: "Not a number", rationale: "", quote: "" },
  ],
  { durationSeconds: transcript.duration_seconds }
);

check("keeps only the genuinely usable moments", kept.length === 2, `${kept.length} kept, ${rejected.length} rejected`);
check("rejects end-before-start", rejected.some((r) => r.why.includes("end must be after start")));
check("rejects clips shorter than the floor", rejected.some((r) => r.why.includes("outside clip range")));
check("rejects a hallucinated timestamp past the recording", rejected.some((r) => r.why.includes("past the end")));
check("rejects a near-duplicate of a kept moment", rejected.some((r) => r.why.includes("duplicates")));
check("rejects non-numeric bounds", rejected.some((r) => r.why.includes("non-numeric")));
check("output is ordered by start time", kept[0].start < kept[1].start);
check("blank strings normalise to null", validateCandidates([{ start_seconds: 0, end_seconds: 30, title: "  ", rationale: "x", quote: "y" }]).kept[0].title === null);
check("long text is truncated rather than rejected", validateCandidates([{ start_seconds: 0, end_seconds: 30, title: "t".repeat(500), rationale: "x", quote: "y" }]).kept[0].title.length === 120);
check("no duration known means the past-the-end rule cannot fire", validateCandidates([{ start_seconds: 3000, end_seconds: 3060, title: "x", rationale: "y", quote: "z" }]).kept.length === 1);
check("empty input is not an error", validateCandidates(undefined).kept.length === 0);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
if (failed.length) process.exit(1);
