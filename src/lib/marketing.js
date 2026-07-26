// Copy shared between the home page's two-column overview and the dedicated
// /for-brands and /for-clippers pages. `short` is the home-page line; `long`
// is the expanded version. Titles live here once so the two surfaces can't
// drift apart.

export const BRAND_STEPS = [
  {
    n: "01",
    title: "Post a campaign",
    short: "Set requirements, a deadline, and pay per view or a flat fee.",
    long: "Write what you want cut — the source footage, the tone, the length, anything the clip has to include. Then set the deadline and how you're paying: a rate per 1,000 views, or a flat fee per approved clip.",
  },
  {
    n: "02",
    title: "Review applicants",
    short: "Clippers apply with a note — approve or reject each one.",
    long: "Clippers apply with a short pitch and a link to their channel. You see their verification status and portfolio before you decide, and you approve each one individually — nobody starts cutting uninvited.",
  },
  {
    n: "03",
    title: "Clippers publish",
    short: "Approved clippers cut and post against your campaign.",
    long: "Approved clippers edit the clip, post it to their own channel, and submit the link back against the campaign. You approve the submission before any payout is created.",
  },
  {
    n: "04",
    title: "Track it in analytics",
    short: "Views, likes, and comments roll up per connected channel.",
    long: "Views, likes, and comments sync from the YouTube Data API for every connected channel, so per-view payouts are computed from the same numbers you're looking at.",
  },
];

export const CLIPPER_STEPS = [
  {
    n: "01",
    title: "Connect your channel",
    short: "Link YouTube by OAuth, or verify with a bio code.",
    long: "Link your channel with Google sign-in for the full campaign rate, or drop a one-time code in your channel description if you'd rather not grant ongoing access. Bio-code verification pays 75% of the rate.",
  },
  {
    n: "02",
    title: "Apply to campaigns",
    short: "Browse active campaigns and apply with a short pitch.",
    long: "Every active campaign shows its rate, budget, deadline, and content requirements up front. Apply with a short pitch — the brand reviews it and approves or rejects.",
  },
  {
    n: "03",
    title: "Cut & publish",
    short: "Once approved, edit and post your clip to your channel.",
    long: "Once you're approved, cut the clip, post it to your own channel, and submit the link against the campaign. The clip stays yours — it lives on your channel and counts toward your own audience.",
  },
  {
    n: "04",
    title: "Get paid on terms",
    short: "Per-view or flat fee — whatever the campaign set.",
    long: "The brand approves your submission and the payout is computed from the campaign's terms — flat fee, or your synced view count against the per-view rate.",
  },
];
