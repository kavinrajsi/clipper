// Brief generation: picked moments -> a draft campaign.
//
// SERVER ONLY. This is the Phase 3 exit criterion — the brand uploads a
// recording, makes a few yes/no decisions about their own content, and gets a
// fundable campaign without writing a brief.
//
// Same shape as highlights.js: a pure half that can be tested with no key and
// no network (`npm run brief:check`), and one model call that cannot.
//
// THE SAFETY PROPERTY WORTH KNOWING: the model never supplies a timestamp. It
// writes the pitch — title, description, framing per moment — and the actual
// clip bounds are rendered from the database rows around it. A model that
// hallucinates "cut from 14:32" in a brief sends a creator to a moment that does
// not exist, and they only find out after doing the work. So the numbers are
// never the model's to get wrong.

import { generateText, Output, jsonSchema } from "ai";

export const BRIEF_MODEL = process.env.AI_BRIEF_MODEL ?? "anthropic/claude-sonnet-5";

// A campaign generated from more than this is not a campaign, it is a backlog.
export const MAX_MOMENTS_PER_BRIEF = 6;

const BRIEF_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "The campaign title. Under 70 characters, concrete, no marketing filler.",
    },
    description: {
      type: "string",
      description:
        "What this campaign is for, in two or three sentences, addressed to a creator deciding whether to apply.",
    },
    requirements: {
      type: "string",
      description:
        "What a good submission looks like: format, length, captions, tone. Do not restate the moments themselves.",
    },
    angles: {
      type: "array",
      description: "One entry per moment, in the same order they were given.",
      items: {
        type: "object",
        properties: {
          hook: { type: "string", description: "How the clip should open, in one line." },
          angle: { type: "string", description: "What this clip is about and why it lands." },
        },
        required: ["hook", "angle"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "description", "requirements", "angles"],
  additionalProperties: false,
});

function clock(totalSeconds) {
  const total = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function buildBriefPrompt({ moments, filename, brandVoice }) {
  const voice = brandVoice
    ? [
        "",
        "The brand's voice:",
        brandVoice.tone ? `- Tone: ${brandVoice.tone}` : null,
        brandVoice.audience ? `- Audience: ${brandVoice.audience}` : null,
        brandVoice.banned_terms?.length ? `- Never use: ${brandVoice.banned_terms.join(", ")}` : null,
        brandVoice.required_disclosures?.length
          ? `- Every clip must carry: ${brandVoice.required_disclosures.join("; ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const listed = moments.map((m, i) =>
    [
      `${i + 1}. ${m.title ?? "Untitled moment"}`,
      m.quote ? `   Line: "${m.quote}"` : null,
      m.rationale ? `   Why it works: ${m.rationale}` : null,
    ]
      .filter(Boolean)
      .join("\n")
  );

  return [
    `A brand picked ${moments.length} moment${moments.length === 1 ? "" : "s"} from "${filename ?? "their recording"}"`,
    "and wants short clips made from them.",
    "",
    "Write the campaign brief a creator will read before applying.",
    "",
    "The moments:",
    ...listed,
    voice,
    "",
    "Write for a creator deciding whether to take the work: what the brand wants,",
    "what a good submission looks like, and how to open each clip.",
    "Be specific and skip the marketing register.",
    "",
    "Do not invent timestamps or quote anything not shown above — the exact clip",
    "boundaries are attached separately and are not yours to state.",
    `Return exactly ${moments.length} angle${moments.length === 1 ? "" : "s"}, in the order the moments are listed.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Turn the model's output plus the stored moments into a campaign draft.
 *
 * Every timestamp in the result is rendered from `moments`, which came out of
 * the database. The model contributes prose only. If it returns fewer angles
 * than there are moments, the extras simply carry no framing rather than being
 * matched up wrongly.
 */
export function buildCampaignDraft(output, moments) {
  const title = trim(output?.title, 200) ?? "Clips from a recording";
  const description = trim(output?.description, 4000) ?? "";
  const requirements = trim(output?.requirements, 4000) ?? "";
  const angles = Array.isArray(output?.angles) ? output.angles : [];

  const clipSpec = moments
    .map((m, i) => {
      const angle = angles[i];
      return [
        `${i + 1}. ${clock(m.start_seconds)}–${clock(m.end_seconds)} — ${m.title ?? "Moment"}`,
        m.quote ? `   Hook line: "${m.quote}"` : null,
        angle?.hook ? `   Open with: ${trim(angle.hook, 400)}` : null,
        angle?.angle ? `   Angle: ${trim(angle.angle, 600)}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return {
    title,
    description,
    // The clip list is appended rather than interleaved so the timestamps are
    // visibly ours, in one block, under a heading the creator can scan to.
    requirements: [requirements, "", "Clips to cut:", "", clipSpec].join("\n").trim(),
  };
}

function trim(value, max) {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

/**
 * Generate a brief from an asset's picked moments and open a draft campaign.
 *
 * The campaign is created unfunded, with no rate — money is the brand's
 * decision and always was. `campaigns_active_requires_funded` means a draft
 * cannot go live until they fund it, so nothing here can put a live campaign
 * into the marketplace.
 */
export async function generateBrief(admin, { asset, moments, userId, brandVoice = null }) {
  const { enqueueJob, startJob, completeJob, failJob } = await import("@/lib/ai/jobs");

  if (!moments.length) {
    const error = new Error("Pick at least one moment first.");
    error.status = 409;
    throw error;
  }

  const used = moments.slice(0, MAX_MOMENTS_PER_BRIEF);

  const job = await enqueueJob(admin, {
    workspaceId: asset.workspace_id,
    userId,
    kind: "caption",
    subjectType: "source_asset",
    subjectId: asset.id,
    input: { moments: used.length },
  });

  await startJob(admin, job.id, { model: BRIEF_MODEL });

  try {
    const { output, usage } = await generateText({
      model: BRIEF_MODEL,
      output: Output.object({ schema: BRIEF_SCHEMA }),
      prompt: buildBriefPrompt({ moments: used, filename: asset.filename, brandVoice }),
    });

    const draft = buildCampaignDraft(output, used);

    const { data: campaign, error: insertError } = await admin
      .from("campaigns")
      .insert({
        brand_id: userId,
        workspace_id: asset.workspace_id,
        title: draft.title,
        description: draft.description,
        requirements: draft.requirements,
        platform: "youtube",
        // Placeholders the brand replaces before funding. Not the model's call:
        // it has no idea what a clip is worth to this business.
        payout_structure: "flat_fee",
        payout_rate: 0,
        status: "draft",
      })
      .select("id, title")
      .single();

    if (insertError) throw new Error(`Could not create the campaign: ${insertError.message}`);

    // Link the moments back. Pipeline-only since 20260801141854 — a member
    // cannot point a moment at a campaign of their choosing.
    await admin
      .from("highlight_candidates")
      .update({ campaign_id: campaign.id })
      .in(
        "id",
        used.map((m) => m.id)
      );

    await completeJob(admin, job.id, {
      output: { campaign_id: campaign.id, moments: used.length },
      tokensUsed: usage?.totalTokens ?? null,
      creditsCharged: 0,
    });

    return { job, campaign, moments: used.length };
  } catch (error) {
    await failJob(admin, job.id, error.message);
    throw error;
  }
}
