// Exercise the pure half of brief generation.
//
//   npm run brief:check
//
// No key, no network, no database. What this actually guards is the safety
// property the slice is built around: **the model never supplies a timestamp.**
// It writes the pitch; the clip boundaries are rendered from the database rows.
// A hallucinated "cut from 14:32" in a brief sends a creator to a moment that
// does not exist, and they find out after doing the work.
//
// So the assertions below care less about prose and more about: do the numbers
// in the output come from the moments, and does a misbehaving model — too few
// angles, too many, garbage types, injected timestamps — still produce a brief
// whose clip list is correct?
import { buildBriefPrompt, buildCampaignDraft } from "../src/lib/ai/brief.js";

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"}  ${name}${detail ? `  ${detail}` : ""}`);
};

const moments = [
  { id: "m1", start_seconds: 8, end_seconds: 45, title: "Pricing is the business", rationale: "Stands alone.", quote: "Nobody tells you this" },
  { id: "m2", start_seconds: 3725, end_seconds: 3800, title: "Doubled the price", rationale: "Concrete result.", quote: "churn went down" },
];

// --- prompt ---------------------------------------------------------------
const prompt = buildBriefPrompt({ moments, filename: "ep12.mp4", brandVoice: null });
check("prompt lists every picked moment", prompt.includes("Pricing is the business") && prompt.includes("Doubled the price"));
check("prompt carries the quotes", prompt.includes("Nobody tells you this"));
check("prompt asks for one angle per moment", prompt.includes("Return exactly 2 angles"));
check("prompt forbids inventing timestamps", prompt.includes("Do not invent timestamps"));
check(
  "prompt does NOT leak the raw bounds to the model",
  !prompt.includes("3725") && !prompt.includes("00:08"),
  "the model never sees numbers it could echo back"
);

const voiced = buildBriefPrompt({
  moments,
  filename: "ep12.mp4",
  brandVoice: { tone: "Dry", audience: "Founders", banned_terms: ["synergy"], required_disclosures: ["#ad"] },
});
check("brand voice reaches the prompt", voiced.includes("Dry") && voiced.includes("synergy") && voiced.includes("#ad"));
const singular = buildBriefPrompt({ moments: [moments[0]], filename: "x" });
check(
  "singular phrasing for a single moment",
  singular.includes("Return exactly 1 angle,") && singular.includes("picked 1 moment from"),
  "no '1 moments' / '1 angles'"
);

// --- the draft: timestamps must come from the rows ------------------------
const good = {
  title: "Pricing clips from ep12",
  description: "Three short clips about pricing.",
  requirements: "Vertical, burned-in captions.",
  angles: [
    { hook: "Open on the claim.", angle: "Pricing as the whole business." },
    { hook: "Lead with the number.", angle: "A concrete before/after." },
  ],
};

const draft = buildCampaignDraft(good, moments);
check("title comes through", draft.title === "Pricing clips from ep12");
check("requirements keep the model's own section", draft.requirements.includes("Vertical, burned-in captions."));
check("clip list is appended under a heading", draft.requirements.includes("Clips to cut:"));
check("bounds are rendered from the rows", draft.requirements.includes("00:08–00:45"), draft.requirements.match(/\d+:\d+–\d+:\d+/g)?.join(" "));
check("past an hour the stamp grows an hours field", draft.requirements.includes("1:02:05–1:03:20"));
check("hooks and angles are attached in order", draft.requirements.indexOf("Open on the claim.") < draft.requirements.indexOf("Lead with the number."));

// --- a misbehaving model --------------------------------------------------
const fewAngles = buildCampaignDraft({ ...good, angles: [good.angles[0]] }, moments);
check("too few angles still lists every moment", (fewAngles.requirements.match(/Hook line:/g) ?? []).length === 2);
check("a moment with no angle simply carries no framing", !fewAngles.requirements.includes("Lead with the number."));

const manyAngles = buildCampaignDraft({ ...good, angles: [...good.angles, { hook: "extra", angle: "extra" }] }, moments);
check("extra angles are dropped, not appended as a phantom moment", !manyAngles.requirements.includes("3. "));

const injected = buildCampaignDraft(
  {
    ...good,
    requirements: "Cut from 14:32 to 16:05.",
    angles: [{ hook: "Start at 99:99", angle: "x" }, { hook: "y", angle: "z" }],
  },
  moments
);
check(
  "a model-supplied timestamp cannot displace the real clip list",
  injected.requirements.includes("00:08–00:45") && injected.requirements.includes("1:02:05–1:03:20"),
  "the authoritative bounds are still ours"
);

const garbage = buildCampaignDraft({ title: null, description: 42, requirements: undefined, angles: "nope" }, moments);
check("garbage output still yields a usable draft", typeof garbage.title === "string" && garbage.title.length > 0, garbage.title);
check("garbage output still yields the correct clip list", garbage.requirements.includes("00:08–00:45"));
check("nothing is undefined in the draft", Object.values(garbage).every((v) => typeof v === "string"));

const overlong = buildCampaignDraft({ ...good, title: "t".repeat(500) }, moments);
check("an overlong title is truncated rather than rejected", overlong.title.length === 200);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
if (failed.length) process.exit(1);
